// SPDX-License-Identifier: MIT
pragma solidity ^0.8.35;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title  SomniaDeadManSwitch (v5 — Somnia Reactivity Distribution)
 * @author RiskGuard contributors
 * @notice Dead-man switch releasing native + ERC-20 tokens to multiple beneficiaries
 *         (configurable share weights) after the owner stops renewing their heartbeat.
 *
 * ── What changed from v3 → v4 ─────────────────────────────────────────────────
 *
 *   NEW: Two automation paths
 *   ─────────────────────────────────
 *   Phase A (Heartbeat Agent — unchanged from v3):
 *     Owner funds agentBudget and configures heartbeatAgentId.  Only the owner
 *     or an authorised keeper may call triggerAgentHeartbeat().  On success the
 *     agent callback renews the heartbeat.
 *
 *   Phase B1 (Distribution Agent):
 *     Once isTimelockReady() becomes true, anyone (or a keeper) may call
 *     triggerDistributionAgent().  The agent callback (handleDistributionResponse)
 *     iterates every beneficiary:
 *       1. Calls _markExecutedIfNeeded(addr)  →  equivalent of markSafeExecution()
 *       2. Calls _pushNative(addr)            →  push native share, skip on failure
 *       3. Calls _pushERC20s(addr)            →  push each registered ERC-20, skip on failure
 *     Cost is deducted from agentBudget (same pot as heartbeat).
 *     Retry logic: distributionRetryCount tracks attempts; capped at MAX_DISTRIBUTION_RETRIES.
 *     Each retry skips beneficiaries already fully settled.
 *
 *   Phase B2 (Somnia On-Chain Reactivity — NEW):
 *     A one-off Schedule subscription targets timelockEndsAt().  When the system
 *     event fires, validators invoke onEvent() from the Reactivity precompile
 *     (0x0100).  The handler pushes native + registered ERC-20 funds directly,
 *     so beneficiaries do not need to submit claims at distribution time.
 *
 *   NEW: ERC-20 token registry
 *   ──────────────────────────
 *     Owner pre-registers tokens via setDistributionTokens().  The distribution
 *     agent uses this list so no token address needs to be passed at claim time.
 *     Beneficiaries can still call claimERC20(token) or claimAll(tokens[]) manually
 *     for tokens added after the distribution agent ran.
 *
 *   NEW: Push-payment pattern (replaces pull-only)
 *   ───────────────────────────────────────────────
 *     _pushNative / _pushERC20s use low-level call / safeTransfer wrapped in
 *     try-catch-style guards.  A failed push is SKIPPED (not reverted) — the
 *     beneficiary retains the right to pull manually via claimNative() / claimERC20().
 *     This matches the chosen UX: "skip on failure, don't revert batch".
 *
 *   NEW: distributionAgentId  (separate agent from heartbeatAgentId)
 *     Owner may point heartbeat and distribution to the same agentId or different ones.
 *
 * ── Timeline ──────────────────────────────────────────────────────────────────
 *   lastHeartbeatAt
 *     │── heartbeatInterval ──│── gracePeriod ──│── timelockPeriod ──│
 *     │                        │                  │                    │
 *   renewed                 deadline          graceEndsAt        timelockEndsAt
 *                                             (isExpired)        (canExecute / distribution ok)
 *
 * ── Somnia Agent platform addresses ──────────────────────────────────────────
 *   Testnet  (chain 50312): 0x037Bb9C718F3f7fe5eCBDB0b600D607b52706776
 *   Mainnet  (chain  5031): 0x5E5205CF39E766118C01636bED000A54D93163E6
 */

// ─────────────────────────────────────────────────────────────────────────────
// Somnia Agents platform types & interface (minimal subset)
// ─────────────────────────────────────────────────────────────────────────────

enum ConsensusType {
    Majority,
    Threshold
}
enum ResponseStatus {
    None,
    Pending,
    Success,
    Failed,
    TimedOut
}

struct Response {
    address validator;
    bytes result;
    ResponseStatus status;
    uint256 receipt;
    uint256 timestamp;
    uint256 executionCost;
}

struct AgentRequest {
    uint256 id;
    address requester;
    address callbackAddress;
    bytes4 callbackSelector;
    address[] subcommittee;
    Response[] responses;
    uint256 responseCount;
    uint256 failureCount;
    uint256 threshold;
    uint256 createdAt;
    uint256 deadline;
    ResponseStatus status;
    ConsensusType consensusType;
    uint256 remainingBudget;
    uint256 perAgentBudget;
}

interface IAgentRequester {
    function createRequest(
        uint256 agentId,
        address callbackAddress,
        bytes4 callbackSelector,
        bytes calldata payload
    ) external payable returns (uint256 requestId);

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
    error NotAuthorized();
    error ZeroAddress();
    error InvalidDuration();
    error TimelockNotReady();
    error AlreadyExecuted();
    error NotExecuted();
    error DeadManSwitchActive();
    error NoPendingBeneficiaries();
    error BeneficiaryTimelockNotReady();
    error TransferFailed();
    error SameAddress();
    error InvalidShares();
    error TooManyBeneficiaries();
    error AgentNotConfigured();
    error AgentBudgetInsufficient();
    error AgentRequestPending();
    error OnlyAgentPlatform();
    error OnlyReactivityPrecompile();
    error UnknownAgentRequest();
    error DistributionNotReady();
    error MaxRetriesReached();
    error TooManyTokens();

    // ── Constants ─────────────────────────────────────────────────────────────
    uint256 public constant MAX_DURATION = 3650 days;
    uint256 public constant MIN_HEARTBEAT_DURATION = 1 days;
    uint256 public constant MIN_DELAY_DURATION = 0;
    uint256 public constant BENEFICIARY_TIMELOCK = 2 days;
    uint256 public constant BPS_TOTAL = 10_000;
    uint256 public constant MAX_BENEFICIARIES = 20;
    uint256 public constant MAX_DISTRIBUTION_TOKENS = 30;
    uint256 public constant AGENT_SUBCOMMITTEE_SIZE = 3;
    uint256 public constant MAX_DISTRIBUTION_RETRIES = 3;
    address public constant SOMNIA_REACTIVITY_PRECOMPILE =
        address(0x0000000000000000000000000000000000000100);

    // ── Structs ───────────────────────────────────────────────────────────────
    struct Beneficiary {
        address addr;
        uint256 shareBps;
    }

    // ── State: ownership ──────────────────────────────────────────────────────
    address public owner;
    address public pendingOwner;

    // ── State: keeper ─────────────────────────────────────────────────────────
    address public keeper;

    // ── State: beneficiaries ──────────────────────────────────────────────────
    Beneficiary[] public beneficiaries;
    Beneficiary[] internal _pendingBeneficiaries;
    uint256 public pendingBeneficiariesAt;

    uint256 public globalExecutedAt;
    uint256 public snapshotNativePot;

    mapping(address => uint256) public snapshotERC20Pot;
    mapping(address => bool) public erc20PotSet;
    mapping(address => bool) public hasExecuted;
    mapping(address => uint256) public nativeClaimed;
    mapping(address => mapping(address => uint256)) public erc20Claimed;

    // ── State: ERC-20 distribution registry ───────────────────────────────────
    /// @notice Tokens that the distribution agent will auto-push to beneficiaries.
    ///         Owner sets this list before the switch expires.
    address[] public distributionTokens;

    // ── State: heartbeat ──────────────────────────────────────────────────────
    uint256 public heartbeatInterval;
    uint256 public gracePeriod;
    uint256 public timelockPeriod;
    uint256 public lastHeartbeatAt;

    // ── State: Somnia Agent (heartbeat) ───────────────────────────────────────
    IAgentRequester public agentPlatform;
    uint256 public heartbeatAgentId;
    uint256 public agentRewardPerCall = 0.01 ether;
    uint256 public agentBudget;
    uint256 public pendingAgentRequestId;

    // ── State: Somnia Agent (distribution — NEW) ──────────────────────────────
    /// @notice Agent ID used for the distribution phase.
    ///         Owner may set this to the same value as heartbeatAgentId or a different one.
    uint256 public distributionAgentId;

    /// @notice requestId of a currently-pending distribution request (0 = none pending).
    uint256 public pendingDistributionRequestId;

    /// @notice How many times the distribution agent has been triggered.
    ///         Capped at MAX_DISTRIBUTION_RETRIES.
    uint256 public distributionRetryCount;

    /// @notice True once all beneficiaries have been fully settled (native + all tokens).
    bool public distributionComplete;

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
    event AllClaimed(
        address indexed beneficiary, uint256 nativeAmount, address[] tokens, uint256[] amounts
    );
    event NativeRescued(address indexed to, uint256 amount);
    event ERC20Rescued(address indexed to, address indexed token, uint256 amount);
    event AgentConfigured(
        address indexed platform, uint256 heartbeatAgentId, uint256 distributionAgentId
    );
    event AgentBudgetFunded(uint256 amount, uint256 total);
    event AgentRewardPerCallUpdated(uint256 newReward);
    event AgentHeartbeatRequested(uint256 indexed requestId, address indexed triggeredBy);
    event AgentHeartbeatSucceeded(uint256 indexed requestId);
    event AgentHeartbeatFailed(uint256 indexed requestId, ResponseStatus status);

    // Distribution-specific events (NEW)
    event DistributionTokensSet(address[] tokens);
    event DistributionAgentRequested(
        uint256 indexed requestId, address indexed triggeredBy, uint256 retryCount
    );
    event DistributionAgentSucceeded(uint256 indexed requestId, uint256 settledCount);
    event DistributionAgentFailed(uint256 indexed requestId, ResponseStatus status);
    event DistributionPushNativeSkipped(address indexed beneficiary, string reason);
    event DistributionPushERC20Skipped(
        address indexed beneficiary, address indexed token, string reason
    );
    event ReactiveDistributionSkipped(address indexed emitter, string reason);
    event ReactiveDistributionSucceeded(uint256 settledCount);
    event DistributionComplete();

    // ── Constructor ───────────────────────────────────────────────────────────
    constructor(
        address initialOwner,
        Beneficiary[] memory initialBeneficiaries,
        uint256 initialHeartbeatInterval,
        uint256 initialGracePeriod,
        uint256 initialTimelockPeriod
    ) {
        if (initialOwner == address(0)) revert ZeroAddress();
        _validateBeneficiaries(initialBeneficiaries, initialOwner);
        _validateHeartbeatDuration(initialHeartbeatInterval);
        _validateDelayDuration(initialGracePeriod);
        _validateDelayDuration(initialTimelockPeriod);

        owner = initialOwner;
        heartbeatInterval = initialHeartbeatInterval;
        gracePeriod = initialGracePeriod;
        timelockPeriod = initialTimelockPeriod;
        lastHeartbeatAt = block.timestamp;

        uint256 len = initialBeneficiaries.length;
        for (uint256 i; i < len; ++i) {
            beneficiaries.push(initialBeneficiaries[i]);
        }

        emit ContractInitialized(
            initialOwner, initialHeartbeatInterval, initialGracePeriod, initialTimelockPeriod
        );
    }

    // ── Receive ───────────────────────────────────────────────────────────────
    receive() external payable {
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

    modifier onlyAuthorized() {
        if (msg.sender != owner && msg.sender != keeper) revert NotAuthorized();
        _;
    }

    modifier onlyReactivityPrecompile() {
        if (msg.sender != SOMNIA_REACTIVITY_PRECOMPILE) revert OnlyReactivityPrecompile();
        _;
    }

    // ── Ownership (2-step) ────────────────────────────────────────────────────
    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert ZeroAddress();
        if (newOwner == owner) revert SameAddress();
        pendingOwner = newOwner;
        emit OwnershipTransferStarted(owner, newOwner);
    }

    function acceptOwnership() external {
        if (msg.sender != pendingOwner) revert NotPendingOwner();
        address previous = owner;
        owner = pendingOwner;
        pendingOwner = address(0);
        emit OwnershipTransferred(previous, owner);
    }

    // ── Keeper management ─────────────────────────────────────────────────────
    function setKeeper(address newKeeper) external onlyOwner {
        keeper = newKeeper;
        emit KeeperSet(newKeeper);
    }

    // ── ERC-20 distribution registry (NEW) ────────────────────────────────────
    /**
     * @notice Set the list of ERC-20 tokens the distribution agent will auto-push.
     *         Call this before the heartbeat expires so everything is ready.
     * @param  tokens  Array of ERC-20 contract addresses (max MAX_DISTRIBUTION_TOKENS).
     */
    function setDistributionTokens(address[] calldata tokens) external onlyOwner {
        if (tokens.length > MAX_DISTRIBUTION_TOKENS) revert TooManyTokens();
        delete distributionTokens;
        for (uint256 i; i < tokens.length; ++i) {
            if (tokens[i] == address(0)) revert ZeroAddress();
            distributionTokens.push(tokens[i]);
        }
        emit DistributionTokensSet(tokens);
    }

    function getDistributionTokens() external view returns (address[] memory) {
        return distributionTokens;
    }

    // ── Multi-beneficiary management (2-step timelock) ────────────────────────
    function proposeBeneficiaries(Beneficiary[] calldata next) external onlyOwner {
        if (isExpired()) revert DeadManSwitchActive();
        _validateBeneficiaries(next, owner);

        delete _pendingBeneficiaries;
        for (uint256 i; i < next.length; ++i) {
            _pendingBeneficiaries.push(next[i]);
        }
        pendingBeneficiariesAt = block.timestamp;
        emit BeneficiariesChangeProposed(block.timestamp + BENEFICIARY_TIMELOCK);
    }

    function confirmBeneficiaries() external onlyOwner {
        if (_pendingBeneficiaries.length == 0) revert NoPendingBeneficiaries();
        if (block.timestamp < pendingBeneficiariesAt + BENEFICIARY_TIMELOCK) {
            revert BeneficiaryTimelockNotReady();
        }
        if (isExpired()) revert DeadManSwitchActive();

        delete beneficiaries;
        for (uint256 i; i < _pendingBeneficiaries.length; ++i) {
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
     * @notice Configure the Somnia Agents platform, heartbeat agent, and distribution agent.
     * @param  platform           IAgentRequester contract address.
     * @param  _heartbeatAgentId  Agent ID used for heartbeat renewal.
     * @param  _distributionAgentId Agent ID used for auto-distribution (may equal _heartbeatAgentId).
     */
    function configureAgent(
        address platform,
        uint256 _heartbeatAgentId,
        uint256 _distributionAgentId
    ) external onlyOwner {
        if (platform == address(0)) revert ZeroAddress();
        agentPlatform = IAgentRequester(platform);
        heartbeatAgentId = _heartbeatAgentId;
        distributionAgentId = _distributionAgentId;
        emit AgentConfigured(platform, _heartbeatAgentId, _distributionAgentId);
    }

    function fundAgentBudget() external payable onlyOwner {
        agentBudget += msg.value;
        emit AgentBudgetFunded(msg.value, agentBudget);
    }

    function setAgentRewardPerCall(uint256 reward) external onlyOwner {
        agentRewardPerCall = reward;
        emit AgentRewardPerCallUpdated(reward);
    }

    // ── Heartbeat ─────────────────────────────────────────────────────────────
    function renewHeartbeat() external onlyOwner nonReentrant {
        _assertCanRenew();
        _doRenew(false);
    }

    function triggerAgentHeartbeat() external onlyAuthorized nonReentrant {
        if (address(agentPlatform) == address(0)) revert AgentNotConfigured();
        _assertCanRenew();
        if (pendingAgentRequestId != 0) revert AgentRequestPending();

        uint256 deposit = _agentDeposit();
        if (agentBudget < deposit) revert AgentBudgetInsufficient();
        agentBudget -= deposit;

        uint256 requestId = agentPlatform.createRequest{ value: deposit }(
            heartbeatAgentId,
            address(this),
            this.handleHeartbeatResponse.selector,
            abi.encode(block.timestamp)
        );

        pendingAgentRequestId = requestId;
        emit AgentHeartbeatRequested(requestId, msg.sender);
    }

    function handleHeartbeatResponse(
        uint256 requestId,
        Response[] memory responses,
        ResponseStatus status,
        AgentRequest memory
    ) external nonReentrant {
        if (msg.sender != address(agentPlatform)) revert OnlyAgentPlatform();
        if (requestId != pendingAgentRequestId) revert UnknownAgentRequest();

        pendingAgentRequestId = 0;

        if (status == ResponseStatus.Success && responses.length > 0) {
            if (!isExpired() && globalExecutedAt == 0) {
                _doRenew(true);
            }
            emit AgentHeartbeatSucceeded(requestId);
        } else {
            emit AgentHeartbeatFailed(requestId, status);
        }
    }

    // ── Distribution Agent (NEW) ───────────────────────────────────────────────

    /**
     * @notice Trigger the distribution agent once the timelock has elapsed.
     *         Callable by owner, keeper, OR any address — permissionless after timelock
     *         because at this point the owner is presumed gone and the switch is active.
     *         Cost is drawn from agentBudget.
     *
     * @dev    Retry up to MAX_DISTRIBUTION_RETRIES times.  Each attempt instructs the
     *         agent to iterate the full beneficiary list; already-settled entries are
     *         cheaply skipped inside handleDistributionResponse.
     */
    function triggerDistributionAgent() external nonReentrant {
        if (!isTimelockReady()) revert DistributionNotReady();
        if (distributionComplete) revert AlreadyExecuted();
        if (address(agentPlatform) == address(0)) revert AgentNotConfigured();
        if (pendingDistributionRequestId != 0) revert AgentRequestPending();
        if (distributionRetryCount >= MAX_DISTRIBUTION_RETRIES) revert MaxRetriesReached();

        uint256 deposit = _agentDeposit();
        if (agentBudget < deposit) revert AgentBudgetInsufficient();
        agentBudget -= deposit;

        // Payload: encode beneficiary addresses + registered tokens for off-chain audit.
        // The agent callback ignores payload and reads state directly via view calls.
        bytes memory payload = abi.encode(block.timestamp, distributionRetryCount);

        uint256 requestId = agentPlatform.createRequest{ value: deposit }(
            distributionAgentId, address(this), this.handleDistributionResponse.selector, payload
        );

        pendingDistributionRequestId = requestId;
        emit DistributionAgentRequested(requestId, msg.sender, distributionRetryCount);
    }

    /**
     * @notice Somnia Agents callback for the distribution phase.
     * @dev    On Success: iterates every beneficiary, marks execution and pushes funds.
     *         Failed pushes are skipped (not reverted) — beneficiary can still pull.
     *         On Failure/TimedOut: clears slot so retry is possible.
     */
    function handleDistributionResponse(
        uint256 requestId,
        Response[] memory responses,
        ResponseStatus status,
        AgentRequest memory
    ) external nonReentrant {
        if (msg.sender != address(agentPlatform)) revert OnlyAgentPlatform();
        if (requestId != pendingDistributionRequestId) revert UnknownAgentRequest();

        // Always clear the pending slot.
        pendingDistributionRequestId = 0;
        distributionRetryCount += 1;

        if (status != ResponseStatus.Success || responses.length == 0) {
            emit DistributionAgentFailed(requestId, status);
            return;
        }

        // ── Snapshot native pot exactly once ─────────────────────────────────
        if (globalExecutedAt == 0) {
            globalExecutedAt = block.timestamp;
            snapshotNativePot = _mainNativeBalance();
        }

        uint256 settled = 0;
        uint256 bLen = beneficiaries.length;
        address[] memory tokens = distributionTokens;

        for (uint256 i; i < bLen; ++i) {
            address ben = beneficiaries[i].addr;

            // Mark execution for this beneficiary if not yet done.
            if (!hasExecuted[ben]) {
                hasExecuted[ben] = true;
                emit SafeExecutionMarked(ben, block.timestamp);
            }

            // Push native share.
            _pushNative(ben);

            // Push each registered ERC-20.
            for (uint256 t; t < tokens.length; ++t) {
                _pushERC20(ben, tokens[t]);
            }

            settled += 1;
        }

        // Check if fully complete (all beneficiaries have been settled at least once).
        // "Complete" means every beneficiary has been marked + native has been pushed.
        // ERC-20 residuals from future deposits can still be claimed manually.
        bool allDone = _allBeneficiariesSettled(tokens);
        if (allDone) {
            distributionComplete = true;
            emit DistributionComplete();
        }

        emit DistributionAgentSucceeded(requestId, settled);
    }

    /**
     * @notice Somnia on-chain Reactivity handler.
     * @dev Configure a one-off Schedule subscription for timelockEndsAt() * 1000
     *      with this contract as the handler. Validators invoke this through the
     *      Reactivity precompile when the scheduled system event fires.
     */
    function onEvent(address emitter, bytes32[] calldata, bytes calldata)
        external
        onlyReactivityPrecompile
        nonReentrant
    {
        if (emitter != SOMNIA_REACTIVITY_PRECOMPILE) {
            emit ReactiveDistributionSkipped(emitter, "non-system event");
            return;
        }
        if (!isTimelockReady()) {
            emit ReactiveDistributionSkipped(emitter, "timelock not ready");
            return;
        }
        if (distributionComplete) {
            emit ReactiveDistributionSkipped(emitter, "distribution complete");
            return;
        }

        uint256 settled = _executeDistribution();
        emit ReactiveDistributionSucceeded(settled);
    }

    // ── Manual execution marking (per beneficiary — still available) ──────────
    /**
     * @notice Beneficiary can still self-execute in case the agent budget is exhausted
     *         or they prefer not to wait.
     */
    function markSafeExecution() external onlyBeneficiary nonReentrant {
        if (hasExecuted[msg.sender]) revert AlreadyExecuted();
        if (!isTimelockReady()) revert TimelockNotReady();

        hasExecuted[msg.sender] = true;

        if (globalExecutedAt == 0) {
            globalExecutedAt = block.timestamp;
            snapshotNativePot = _mainNativeBalance();
        }

        emit SafeExecutionMarked(msg.sender, block.timestamp);
    }

    // ── Manual claim functions (still available as fallback) ──────────────────
    function claimNative() external onlyBeneficiary nonReentrant {
        _assertReadyToClaim(msg.sender);
        uint256 share = _nativeShareOf(msg.sender);
        if (share == 0) return;
        nativeClaimed[msg.sender] += share;
        emit NativeClaimed(msg.sender, share);
        (bool ok,) = msg.sender.call{ value: share }("");
        if (!ok) revert TransferFailed();
    }

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

    function claimAll(address[] calldata tokens) external onlyBeneficiary nonReentrant {
        _assertReadyToClaim(msg.sender);

        uint256 nativeShare = _nativeShareOf(msg.sender);
        if (nativeShare > 0) {
            nativeClaimed[msg.sender] += nativeShare;
            (bool ok,) = msg.sender.call{ value: nativeShare }("");
            if (!ok) revert TransferFailed();
        }

        uint256 len = tokens.length;
        uint256[] memory amounts = new uint256[](len);
        for (uint256 i; i < len; ++i) {
            address token = tokens[i];
            if (token == address(0)) revert ZeroAddress();
            _snapshotERC20IfNeeded(token);
            uint256 share = _erc20ShareOf(msg.sender, token);
            if (share > 0) {
                amounts[i] = share;
                erc20Claimed[msg.sender][token] += share;
                IERC20(token).safeTransfer(msg.sender, share);
            }
        }

        emit AllClaimed(msg.sender, nativeShare, tokens, amounts);
    }

    // ── Emergency rescue ──────────────────────────────────────────────────────
    function rescueNative(address to, uint256 amount) external onlyOwner nonReentrant {
        if (isExpired()) revert DeadManSwitchActive();
        if (to == address(0)) revert ZeroAddress();
        uint256 available = _mainNativeBalance();
        uint256 send = amount == 0 ? available : amount;
        if (send == 0) return;
        emit NativeRescued(to, send);
        (bool ok,) = to.call{ value: send }("");
        if (!ok) revert TransferFailed();
    }

    function rescueERC20(address token, address to, uint256 amount)
        external
        onlyOwner
        nonReentrant
    {
        if (isExpired()) revert DeadManSwitchActive();
        if (token == address(0) || to == address(0)) revert ZeroAddress();
        uint256 bal = IERC20(token).balanceOf(address(this));
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

    function distributionScheduleTimestampMs() public view returns (uint256) {
        return timelockEndsAt() * 1000;
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

    function pendingNativeClaim(address caller) external view returns (uint256) {
        if (!_isBeneficiary(caller) || !hasExecuted[caller] || globalExecutedAt == 0) return 0;
        return _nativeShareOf(caller);
    }

    /**
     * @notice Returns true if distribution can be triggered right now.
     */
    function canTriggerDistribution() external view returns (bool) {
        return isTimelockReady() && !distributionComplete && address(agentPlatform) != address(0)
            && pendingDistributionRequestId == 0
            && distributionRetryCount < MAX_DISTRIBUTION_RETRIES && agentBudget >= _agentDeposit();
    }

    function canReactiveDistribute() external view returns (bool) {
        return isTimelockReady() && !distributionComplete;
    }

    function getStatus()
        external
        view
        returns (
            bool expired,
            bool timelockReady,
            bool executed,
            uint256 deadline,
            uint256 graceEnd,
            uint256 timelockEnd,
            uint256 mainBalance,
            uint256 agentBudgetBal,
            uint256 snapshotNative,
            uint256 beneficiaryCount,
            uint256 pendingBeneCount,
            uint256 pendingBeneReadyAt,
            bool agentConfigured,
            uint256 pendingAgentReqId,
            address currentKeeper,
            // Distribution fields (NEW)
            bool distComplete,
            uint256 distRetryCount,
            uint256 pendingDistReqId,
            uint256 distTokenCount
        )
    {
        expired = isExpired();
        timelockReady = isTimelockReady();
        executed = globalExecutedAt != 0;
        deadline = nextDeadlineAt();
        graceEnd = graceEndsAt();
        timelockEnd = timelockEndsAt();
        mainBalance = _mainNativeBalance();
        agentBudgetBal = agentBudget;
        snapshotNative = snapshotNativePot;
        beneficiaryCount = beneficiaries.length;
        pendingBeneCount = _pendingBeneficiaries.length;
        pendingBeneReadyAt =
            _pendingBeneficiaries.length > 0 ? pendingBeneficiariesAt + BENEFICIARY_TIMELOCK : 0;
        agentConfigured = address(agentPlatform) != address(0);
        pendingAgentReqId = pendingAgentRequestId;
        currentKeeper = keeper;
        distComplete = distributionComplete;
        distRetryCount = distributionRetryCount;
        pendingDistReqId = pendingDistributionRequestId;
        distTokenCount = distributionTokens.length;
    }

    // ── Internal helpers ──────────────────────────────────────────────────────
    function _validateHeartbeatDuration(uint256 d) internal pure {
        if (d < MIN_HEARTBEAT_DURATION || d > MAX_DURATION) revert InvalidDuration();
    }

    function _validateDelayDuration(uint256 d) internal pure {
        // Testnet automation needs grace=0 and timelock=0 so a missed 1-day
        // heartbeat can distribute immediately. Tighten this minimum again once
        // production timing, UX warnings, and recovery windows are stable.
        if (d < MIN_DELAY_DURATION || d > MAX_DURATION) revert InvalidDuration();
    }

    function _validateBeneficiaries(Beneficiary[] memory list, address ownerAddress) internal pure {
        uint256 len = list.length;
        if (len == 0 || len > MAX_BENEFICIARIES) revert TooManyBeneficiaries();
        uint256 total;
        for (uint256 i; i < len; ++i) {
            if (list[i].addr == address(0)) revert ZeroAddress();
            if (list[i].addr == ownerAddress) revert SameAddress();
            if (list[i].shareBps == 0) revert InvalidShares();
            for (uint256 j = i + 1; j < len; ++j) {
                if (list[i].addr == list[j].addr) revert SameAddress();
            }
            total += list[i].shareBps;
        }
        if (total != BPS_TOTAL) revert InvalidShares();
    }

    function _isBeneficiary(address addr) internal view returns (bool) {
        for (uint256 i; i < beneficiaries.length; ++i) {
            if (beneficiaries[i].addr == addr) return true;
        }
        return false;
    }

    function _shareBpsOf(address addr) internal view returns (uint256) {
        for (uint256 i; i < beneficiaries.length; ++i) {
            if (beneficiaries[i].addr == addr) return beneficiaries[i].shareBps;
        }
        return 0;
    }

    function _nativeShareOf(address addr) internal view returns (uint256) {
        uint256 bps = _shareBpsOf(addr);
        if (bps == 0 || globalExecutedAt == 0) return 0;
        uint256 due = (snapshotNativePot * bps) / BPS_TOTAL;
        uint256 already = nativeClaimed[addr];
        return due > already ? due - already : 0;
    }

    function _erc20ShareOf(address addr, address token) internal view returns (uint256) {
        uint256 bps = _shareBpsOf(addr);
        if (bps == 0 || !erc20PotSet[token]) return 0;
        uint256 due = (snapshotERC20Pot[token] * bps) / BPS_TOTAL;
        uint256 already = erc20Claimed[addr][token];
        return due > already ? due - already : 0;
    }

    function _snapshotERC20IfNeeded(address token) internal {
        if (!erc20PotSet[token]) {
            snapshotERC20Pot[token] = IERC20(token).balanceOf(address(this));
            erc20PotSet[token] = true;
        }
    }

    function _trySnapshotERC20IfNeeded(address token) internal returns (bool) {
        if (erc20PotSet[token]) return true;

        try IERC20(token).balanceOf(address(this)) returns (uint256 balance) {
            snapshotERC20Pot[token] = balance;
            erc20PotSet[token] = true;
            return true;
        } catch {
            emit DistributionPushERC20Skipped(address(0), token, "balanceOf reverted");
            return false;
        }
    }

    function _mainNativeBalance() internal view returns (uint256) {
        uint256 bal = address(this).balance;
        return bal > agentBudget ? bal - agentBudget : 0;
    }

    function _agentDeposit() internal view returns (uint256) {
        uint256 floor = agentPlatform.getRequestDeposit();
        uint256 reward = agentRewardPerCall * AGENT_SUBCOMMITTEE_SIZE;
        return floor + reward;
    }

    function _assertCanRenew() internal view {
        if (globalExecutedAt != 0) revert AlreadyExecuted();
        if (isExpired()) revert DeadManSwitchActive();
    }

    function _doRenew(bool byAgent) internal {
        lastHeartbeatAt = block.timestamp;
        emit HeartbeatRenewed(lastHeartbeatAt, nextDeadlineAt(), byAgent);
    }

    function _assertReadyToClaim(address caller) internal view {
        if (!isTimelockReady()) revert TimelockNotReady();
        if (!hasExecuted[caller]) revert NotExecuted();
    }

    function _executeDistribution() internal returns (uint256 settled) {
        if (globalExecutedAt == 0) {
            globalExecutedAt = block.timestamp;
            snapshotNativePot = _mainNativeBalance();
        }

        uint256 bLen = beneficiaries.length;
        address[] memory tokens = distributionTokens;

        for (uint256 i; i < bLen; ++i) {
            address ben = beneficiaries[i].addr;
            if (!hasExecuted[ben]) {
                hasExecuted[ben] = true;
                emit SafeExecutionMarked(ben, block.timestamp);
            }

            _pushNative(ben);

            for (uint256 t; t < tokens.length; ++t) {
                _pushERC20(ben, tokens[t]);
            }

            settled += 1;
        }

        if (_allBeneficiariesSettled(tokens)) {
            distributionComplete = true;
            emit DistributionComplete();
        }
    }

    /**
     * @dev Push native share to a beneficiary. Skips (does NOT revert) on failure.
     *      Beneficiary retains the right to call claimNative() manually.
     */
    function _pushNative(address ben) internal {
        uint256 share = _nativeShareOf(ben);
        if (share == 0) return;

        nativeClaimed[ben] += share;
        // solhint-disable-next-line avoid-low-level-calls
        (bool ok,) = ben.call{ value: share }("");
        if (!ok) {
            // Revert the accounting update — beneficiary must pull manually.
            nativeClaimed[ben] -= share;
            emit DistributionPushNativeSkipped(ben, "transfer failed");
        } else {
            emit NativeClaimed(ben, share);
        }
    }

    /**
     * @dev Push a single ERC-20 token share to a beneficiary. Skips on failure.
     */
    function _pushERC20(address ben, address token) internal {
        if (!_trySnapshotERC20IfNeeded(token)) return;
        uint256 share = _erc20ShareOf(ben, token);
        if (share == 0) return;

        erc20Claimed[ben][token] += share;
        try IERC20(token).transfer(ben, share) returns (bool ok) {
            if (!ok) {
                erc20Claimed[ben][token] -= share;
                emit DistributionPushERC20Skipped(ben, token, "transfer returned false");
            } else {
                emit ERC20Claimed(ben, token, share);
            }
        } catch {
            erc20Claimed[ben][token] -= share;
            emit DistributionPushERC20Skipped(ben, token, "transfer reverted");
        }
    }

    /**
     * @dev Returns true when every beneficiary has been marked AND has zero remaining
     *      native claim AND zero remaining claim for every registered token.
     */
    function _allBeneficiariesSettled(address[] memory tokens) internal view returns (bool) {
        for (uint256 i; i < beneficiaries.length; ++i) {
            address ben = beneficiaries[i].addr;
            if (!hasExecuted[ben]) return false;
            if (_nativeShareOf(ben) > 0) return false;
            for (uint256 t; t < tokens.length; ++t) {
                if (_erc20ShareOf(ben, tokens[t]) > 0) return false;
            }
        }
        return true;
    }
}
