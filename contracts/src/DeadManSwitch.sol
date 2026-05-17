// SPDX-License-Identifier: MIT
pragma solidity ^0.8.35;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title  SomniaDeadManSwitch
 * @author RiskGuard contributors
 * @notice Dead-man switch releasing native + ERC-20 tokens to multiple beneficiaries
 *         (configurable share weights) after the owner stops renewing their heartbeat.
 *
 * ── Somnia Agent auto-heartbeat ──────────────────────────────────────────────
 * Owner funds an agent budget and configures a Somnia Agent ID.  Only the owner
 * or an authorised keeper address may call triggerAgentHeartbeat() — arbitrary
 * callers cannot drain the budget.  The agent callback renews the heartbeat on
 * success and ALWAYS resets pendingAgentRequestId (even on failure) so the slot
 * never gets permanently stuck.
 *
 * ── Multi-beneficiary ────────────────────────────────────────────────────────
 * Beneficiaries are (address, shareBps) pairs summing to exactly 10 000 bps.
 * Each beneficiary must call markSafeExecution() individually.  The very first
 * call snapshots the native pot (snapshotNativePot) and freezes it.  All
 * subsequent claims — in any order — use that snapshot, so claim ordering never
 * affects individual entitlements.  ERC-20 pots are snapshotted lazily per token
 * on the first claim for that token.
 *
 * ── Fix log (v2 → v3) ────────────────────────────────────────────────────────
 *   1. Removed duplicate NotExecuted error declaration (was defined twice).
 *   2. Claim math uses snapshotNativePot / snapshotERC20Pot (frozen at first
 *      markSafeExecution) — race condition between concurrent claims eliminated.
 *   3. triggerAgentHeartbeat() restricted to onlyAuthorized (owner or keeper).
 *   4. globalExecutedAt replaces per-beneficiary executedAt for heartbeat guard.
 *   5. pendingAgentRequestId is always reset in handleHeartbeatResponse —
 *      both the success AND failure branches.
 *
 * Timeline per heartbeat:
 *   lastHeartbeatAt
 *     │── heartbeatInterval ──│── gracePeriod ──│── timelockPeriod ──│
 *     │                        │                  │                    │
 *   renewed                 deadline          graceEndsAt        timelockEndsAt
 *                                             (isExpired)        (canExecute)
 *
 * Somnia Agent platform addresses:
 *   Testnet  (chain 50312): 0x037Bb9C718F3f7fe5eCBDB0b600D607b52706776
 *   Mainnet  (chain  5031): 0x5E5205CF39E766118C01636bED000A54D93163E6
 */

// ─────────────────────────────────────────────────────────────────────────────
// Somnia Agents platform types & interface (minimal subset)
// ─────────────────────────────────────────────────────────────────────────────

enum ConsensusType  { Majority, Threshold }
enum ResponseStatus { None, Pending, Success, Failed, TimedOut }

struct Response {
    address        validator;
    bytes          result;
    ResponseStatus status;
    uint256        receipt;
    uint256        timestamp;
    uint256        executionCost;
}

struct AgentRequest {
    uint256        id;
    address        requester;
    address        callbackAddress;
    bytes4         callbackSelector;
    address[]      subcommittee;
    Response[]     responses;
    uint256        responseCount;
    uint256        failureCount;
    uint256        threshold;
    uint256        createdAt;
    uint256        deadline;
    ResponseStatus status;
    ConsensusType  consensusType;
    uint256        remainingBudget;
    uint256        perAgentBudget;
}

interface IAgentRequester {
    function createRequest(
        uint256        agentId,
        address        callbackAddress,
        bytes4         callbackSelector,
        bytes calldata payload
    ) external payable returns (uint256 requestId);

    /// @notice Returns the minimum deposit (operations reserve) for a default request.
    function getRequestDeposit() external view returns (uint256);
}

// ─────────────────────────────────────────────────────────────────────────────
// Main contract
// ─────────────────────────────────────────────────────────────────────────────
contract SomniaDeadManSwitch is ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ── Errors ────────────────────────────────────────────────────────────────
    error NotOwner();
    error NotPendingOwner();
    error NotBeneficiary();
    error NotAuthorized();               // not owner or keeper
    error ZeroAddress();
    error InvalidDuration();
    error TimelockNotReady();
    error AlreadyExecuted();             // beneficiary already marked, or switch already executed
    error NotExecuted();                 // beneficiary has not marked execution yet
    error DeadManSwitchActive();         // blocked while switch is expired/active
    error NoPendingBeneficiaries();
    error BeneficiaryTimelockNotReady();
    error TransferFailed();
    error SameAddress();
    error InvalidShares();               // shareBps list doesn't sum to BPS_TOTAL
    error TooManyBeneficiaries();
    error AgentNotConfigured();
    error AgentBudgetInsufficient();
    error AgentRequestPending();         // previous request hasn't resolved yet
    error OnlyAgentPlatform();
    error UnknownAgentRequest();

    // ── Constants ─────────────────────────────────────────────────────────────
    uint256 public constant MAX_DURATION         = 3650 days;
    uint256 public constant MIN_DURATION         = 1 days;
    uint256 public constant BENEFICIARY_TIMELOCK = 2 days;
    uint256 public constant BPS_TOTAL            = 10_000; // 100 % in bps
    uint256 public constant MAX_BENEFICIARIES    = 20;
    uint256 public constant AGENT_SUBCOMMITTEE_SIZE = 3;

    // ── Structs ───────────────────────────────────────────────────────────────
    struct Beneficiary {
        address addr;
        uint256 shareBps; // must sum to BPS_TOTAL across all list entries
    }

    // ── State: ownership ──────────────────────────────────────────────────────
    address public owner;
    address public pendingOwner;

    // ── State: keeper ─────────────────────────────────────────────────────────
    /// @notice Address allowed to trigger agent heartbeats (besides owner).
    ///         Set to address(0) to disable keeper role.
    address public keeper;

    // ── State: beneficiaries ──────────────────────────────────────────────────
    Beneficiary[] public beneficiaries;
    Beneficiary[] internal _pendingBeneficiaries;
    uint256 public pendingBeneficiariesAt;

    /// @notice Timestamp of the first markSafeExecution() call across all beneficiaries.
    ///         Zero means no execution has been marked yet.
    uint256 public globalExecutedAt;

    /// @notice Native token pot frozen at globalExecutedAt time.
    ///         Used by all subsequent native claims regardless of order.
    uint256 public snapshotNativePot;

    /// @dev Per-token ERC-20 pot, snapshotted lazily on first claim for that token.
    mapping(address => uint256) public snapshotERC20Pot;
    mapping(address => bool)    public erc20PotSet;

    /// @dev Per-beneficiary: has called markSafeExecution()?
    mapping(address => bool) public hasExecuted;

    /// @dev Native already sent to each beneficiary.
    mapping(address => uint256) public nativeClaimed;

    /// @dev ERC-20 already sent: beneficiary → token → amount.
    mapping(address => mapping(address => uint256)) public erc20Claimed;

    // ── State: heartbeat ──────────────────────────────────────────────────────
    uint256 public heartbeatInterval;
    uint256 public gracePeriod;
    uint256 public timelockPeriod;
    uint256 public lastHeartbeatAt;

    // ── State: Somnia Agent ───────────────────────────────────────────────────
    IAgentRequester public agentPlatform;
    uint256 public heartbeatAgentId;

    /// @notice Per-agent execution reward on top of the platform floor deposit.
    ///         Owner can tune this to attract runners.
    uint256 public agentRewardPerCall = 0.01 ether;

    /// @notice Native tokens earmarked exclusively for agent invocations.
    uint256 public agentBudget;

    /// @notice requestId of a currently-pending agent heartbeat (0 = none pending).
    uint256 public pendingAgentRequestId;

    // ── Events ────────────────────────────────────────────────────────────────
    event ContractInitialized(
        address indexed owner,
        uint256 heartbeatInterval,
        uint256 gracePeriod,
        uint256 timelockPeriod
    );
    event OwnershipTransferStarted(address indexed current, address indexed pending);
    event OwnershipTransferred(address indexed previous, address indexed next);
    event KeeperSet(address indexed newKeeper);
    event BeneficiariesChangeProposed(uint256 effectiveAt);
    event BeneficiariesChangeConfirmed();
    event BeneficiariesChangeCancelled();
    event HeartbeatRenewed(uint256 lastHeartbeatAt, uint256 nextDeadlineAt, bool byAgent);
    event SafeExecutionMarked(address indexed beneficiary, uint256 executedAt);
    event NativeReceived(address indexed sender, uint256 amount);
    event NativeClaimed(address indexed beneficiary, uint256 amount);
    event ERC20Claimed(address indexed beneficiary, address indexed token, uint256 amount);
    event AllClaimed(address indexed beneficiary, uint256 nativeAmount, address[] tokens, uint256[] amounts);
    event NativeRescued(address indexed to, uint256 amount);
    event ERC20Rescued(address indexed to, address indexed token, uint256 amount);
    event AgentConfigured(address indexed platform, uint256 agentId);
    event AgentBudgetFunded(uint256 amount, uint256 total);
    event AgentRewardPerCallUpdated(uint256 newReward);
    event AgentHeartbeatRequested(uint256 indexed requestId, address indexed triggeredBy);
    event AgentHeartbeatSucceeded(uint256 indexed requestId);
    event AgentHeartbeatFailed(uint256 indexed requestId, ResponseStatus status);

    // ── Constructor ───────────────────────────────────────────────────────────
    constructor(
        address              initialOwner,
        Beneficiary[] memory initialBeneficiaries,
        uint256              initialHeartbeatInterval,
        uint256              initialGracePeriod,
        uint256              initialTimelockPeriod
    ) {
        if (initialOwner == address(0)) revert ZeroAddress();
        _validateBeneficiaries(initialBeneficiaries);
        _validateDuration(initialHeartbeatInterval);
        _validateDuration(initialGracePeriod);
        _validateDuration(initialTimelockPeriod);

        owner             = initialOwner;
        heartbeatInterval = initialHeartbeatInterval;
        gracePeriod       = initialGracePeriod;
        timelockPeriod    = initialTimelockPeriod;
        lastHeartbeatAt   = block.timestamp;

        uint256 len = initialBeneficiaries.length;
        for (uint256 i; i < len; ++i) {
            beneficiaries.push(initialBeneficiaries[i]);
        }

        emit ContractInitialized(
            initialOwner,
            initialHeartbeatInterval,
            initialGracePeriod,
            initialTimelockPeriod
        );
    }

    // ── Receive ───────────────────────────────────────────────────────────────
    receive() external payable {
        // Rebates from the Somnia platform are recycled into agentBudget.
        if (msg.sender == address(agentPlatform)) {
            agentBudget += msg.value;
        } else {
            emit NativeReceived(msg.sender, msg.value);
        }
    }

    // ── Modifiers ─────────────────────────────────────────────────────────────
    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyBeneficiary() {
        if (!_isBeneficiary(msg.sender)) revert NotBeneficiary();
        _;
    }

    /// @dev Owner OR configured keeper.
    modifier onlyAuthorized() {
        if (msg.sender != owner && msg.sender != keeper) revert NotAuthorized();
        _;
    }

    // ── Ownership (2-step) ────────────────────────────────────────────────────
    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert ZeroAddress();
        if (newOwner == owner)      revert SameAddress();
        pendingOwner = newOwner;
        emit OwnershipTransferStarted(owner, newOwner);
    }

    function acceptOwnership() external {
        if (msg.sender != pendingOwner) revert NotPendingOwner();
        address previous = owner;
        owner        = pendingOwner;
        pendingOwner = address(0);
        emit OwnershipTransferred(previous, owner);
    }

    // ── Keeper management ─────────────────────────────────────────────────────
    /**
     * @notice Set (or remove) the keeper allowed to trigger agent heartbeats.
     * @param  newKeeper  address(0) disables the keeper role.
     */
    function setKeeper(address newKeeper) external onlyOwner {
        keeper = newKeeper;
        emit KeeperSet(newKeeper);
    }

    // ── Multi-beneficiary management (2-step timelock) ────────────────────────
    /**
     * @notice Propose a full replacement of the beneficiary list.
     *         Blocked once the switch has expired.
     *         Takes effect after BENEFICIARY_TIMELOCK via confirmBeneficiaries().
     */
    function proposeBeneficiaries(Beneficiary[] calldata next) external onlyOwner {
        if (isExpired()) revert DeadManSwitchActive();
        _validateBeneficiaries(next);

        delete _pendingBeneficiaries;
        uint256 len = next.length;
        for (uint256 i; i < len; ++i) {
            _pendingBeneficiaries.push(next[i]);
        }
        pendingBeneficiariesAt = block.timestamp;
        emit BeneficiariesChangeProposed(block.timestamp + BENEFICIARY_TIMELOCK);
    }

    function confirmBeneficiaries() external onlyOwner {
        if (_pendingBeneficiaries.length == 0) revert NoPendingBeneficiaries();
        if (block.timestamp < pendingBeneficiariesAt + BENEFICIARY_TIMELOCK)
            revert BeneficiaryTimelockNotReady();
        if (isExpired()) revert DeadManSwitchActive();

        delete beneficiaries;
        uint256 len = _pendingBeneficiaries.length;
        for (uint256 i; i < len; ++i) {
            beneficiaries.push(_pendingBeneficiaries[i]);
        }
        delete _pendingBeneficiaries;
        pendingBeneficiariesAt = 0;
        emit BeneficiariesChangeConfirmed();
    }

    function cancelBeneficiariesChange() external onlyOwner {
        if (_pendingBeneficiaries.length == 0) revert NoPendingBeneficiaries();
        delete _pendingBeneficiaries;
        pendingBeneficiariesAt = 0;
        emit BeneficiariesChangeCancelled();
    }

    // ── Agent configuration & funding ─────────────────────────────────────────
    /**
     * @notice Configure (or replace) the Somnia Agents platform address and agent ID.
     *         Can be updated at any time by the owner — e.g. if an agent is compromised.
     *         If a request is currently pending it will still resolve via the old callback;
     *         the UnknownAgentRequest guard will reject any response whose requestId
     *         no longer matches pendingAgentRequestId.
     */
    function configureAgent(address platform, uint256 agentId) external onlyOwner {
        if (platform == address(0)) revert ZeroAddress();
        agentPlatform    = IAgentRequester(platform);
        heartbeatAgentId = agentId;
        emit AgentConfigured(platform, agentId);
    }

    /// @notice Deposit native tokens into the agent budget.
    function fundAgentBudget() external payable onlyOwner {
        agentBudget += msg.value;
        emit AgentBudgetFunded(msg.value, agentBudget);
    }

    /// @notice Tune the per-call execution reward paid to runners on top of the
    ///         platform's floor deposit.  Increase if requests go unfulfilled.
    function setAgentRewardPerCall(uint256 reward) external onlyOwner {
        agentRewardPerCall = reward;
        emit AgentRewardPerCallUpdated(reward);
    }

    // ── Heartbeat ─────────────────────────────────────────────────────────────
    /// @notice Manual heartbeat renewal — owner only.
    function renewHeartbeat() external onlyOwner nonReentrant {
        _assertCanRenew();
        _doRenew(false);
    }

    /**
     * @notice Dispatch a Somnia Agent request that will auto-renew the heartbeat
     *         on success callback.
     * @dev    Restricted to owner or keeper — prevents arbitrary callers from
     *         draining agentBudget via repeated calls.
     *         Reverts if a request is already pending (one in-flight at a time).
     */
    function triggerAgentHeartbeat() external onlyAuthorized nonReentrant {
        if (address(agentPlatform) == address(0)) revert AgentNotConfigured();
        _assertCanRenew();
        if (pendingAgentRequestId != 0) revert AgentRequestPending();

        uint256 platformFloor = agentPlatform.getRequestDeposit();
        uint256 reward        = agentRewardPerCall * AGENT_SUBCOMMITTEE_SIZE;
        uint256 deposit       = platformFloor + reward;
        if (agentBudget < deposit) revert AgentBudgetInsufficient();

        agentBudget -= deposit;

        // Payload: current timestamp for auditability in the agent receipt.
        bytes memory payload = abi.encode(block.timestamp);

        uint256 requestId = agentPlatform.createRequest{value: deposit}(
            heartbeatAgentId,
            address(this),
            this.handleHeartbeatResponse.selector,
            payload
        );

        pendingAgentRequestId = requestId;
        emit AgentHeartbeatRequested(requestId, msg.sender);
    }

    /**
     * @notice Somnia Agents callback — called by the platform after consensus.
     * @dev    FIX: pendingAgentRequestId is reset in BOTH branches (success & failure)
     *         so the slot never gets permanently stuck.
     */
    function handleHeartbeatResponse(
        uint256           requestId,
        Response[] memory responses,
        ResponseStatus    status,
        AgentRequest memory /* details */
    ) external nonReentrant {
        if (msg.sender != address(agentPlatform)) revert OnlyAgentPlatform();
        if (requestId  != pendingAgentRequestId)  revert UnknownAgentRequest();

        // Always clear — regardless of outcome.
        pendingAgentRequestId = 0;

        if (status == ResponseStatus.Success && responses.length > 0) {
            // Renew only if still possible (owner may have renewed manually meanwhile).
            if (!isExpired() && globalExecutedAt == 0) {
                _doRenew(true);
            }
            emit AgentHeartbeatSucceeded(requestId);
        } else {
            // Failed or TimedOut — do NOT renew; the grace period provides the buffer.
            emit AgentHeartbeatFailed(requestId, status);
        }
    }

    // ── Execution marking (per beneficiary) ───────────────────────────────────
    /**
     * @notice Each beneficiary individually marks safe execution once the timelock
     *         elapses.  The FIRST call across all beneficiaries snapshots the native
     *         pot — all later claims use this frozen value regardless of order.
     */
    function markSafeExecution() external onlyBeneficiary nonReentrant {
        if (hasExecuted[msg.sender]) revert AlreadyExecuted();
        if (!isTimelockReady())      revert TimelockNotReady();

        hasExecuted[msg.sender] = true;

        // Snapshot native pot exactly once.
        if (globalExecutedAt == 0) {
            globalExecutedAt  = block.timestamp;
            snapshotNativePot = _mainNativeBalance();
        }

        emit SafeExecutionMarked(msg.sender, block.timestamp);
    }

    // ── Claim functions ───────────────────────────────────────────────────────
    /// @notice Claim the caller's proportional share of native tokens.
    function claimNative() external onlyBeneficiary nonReentrant {
        _assertReadyToClaim(msg.sender);

        uint256 share = _nativeShareOf(msg.sender);
        if (share == 0) return;

        nativeClaimed[msg.sender] += share;
        emit NativeClaimed(msg.sender, share);

        (bool ok, ) = msg.sender.call{value: share}("");
        if (!ok) revert TransferFailed();
    }

    /// @notice Claim the caller's proportional share of a single ERC-20 token.
    ///         The ERC-20 pot is snapshotted on the first claim for that token.
    function claimERC20(address token) external onlyBeneficiary nonReentrant {
        _assertReadyToClaim(msg.sender);
        if (token == address(0)) revert ZeroAddress();

        _snapshotERC20IfNeeded(token);

        uint256 share = _erc20ShareOf(msg.sender, token);
        if (share == 0) return;

        erc20Claimed[msg.sender][token] += share;
        emit ERC20Claimed(msg.sender, token, share);
        IERC20(token).safeTransfer(msg.sender, share);
    }

    /// @notice Claim all native + a list of ERC-20 tokens in one call.
    function claimAll(address[] calldata tokens) external onlyBeneficiary nonReentrant {
        _assertReadyToClaim(msg.sender);

        // Native
        uint256 nativeShare = _nativeShareOf(msg.sender);
        if (nativeShare > 0) {
            nativeClaimed[msg.sender] += nativeShare;
            (bool ok, ) = msg.sender.call{value: nativeShare}("");
            if (!ok) revert TransferFailed();
        }

        // ERC-20s
        uint256 len = tokens.length;
        uint256[] memory amounts = new uint256[](len);
        for (uint256 i; i < len; ++i) {
            address token = tokens[i];
            if (token == address(0)) revert ZeroAddress();
            _snapshotERC20IfNeeded(token);
            uint256 share = _erc20ShareOf(msg.sender, token);
            if (share > 0) {
                amounts[i]                       = share;
                erc20Claimed[msg.sender][token] += share;
                IERC20(token).safeTransfer(msg.sender, share);
            }
        }

        emit AllClaimed(msg.sender, nativeShare, tokens, amounts);
    }

    // ── Emergency rescue ──────────────────────────────────────────────────────
    function rescueNative(address to, uint256 amount) external onlyOwner nonReentrant {
        if (isExpired())      revert DeadManSwitchActive();
        if (to == address(0)) revert ZeroAddress();

        // agentBudget is excluded — those funds belong to pending invocations.
        uint256 available = _mainNativeBalance();
        uint256 send      = amount == 0 ? available : amount;
        if (send == 0) return;

        emit NativeRescued(to, send);
        (bool ok, ) = to.call{value: send}("");
        if (!ok) revert TransferFailed();
    }

    function rescueERC20(address token, address to, uint256 amount) external onlyOwner nonReentrant {
        if (isExpired())                              revert DeadManSwitchActive();
        if (token == address(0) || to == address(0)) revert ZeroAddress();

        uint256 bal  = IERC20(token).balanceOf(address(this));
        uint256 send = amount == 0 ? bal : amount;
        if (send == 0) return;

        emit ERC20Rescued(to, token, send);
        IERC20(token).safeTransfer(to, send);
    }

    // ── View functions ────────────────────────────────────────────────────────
    function nextDeadlineAt() public view returns (uint256) {
        return lastHeartbeatAt + heartbeatInterval;
    }

    function graceEndsAt() public view returns (uint256) {
        return nextDeadlineAt() + gracePeriod;
    }

    function timelockEndsAt() public view returns (uint256) {
        return graceEndsAt() + timelockPeriod;
    }

    function isExpired() public view returns (bool) {
        return block.timestamp >= graceEndsAt();
    }

    function isTimelockReady() public view returns (bool) {
        return block.timestamp >= timelockEndsAt();
    }

    function canExecute(address caller) public view returns (bool) {
        return _isBeneficiary(caller) && !hasExecuted[caller] && isTimelockReady();
    }

    function getBeneficiaries() external view returns (Beneficiary[] memory) {
        return beneficiaries;
    }

    function getPendingBeneficiaries() external view returns (Beneficiary[] memory) {
        return _pendingBeneficiaries;
    }

    /// @notice How much native the caller can still claim (0 if not eligible).
    function pendingNativeClaim(address caller) external view returns (uint256) {
        if (!_isBeneficiary(caller) || !hasExecuted[caller] || globalExecutedAt == 0) return 0;
        return _nativeShareOf(caller);
    }

    function getStatus() external view returns (
        bool    expired,
        bool    timelockReady,
        bool    executed,            // true if at least one beneficiary has executed
        uint256 deadline,
        uint256 graceEnd,
        uint256 timelockEnd,
        uint256 mainBalance,         // contract balance excluding agentBudget
        uint256 agentBudgetBal,
        uint256 snapshotNative,      // frozen pot (0 before first execution)
        uint256 beneficiaryCount,
        uint256 pendingBeneCount,
        uint256 pendingBeneReadyAt,
        bool    agentConfigured,
        uint256 pendingAgentReqId,
        address currentKeeper
    ) {
        expired           = isExpired();
        timelockReady     = isTimelockReady();
        executed          = globalExecutedAt != 0;
        deadline          = nextDeadlineAt();
        graceEnd          = graceEndsAt();
        timelockEnd       = timelockEndsAt();
        mainBalance       = _mainNativeBalance();
        agentBudgetBal    = agentBudget;
        snapshotNative    = snapshotNativePot;
        beneficiaryCount  = beneficiaries.length;
        pendingBeneCount  = _pendingBeneficiaries.length;
        pendingBeneReadyAt = _pendingBeneficiaries.length > 0
            ? pendingBeneficiariesAt + BENEFICIARY_TIMELOCK : 0;
        agentConfigured   = address(agentPlatform) != address(0);
        pendingAgentReqId = pendingAgentRequestId;
        currentKeeper     = keeper;
    }

    // ── Internal helpers ──────────────────────────────────────────────────────
    function _validateDuration(uint256 d) internal pure {
        if (d < MIN_DURATION || d > MAX_DURATION) revert InvalidDuration();
    }

    function _validateBeneficiaries(Beneficiary[] memory list) internal pure {
        uint256 len = list.length;
        if (len == 0 || len > MAX_BENEFICIARIES) revert TooManyBeneficiaries();
        uint256 total;
        for (uint256 i; i < len; ++i) {
            if (list[i].addr     == address(0)) revert ZeroAddress();
            if (list[i].shareBps == 0)          revert InvalidShares();
            total += list[i].shareBps;
        }
        if (total != BPS_TOTAL) revert InvalidShares();
    }

    function _isBeneficiary(address addr) internal view returns (bool) {
        uint256 len = beneficiaries.length;
        for (uint256 i; i < len; ++i) {
            if (beneficiaries[i].addr == addr) return true;
        }
        return false;
    }

    function _shareBpsOf(address addr) internal view returns (uint256) {
        uint256 len = beneficiaries.length;
        for (uint256 i; i < len; ++i) {
            if (beneficiaries[i].addr == addr) return beneficiaries[i].shareBps;
        }
        return 0;
    }

    /**
     * @dev Native share uses the FROZEN snapshotNativePot — invariant to ordering.
     *
     *      due       = snapshotNativePot × shareBps / BPS_TOTAL
     *      claimable = due − nativeClaimed[addr]
     */
    function _nativeShareOf(address addr) internal view returns (uint256) {
        uint256 bps = _shareBpsOf(addr);
        if (bps == 0 || globalExecutedAt == 0) return 0;
        uint256 due     = (snapshotNativePot * bps) / BPS_TOTAL;
        uint256 already = nativeClaimed[addr];
        return due > already ? due - already : 0;
    }

    /**
     * @dev ERC-20 share uses per-token frozen pot.
     *      Returns 0 until the pot has been snapshotted for that token.
     */
    function _erc20ShareOf(address addr, address token) internal view returns (uint256) {
        uint256 bps = _shareBpsOf(addr);
        if (bps == 0 || !erc20PotSet[token]) return 0;
        uint256 due     = (snapshotERC20Pot[token] * bps) / BPS_TOTAL;
        uint256 already = erc20Claimed[addr][token];
        return due > already ? due - already : 0;
    }

    /// @dev Snapshot the ERC-20 pot exactly once per token (idempotent).
    function _snapshotERC20IfNeeded(address token) internal {
        if (!erc20PotSet[token]) {
            snapshotERC20Pot[token] = IERC20(token).balanceOf(address(this));
            erc20PotSet[token]      = true;
        }
    }

    /// @dev Main balance excluding agentBudget reserve.
    function _mainNativeBalance() internal view returns (uint256) {
        uint256 bal = address(this).balance;
        return bal > agentBudget ? bal - agentBudget : 0;
    }

    /// @dev Reverts if the heartbeat cannot be renewed.
    function _assertCanRenew() internal view {
        if (globalExecutedAt != 0) revert AlreadyExecuted();
        if (isExpired())           revert DeadManSwitchActive();
    }

    function _doRenew(bool byAgent) internal {
        lastHeartbeatAt = block.timestamp;
        emit HeartbeatRenewed(lastHeartbeatAt, nextDeadlineAt(), byAgent);
    }

    /// @dev Reverts if caller has not completed execution marking or timelock isn't ready.
    function _assertReadyToClaim(address caller) internal view {
        if (!isTimelockReady())    revert TimelockNotReady();
        if (!hasExecuted[caller]) revert NotExecuted();
    }
}
