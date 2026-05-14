// SPDX-License-Identifier: MIT
pragma solidity ^0.8.35;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title  SomniaDeadManSwitch
 * @author RiskGuard contributors
 * @notice A dead-man switch that releases native token and ERC-20 tokens to a beneficiary
 *         after the owner stops renewing their heartbeat for a configurable period.
 *
 * Timeline per heartbeat:
 *
 *   lastHeartbeatAt
 *        │── heartbeatInterval ──│── gracePeriod ──│── timelockPeriod ──│
 *        │                       │                  │                    │
 *     renewed                deadline          graceEndsAt         timelockEndsAt
 *                                              (isExpired)         (canExecute)
 *
 * Key properties
 * ──────────────
 * • Owner can renew heartbeat only while NOT expired.
 * • Changing beneficiary requires a 2-step timelock.
 * • Owner transfer is 2-step to prevent accidental lock-out.
 * • Funds (Native + arbitrary ERC-20s) are held in this contract.
 * • claimNative / claimERC20 / claimAll enforce BOTH timelock AND executed checks.
 * • ReentrancyGuard on all state-changing functions.
 * • Emergency rescue by owner while switch is NOT expired.
 *
 * Timestamp note
 * ──────────────
 * All time checks rely on block.timestamp. Validators can skew this slightly.
 * All duration parameters MUST be ≥ MIN_DURATION (1 day) in production.
 */
contract SomniaDeadManSwitch is ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ─────────────────────────────────────────────────────────────────────────
    // Errors
    // ─────────────────────────────────────────────────────────────────────────
    error NotOwner();
    error NotPendingOwner();
    error NotBeneficiary();
    error ZeroAddress();
    error InvalidDuration();
    error TimelockNotReady();
    error AlreadyExecuted();
    error NotExecuted();
    error DeadManSwitchActive();
    error NoPendingBeneficiary();
    error BeneficiaryTimelockNotReady();
    error TransferFailed();
    error SameAddress();

    // ─────────────────────────────────────────────────────────────────────────
    // Constants
    // ─────────────────────────────────────────────────────────────────────────
    uint256 public constant MAX_DURATION = 3650 days;
    uint256 public constant MIN_DURATION = 1 days;
    uint256 public constant BENEFICIARY_TIMELOCK = 2 days;

    // ─────────────────────────────────────────────────────────────────────────
    // State
    // ─────────────────────────────────────────────────────────────────────────
    address public owner;
    address public pendingOwner;

    address public beneficiary;
    address public pendingBeneficiary;
    uint256 public pendingBeneficiaryAt;

    uint256 public heartbeatInterval;
    uint256 public gracePeriod;
    uint256 public timelockPeriod;

    uint256 public lastHeartbeatAt;
    uint256 public executedAt;

    // ─────────────────────────────────────────────────────────────────────────
    // Events
    // ─────────────────────────────────────────────────────────────────────────
    event ContractInitialized(
        address indexed owner,
        address indexed beneficiary,
        uint256 heartbeatInterval,
        uint256 gracePeriod,
        uint256 timelockPeriod
    );

    event OwnershipTransferStarted(address indexed currentOwner, address indexed pendingOwner);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    event BeneficiaryChangeProposed(address indexed proposedBeneficiary, uint256 effectiveAt);
    event BeneficiaryChangeConfirmed(address indexed oldBeneficiary, address indexed newBeneficiary);
    event BeneficiaryChangeCancelled(address indexed cancelledBeneficiary);

    event HeartbeatRenewed(uint256 lastHeartbeatAt, uint256 nextDeadlineAt);
    event SafeExecutionMarked(address indexed beneficiary, uint256 executedAt);

    event NativeReceived(address indexed sender, uint256 amount);
    event NativeClaimed(address indexed beneficiary, uint256 amount);
    event ERC20Claimed(address indexed beneficiary, address indexed token, uint256 amount);
    event AllClaimed(address indexed beneficiary, uint256 nativeAmount, address[] tokens, uint256[] amounts);
    event NativeRescued(address indexed to, uint256 amount);
    event ERC20Rescued(address indexed to, address indexed token, uint256 amount);

    // ─────────────────────────────────────────────────────────────────────────
    // Constructor
    // ─────────────────────────────────────────────────────────────────────────
    constructor(
        address initialOwner,
        address initialBeneficiary,
        uint256 initialHeartbeatInterval,
        uint256 initialGracePeriod,
        uint256 initialTimelockPeriod
    ) {
        if (initialOwner == address(0) || initialBeneficiary == address(0)) {
            revert ZeroAddress();
        }
        _validateDuration(initialHeartbeatInterval);
        _validateDuration(initialGracePeriod);
        _validateDuration(initialTimelockPeriod);

        owner = initialOwner;
        beneficiary = initialBeneficiary;
        heartbeatInterval = initialHeartbeatInterval;
        gracePeriod = initialGracePeriod;
        timelockPeriod = initialTimelockPeriod;
        lastHeartbeatAt = block.timestamp;

        emit ContractInitialized(
            initialOwner,
            initialBeneficiary,
            initialHeartbeatInterval,
            initialGracePeriod,
            initialTimelockPeriod
        );
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Receive Native Token
    // ─────────────────────────────────────────────────────────────────────────
    receive() external payable {
        emit NativeReceived(msg.sender, msg.value);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Modifiers
    // ─────────────────────────────────────────────────────────────────────────
    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyBeneficiary() {
        if (msg.sender != beneficiary) revert NotBeneficiary();
        _;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Ownership + Beneficiary (2-step)
    // ─────────────────────────────────────────────────────────────────────────
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

    function proposeBeneficiary(address nextBeneficiary) external onlyOwner {
        if (nextBeneficiary == address(0)) revert ZeroAddress();
        if (nextBeneficiary == beneficiary) revert SameAddress();
        if (isExpired()) revert DeadManSwitchActive();

        pendingBeneficiary = nextBeneficiary;
        pendingBeneficiaryAt = block.timestamp;
        emit BeneficiaryChangeProposed(nextBeneficiary, block.timestamp + BENEFICIARY_TIMELOCK);
    }

    function confirmBeneficiary() external onlyOwner {
        if (pendingBeneficiary == address(0)) revert NoPendingBeneficiary();
        if (block.timestamp < pendingBeneficiaryAt + BENEFICIARY_TIMELOCK) {
            revert BeneficiaryTimelockNotReady();
        }
        if (isExpired()) revert DeadManSwitchActive();

        address old = beneficiary;
        beneficiary = pendingBeneficiary;
        pendingBeneficiary = address(0);
        pendingBeneficiaryAt = 0;

        emit BeneficiaryChangeConfirmed(old, beneficiary);
    }

    function cancelBeneficiaryChange() external onlyOwner {
        if (pendingBeneficiary == address(0)) revert NoPendingBeneficiary();
        address cancelled = pendingBeneficiary;
        pendingBeneficiary = address(0);
        pendingBeneficiaryAt = 0;
        emit BeneficiaryChangeCancelled(cancelled);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Heartbeat & Execution
    // ─────────────────────────────────────────────────────────────────────────
    function renewHeartbeat() external onlyOwner nonReentrant {
        if (executedAt != 0) revert AlreadyExecuted();
        if (isExpired()) revert DeadManSwitchActive();

        lastHeartbeatAt = block.timestamp;
        emit HeartbeatRenewed(lastHeartbeatAt, nextDeadlineAt());
    }

    function markSafeExecution() external onlyBeneficiary nonReentrant {
        if (executedAt != 0) revert AlreadyExecuted();
        if (!isTimelockReady()) revert TimelockNotReady();

        executedAt = block.timestamp;
        emit SafeExecutionMarked(msg.sender, executedAt);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Claim Functions
    // ─────────────────────────────────────────────────────────────────────────
    function claimNative() external onlyBeneficiary nonReentrant {
        if (!isTimelockReady()) revert TimelockNotReady();
        if (executedAt == 0) revert NotExecuted();

        uint256 amount = address(this).balance;
        if (amount == 0) return;

        emit NativeClaimed(msg.sender, amount);
        (bool ok, ) = msg.sender.call{value: amount}("");
        if (!ok) revert TransferFailed();
    }

    function claimERC20(address token) external onlyBeneficiary nonReentrant {
        if (!isTimelockReady()) revert TimelockNotReady();
        if (executedAt == 0) revert NotExecuted();
        if (token == address(0)) revert ZeroAddress();

        uint256 amount = IERC20(token).balanceOf(address(this));
        if (amount == 0) return;

        emit ERC20Claimed(msg.sender, token, amount);
        IERC20(token).safeTransfer(msg.sender, amount);
    }

    function claimAll(address[] calldata tokens) external onlyBeneficiary nonReentrant {
        if (!isTimelockReady()) revert TimelockNotReady();
        if (executedAt == 0) revert NotExecuted();

        uint256 nativeAmount = address(this).balance;
        if (nativeAmount > 0) {
            (bool ok, ) = msg.sender.call{value: nativeAmount}("");
            if (!ok) revert TransferFailed();
        }

        uint256 len = tokens.length;
        uint256[] memory amounts = new uint256[](len);
        for (uint256 i; i < len; ++i) {
            address token = tokens[i];
            if (token == address(0)) revert ZeroAddress();
            uint256 bal = IERC20(token).balanceOf(address(this));
            if (bal > 0) {
                amounts[i] = bal;
                IERC20(token).safeTransfer(msg.sender, bal);
            }
        }

        emit AllClaimed(msg.sender, nativeAmount, tokens, amounts);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Emergency Rescue
    // ─────────────────────────────────────────────────────────────────────────
    function rescueNative(address to, uint256 amount) external onlyOwner nonReentrant {
        if (isExpired()) revert DeadManSwitchActive();
        if (to == address(0)) revert ZeroAddress();

        uint256 bal = address(this).balance;
        uint256 send = amount == 0 ? bal : amount;
        if (send == 0) return;

        emit NativeRescued(to, send);
        (bool ok, ) = to.call{value: send}("");
        if (!ok) revert TransferFailed();
    }

    function rescueERC20(address token, address to, uint256 amount) external onlyOwner nonReentrant {
        if (isExpired()) revert DeadManSwitchActive();
        if (token == address(0) || to == address(0)) revert ZeroAddress();

        uint256 bal = IERC20(token).balanceOf(address(this));
        uint256 send = amount == 0 ? bal : amount;
        if (send == 0) return;

        emit ERC20Rescued(to, token, send);
        IERC20(token).safeTransfer(to, send);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // View Functions
    // ─────────────────────────────────────────────────────────────────────────
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
        return caller == beneficiary && executedAt == 0 && isTimelockReady();
    }

    function getStatus() external view returns (
        bool expired,
        bool timelockReady,
        bool executed,
        uint256 deadline,
        uint256 graceEnd,
        uint256 timelockEnd,
        uint256 nativeBalance,
        address pendingBene,
        uint256 pendingBeneReadyAt
    ) {
        expired         = isExpired();
        timelockReady   = isTimelockReady();
        executed        = executedAt != 0;
        deadline        = nextDeadlineAt();
        graceEnd        = graceEndsAt();
        timelockEnd     = timelockEndsAt();
        nativeBalance   = address(this).balance;
        pendingBene     = pendingBeneficiary;
        pendingBeneReadyAt = pendingBeneficiary != address(0)
            ? pendingBeneficiaryAt + BENEFICIARY_TIMELOCK
            : 0;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Internal
    // ─────────────────────────────────────────────────────────────────────────
    function _validateDuration(uint256 duration) internal pure {
        if (duration < MIN_DURATION || duration > MAX_DURATION) revert InvalidDuration();
    }
}
