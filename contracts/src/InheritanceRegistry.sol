// SPDX-License-Identifier: MIT
pragma solidity ^0.8.35;

import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

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

interface IERC20Balance {
    function balanceOf(address account) external view returns (uint256);
}

interface IERC20Transfer {
    function transfer(address to, uint256 amount) external returns (bool);
}

interface ISmartAccountExecutor {
    function executeBatch(
        address[] calldata targets,
        uint256[] calldata values,
        bytes[] calldata data
    ) external returns (bytes[] memory results);
}

/**
 * @title RiskGuardInheritanceRegistry
 * @notice Smart-account dead-man switch for one active inheritance plan per smart account.
 * @dev The user's funds stay in their smart account. On expiry, an agent/keeper calls
 *      executeInheritance(), which asks the smart account to execute native/ERC-20
 *      transfers. This contract must be pre-authorized by the smart account as a
 *      module/session key/role; otherwise execution reverts and funds remain in place.
 */
contract RiskGuardInheritanceRegistry is ReentrancyGuard {
    uint256 public constant BPS_TOTAL = 10_000;
    uint256 public constant MAX_BENEFICIARIES = 20;
    uint256 public constant MAX_PROTECTED_ASSETS = 20;
    uint256 public constant BENEFICIARY_TIMELOCK = 2 days;
    uint256 public constant MAX_DISTRIBUTION_RETRIES = 3;
    uint256 public constant AGENT_SUBCOMMITTEE_SIZE = 3;
    uint256 public constant MIN_HEARTBEAT_DURATION = 1 days;
    uint256 public constant MAX_DURATION = 3650 days;
    address public constant SOMNIA_REACTIVITY_PRECOMPILE =
        address(0x0000000000000000000000000000000000000100);
    address public constant NATIVE_ASSET = address(0);

    enum PlanState {
        None,
        Active,
        Cancelled,
        Executed
    }

    struct Beneficiary {
        address addr;
        uint256 shareBps;
    }

    struct ProtectedAsset {
        address token;
    }

    struct Plan {
        address smartAccount;
        uint256 heartbeatInterval;
        uint256 gracePeriod;
        uint256 timelockPeriod;
        uint256 lastHeartbeatAt;
        uint256 createdAt;
        uint256 updatedAt;
        uint256 executedAt;
        PlanState state;
    }

    error NotSmartAccount();
    error ActivePlanExists();
    error NoActivePlan();
    error TimelockNotReady();
    error ZeroAddress();
    error SameAddress();
    error InvalidDuration();
    error InvalidShares();
    error TooManyBeneficiaries();
    error TooManyProtectedAssets();
    error DuplicateAsset();
    error NoAssetsToTransfer();
    error AlreadyExecuted();
    error NotAdmin();
    error NotAuthorized();
    error DeadManSwitchActive();
    error NoPendingBeneficiaries();
    error BeneficiaryTimelockNotReady();
    error AgentNotConfigured();
    error AgentBudgetInsufficient();
    error AgentRequestPending();
    error OnlyAgentPlatform();
    error OnlyReactivityPrecompile();
    error UnknownAgentRequest();
    error DistributionNotReady();
    error MaxRetriesReached();

    mapping(address => Plan) public plans;
    mapping(address => Beneficiary[]) private _beneficiaries;
    mapping(address => Beneficiary[]) private _pendingBeneficiaries;
    mapping(address => uint256) public pendingBeneficiariesAt;
    mapping(address => ProtectedAsset[]) private _protectedAssets;
    mapping(address => mapping(address => mapping(address => bool))) public assetSettled;
    mapping(address => mapping(address => uint256)) public assetSnapshot;
    mapping(address => mapping(address => bool)) public assetSnapshotSet;
    mapping(address => bool) public distributionComplete;
    mapping(address => uint256) public distributionRetryCount;
    mapping(address => uint256) public agentBudgetOf;
    mapping(address => uint256) public pendingHeartbeatRequestId;
    mapping(address => uint256) public pendingDistributionRequestId;

    address public admin;
    address public keeper;
    IAgentRequester public agentPlatform;
    uint256 public heartbeatAgentId;
    uint256 public distributionAgentId;
    uint256 public agentRewardPerCall = 0.01 ether;
    mapping(uint256 => address) public pendingHeartbeatSmartAccount;
    mapping(uint256 => address) public pendingDistributionSmartAccount;

    event PlanCreated(
        address indexed smartAccount,
        uint256 heartbeatInterval,
        uint256 gracePeriod,
        uint256 timelockPeriod
    );
    event PlanUpdated(
        address indexed smartAccount,
        uint256 heartbeatInterval,
        uint256 gracePeriod,
        uint256 timelockPeriod
    );
    event PlanCancelled(address indexed smartAccount);
    event HeartbeatCheckedIn(address indexed smartAccount, uint256 lastHeartbeatAt);
    event KeeperSet(address indexed keeper);
    event BeneficiariesChangeProposed(address indexed smartAccount, uint256 effectiveAt);
    event BeneficiariesChangeConfirmed(address indexed smartAccount);
    event BeneficiariesChangeCancelled(address indexed smartAccount);
    event AgentConfigured(address indexed platform, uint256 heartbeatAgentId, uint256 distributionAgentId);
    event AgentBudgetFunded(uint256 amount, uint256 total);
    event AgentRewardPerCallUpdated(uint256 newReward);
    event AgentHeartbeatRequested(uint256 indexed requestId, address indexed smartAccount, address indexed triggeredBy);
    event AgentHeartbeatSucceeded(uint256 indexed requestId, address indexed smartAccount);
    event AgentHeartbeatFailed(uint256 indexed requestId, address indexed smartAccount, ResponseStatus status);
    event DistributionAgentRequested(
        uint256 indexed requestId,
        address indexed smartAccount,
        address indexed triggeredBy,
        uint256 retryCount
    );
    event DistributionAgentSucceeded(uint256 indexed requestId, address indexed smartAccount, uint256 settledCount);
    event DistributionAgentFailed(uint256 indexed requestId, address indexed smartAccount, ResponseStatus status);
    event DistributionTransferSkipped(
        address indexed smartAccount,
        address indexed beneficiary,
        address indexed token,
        uint256 amount
    );
    event DistributionComplete(address indexed smartAccount);
    event ReactiveDistributionSkipped(address indexed smartAccount, string reason);
    event ReactiveDistributionSucceeded(address indexed smartAccount, uint256 settledCount);

    modifier onlySmartAccount(address smartAccount) {
        if (msg.sender != smartAccount) revert NotSmartAccount();
        _;
    }

    modifier onlyAuthorized(address smartAccount) {
        if (msg.sender != smartAccount && msg.sender != keeper) revert NotAuthorized();
        _;
    }

    modifier onlyAdmin() {
        if (msg.sender != admin) revert NotAdmin();
        _;
    }

    modifier onlyReactivityPrecompile() {
        if (msg.sender != SOMNIA_REACTIVITY_PRECOMPILE) revert OnlyReactivityPrecompile();
        _;
    }

    constructor() {
        admin = msg.sender;
    }

    receive() external payable {
        revert AgentBudgetInsufficient();
    }

    function createPlan(
        Beneficiary[] calldata beneficiaries,
        ProtectedAsset[] calldata protectedAssets,
        uint256 heartbeatInterval,
        uint256 gracePeriod,
        uint256 timelockPeriod
    ) external {
        address smartAccount = msg.sender;
        _requireSmartAccount(smartAccount);
        if (plans[smartAccount].state == PlanState.Active) revert ActivePlanExists();

        _validateDuration(heartbeatInterval, true);
        _validateDuration(gracePeriod, false);
        _validateDuration(timelockPeriod, false);
        _clearDistributionState(smartAccount);
        _setBeneficiaries(smartAccount, beneficiaries);
        _setProtectedAssets(smartAccount, protectedAssets);

        plans[smartAccount] = Plan({
            smartAccount: smartAccount,
            heartbeatInterval: heartbeatInterval,
            gracePeriod: gracePeriod,
            timelockPeriod: timelockPeriod,
            lastHeartbeatAt: block.timestamp,
            createdAt: block.timestamp,
            updatedAt: block.timestamp,
            executedAt: 0,
            state: PlanState.Active
        });

        emit PlanCreated(smartAccount, heartbeatInterval, gracePeriod, timelockPeriod);
    }

    function updatePlan(
        Beneficiary[] calldata beneficiaries,
        ProtectedAsset[] calldata protectedAssets,
        uint256 heartbeatInterval,
        uint256 gracePeriod,
        uint256 timelockPeriod
    ) external onlySmartAccount(msg.sender) {
        _requireSmartAccount(msg.sender);
        Plan storage plan = plans[msg.sender];
        if (plan.state != PlanState.Active) revert NoActivePlan();
        if (block.timestamp >= plan.lastHeartbeatAt + plan.heartbeatInterval + plan.gracePeriod) {
            revert DeadManSwitchActive();
        }

        _validateDuration(heartbeatInterval, true);
        _validateDuration(gracePeriod, false);
        _validateDuration(timelockPeriod, false);
        _clearDistributionState(msg.sender);
        _setBeneficiaries(msg.sender, beneficiaries);
        _setProtectedAssets(msg.sender, protectedAssets);

        plan.heartbeatInterval = heartbeatInterval;
        plan.gracePeriod = gracePeriod;
        plan.timelockPeriod = timelockPeriod;
        plan.updatedAt = block.timestamp;

        emit PlanUpdated(msg.sender, heartbeatInterval, gracePeriod, timelockPeriod);
    }

    function cancelPlan() external {
        Plan storage plan = plans[msg.sender];
        if (plan.state != PlanState.Active) revert NoActivePlan();
        if (block.timestamp >= plan.lastHeartbeatAt + plan.heartbeatInterval + plan.gracePeriod) {
            revert DeadManSwitchActive();
        }

        plan.state = PlanState.Cancelled;
        plan.updatedAt = block.timestamp;
        delete _beneficiaries[msg.sender];
        delete _protectedAssets[msg.sender];

        emit PlanCancelled(msg.sender);
    }

    function checkIn() external {
        Plan storage plan = plans[msg.sender];
        if (plan.state != PlanState.Active) revert NoActivePlan();
        if (block.timestamp >= plan.lastHeartbeatAt + plan.heartbeatInterval + plan.gracePeriod) {
            revert DeadManSwitchActive();
        }

        plan.lastHeartbeatAt = block.timestamp;
        plan.updatedAt = block.timestamp;
        emit HeartbeatCheckedIn(msg.sender, block.timestamp);
    }

    function setKeeper(address newKeeper) external onlyAdmin {
        keeper = newKeeper;
        emit KeeperSet(newKeeper);
    }

    function configureAgent(address platform, uint256 nextHeartbeatAgentId, uint256 nextDistributionAgentId)
        external
        onlyAdmin
    {
        if (platform == address(0)) revert ZeroAddress();
        agentPlatform = IAgentRequester(platform);
        heartbeatAgentId = nextHeartbeatAgentId;
        distributionAgentId = nextDistributionAgentId;
        emit AgentConfigured(platform, nextHeartbeatAgentId, nextDistributionAgentId);
    }

    function fundAgentBudget(address smartAccount) external payable {
        if (smartAccount == address(0)) revert ZeroAddress();
        agentBudgetOf[smartAccount] += msg.value;
        emit AgentBudgetFunded(msg.value, agentBudgetOf[smartAccount]);
    }

    function setAgentRewardPerCall(uint256 newReward) external onlyAdmin {
        agentRewardPerCall = newReward;
        emit AgentRewardPerCallUpdated(newReward);
    }

    function proposeBeneficiaries(Beneficiary[] calldata next) external {
        Plan storage plan = plans[msg.sender];
        if (plan.state != PlanState.Active) revert NoActivePlan();
        if (block.timestamp >= plan.lastHeartbeatAt + plan.heartbeatInterval + plan.gracePeriod) {
            revert DeadManSwitchActive();
        }

        _validateBeneficiaries(msg.sender, next);
        delete _pendingBeneficiaries[msg.sender];
        for (uint256 i; i < next.length; ++i) {
            _pendingBeneficiaries[msg.sender].push(Beneficiary({
                addr: next[i].addr,
                shareBps: next[i].shareBps
            }));
        }
        pendingBeneficiariesAt[msg.sender] = block.timestamp;
        emit BeneficiariesChangeProposed(msg.sender, block.timestamp + BENEFICIARY_TIMELOCK);
    }

    function confirmBeneficiaries() external {
        Plan storage plan = plans[msg.sender];
        if (plan.state != PlanState.Active) revert NoActivePlan();
        if (_pendingBeneficiaries[msg.sender].length == 0) revert NoPendingBeneficiaries();
        if (block.timestamp < pendingBeneficiariesAt[msg.sender] + BENEFICIARY_TIMELOCK) {
            revert BeneficiaryTimelockNotReady();
        }
        if (block.timestamp >= plan.lastHeartbeatAt + plan.heartbeatInterval + plan.gracePeriod) {
            revert DeadManSwitchActive();
        }

        delete _beneficiaries[msg.sender];
        for (uint256 i; i < _pendingBeneficiaries[msg.sender].length; ++i) {
            _beneficiaries[msg.sender].push(_pendingBeneficiaries[msg.sender][i]);
        }
        delete _pendingBeneficiaries[msg.sender];
        pendingBeneficiariesAt[msg.sender] = 0;
        plan.updatedAt = block.timestamp;
        emit BeneficiariesChangeConfirmed(msg.sender);
    }

    function cancelBeneficiariesChange() external {
        if (_pendingBeneficiaries[msg.sender].length == 0) revert NoPendingBeneficiaries();
        delete _pendingBeneficiaries[msg.sender];
        pendingBeneficiariesAt[msg.sender] = 0;
        emit BeneficiariesChangeCancelled(msg.sender);
    }

    function getPendingBeneficiaries(address smartAccount)
        external
        view
        returns (Beneficiary[] memory)
    {
        return _pendingBeneficiaries[smartAccount];
    }

    function triggerAgentHeartbeat(address smartAccount) external onlyAuthorized(smartAccount) nonReentrant {
        Plan storage plan = plans[smartAccount];
        if (plan.state != PlanState.Active) revert NoActivePlan();
        if (block.timestamp >= plan.lastHeartbeatAt + plan.heartbeatInterval + plan.gracePeriod) {
            revert DeadManSwitchActive();
        }
        if (address(agentPlatform) == address(0)) revert AgentNotConfigured();
        if (pendingHeartbeatRequestId[smartAccount] != 0) revert AgentRequestPending();

        uint256 deposit = _agentDeposit();
        if (agentBudgetOf[smartAccount] < deposit) revert AgentBudgetInsufficient();
        agentBudgetOf[smartAccount] -= deposit;

        uint256 requestId = agentPlatform.createRequest{ value: deposit }(
            heartbeatAgentId,
            address(this),
            this.handleHeartbeatResponse.selector,
            abi.encode(smartAccount, block.timestamp)
        );
        pendingHeartbeatSmartAccount[requestId] = smartAccount;
        pendingHeartbeatRequestId[smartAccount] = requestId;
        emit AgentHeartbeatRequested(requestId, smartAccount, msg.sender);
    }

    function handleHeartbeatResponse(
        uint256 requestId,
        Response[] memory responses,
        ResponseStatus status,
        AgentRequest memory
    ) external {
        if (msg.sender != address(agentPlatform)) revert OnlyAgentPlatform();
        address smartAccount = pendingHeartbeatSmartAccount[requestId];
        if (smartAccount == address(0)) revert UnknownAgentRequest();
        delete pendingHeartbeatSmartAccount[requestId];
        delete pendingHeartbeatRequestId[smartAccount];

        if (status == ResponseStatus.Success && responses.length > 0 && plans[smartAccount].state == PlanState.Active) {
            plans[smartAccount].lastHeartbeatAt = block.timestamp;
            plans[smartAccount].updatedAt = block.timestamp;
            emit HeartbeatCheckedIn(smartAccount, block.timestamp);
            emit AgentHeartbeatSucceeded(requestId, smartAccount);
        } else {
            emit AgentHeartbeatFailed(requestId, smartAccount, status);
        }
    }

    function triggerDistributionAgent(address smartAccount) external nonReentrant {
        if (distributionComplete[smartAccount]) revert AlreadyExecuted();
        if (!_isTimelockReady(plans[smartAccount])) revert DistributionNotReady();
        if (address(agentPlatform) == address(0)) revert AgentNotConfigured();
        if (distributionRetryCount[smartAccount] >= MAX_DISTRIBUTION_RETRIES) revert MaxRetriesReached();
        if (pendingDistributionRequestId[smartAccount] != 0) revert AgentRequestPending();

        uint256 deposit = _agentDeposit();
        if (agentBudgetOf[smartAccount] < deposit) revert AgentBudgetInsufficient();
        agentBudgetOf[smartAccount] -= deposit;

        uint256 requestId = agentPlatform.createRequest{ value: deposit }(
            distributionAgentId,
            address(this),
            this.handleDistributionResponse.selector,
            abi.encode(smartAccount, distributionRetryCount[smartAccount])
        );
        pendingDistributionSmartAccount[requestId] = smartAccount;
        pendingDistributionRequestId[smartAccount] = requestId;
        emit DistributionAgentRequested(
            requestId,
            smartAccount,
            msg.sender,
            distributionRetryCount[smartAccount]
        );
    }

    function handleDistributionResponse(
        uint256 requestId,
        Response[] memory responses,
        ResponseStatus status,
        AgentRequest memory
    ) external nonReentrant {
        if (msg.sender != address(agentPlatform)) revert OnlyAgentPlatform();
        address smartAccount = pendingDistributionSmartAccount[requestId];
        if (smartAccount == address(0)) revert UnknownAgentRequest();
        delete pendingDistributionSmartAccount[requestId];
        delete pendingDistributionRequestId[smartAccount];
        distributionRetryCount[smartAccount] += 1;

        if (status != ResponseStatus.Success || responses.length == 0) {
            emit DistributionAgentFailed(requestId, smartAccount, status);
            return;
        }

        uint256 settled = _executeDistribution(smartAccount, true);
        emit DistributionAgentSucceeded(requestId, smartAccount, settled);
    }

    function onEvent(address emitter, bytes32[] calldata, bytes calldata data)
        external
        onlyReactivityPrecompile
        nonReentrant
    {
        address smartAccount = data.length == 32 ? abi.decode(data, (address)) : address(0);
        if (emitter != SOMNIA_REACTIVITY_PRECOMPILE) {
            emit ReactiveDistributionSkipped(smartAccount, "non-system event");
            return;
        }
        if (smartAccount == address(0) || !_isTimelockReady(plans[smartAccount])) {
            emit ReactiveDistributionSkipped(smartAccount, "timelock not ready");
            return;
        }

        uint256 settled = _executeDistribution(smartAccount, true);
        emit ReactiveDistributionSucceeded(smartAccount, settled);
    }

    function executeInheritance(address smartAccount) external nonReentrant {
        Plan storage plan = plans[smartAccount];
        if (plan.state != PlanState.Active) revert NoActivePlan();
        if (!_isTimelockReady(plan)) revert TimelockNotReady();

        uint256 settled = _executeDistribution(smartAccount, false);
        if (settled == 0) revert NoAssetsToTransfer();
    }

    function hasActivePlan(address smartAccount) external view returns (bool) {
        return plans[smartAccount].state == PlanState.Active;
    }

    function getBeneficiaries(address smartAccount) external view returns (Beneficiary[] memory) {
        return _beneficiaries[smartAccount];
    }

    function getProtectedAssets(address smartAccount) external view returns (ProtectedAsset[] memory) {
        return _protectedAssets[smartAccount];
    }

    function getPlan(address smartAccount)
        external
        view
        returns (
            Plan memory plan,
            Beneficiary[] memory beneficiaries,
            ProtectedAsset[] memory protectedAssets
        )
    {
        return (plans[smartAccount], _beneficiaries[smartAccount], _protectedAssets[smartAccount]);
    }

    function nextDeadlineAt(address smartAccount) public view returns (uint256) {
        Plan storage plan = plans[smartAccount];
        if (plan.state != PlanState.Active) return 0;
        return plan.lastHeartbeatAt + plan.heartbeatInterval;
    }

    function graceEndsAt(address smartAccount) public view returns (uint256) {
        Plan storage plan = plans[smartAccount];
        uint256 deadline = nextDeadlineAt(smartAccount);
        return deadline == 0 ? 0 : deadline + plan.gracePeriod;
    }

    function timelockEndsAt(address smartAccount) public view returns (uint256) {
        Plan storage plan = plans[smartAccount];
        uint256 graceEnd = graceEndsAt(smartAccount);
        return graceEnd == 0 ? 0 : graceEnd + plan.timelockPeriod;
    }

    function lastHeartbeatAt(address smartAccount) external view returns (uint256) {
        return plans[smartAccount].lastHeartbeatAt;
    }

    function isExpired(address smartAccount) external view returns (bool) {
        uint256 graceEnd = graceEndsAt(smartAccount);
        return graceEnd > 0 && block.timestamp >= graceEnd;
    }

    function isTimelockReady(address smartAccount) external view returns (bool) {
        Plan storage plan = plans[smartAccount];
        return _isTimelockReady(plan);
    }

    function _executeDistribution(address smartAccount, bool skipOnFail) private returns (uint256 settledCount) {
        Plan storage plan = plans[smartAccount];
        if (plan.state != PlanState.Active || distributionComplete[smartAccount]) return 0;
        if (!_isTimelockReady(plan)) return 0;

        Beneficiary[] storage beneficiaries = _beneficiaries[smartAccount];
        ProtectedAsset[] storage assets = _protectedAssets[smartAccount];

        for (uint256 assetIndex; assetIndex < assets.length; ++assetIndex) {
            address token = assets[assetIndex].token;
            uint256 balance = _snapshotAssetIfNeeded(smartAccount, token);

            if (balance == 0) {
                continue;
            }

            for (uint256 beneficiaryIndex; beneficiaryIndex < beneficiaries.length; ++beneficiaryIndex) {
                Beneficiary storage beneficiary = beneficiaries[beneficiaryIndex];
                if (assetSettled[smartAccount][token][beneficiary.addr]) {
                    continue;
                }

                uint256 amount = (balance * beneficiary.shareBps) / BPS_TOTAL;
                if (amount == 0) {
                    continue;
                }

                bool ok = _executeSingleTransfer(smartAccount, beneficiary.addr, token, amount, skipOnFail);
                if (ok) {
                    assetSettled[smartAccount][token][beneficiary.addr] = true;
                    ++settledCount;
                }
            }
        }

        if (_allAssetsSettled(smartAccount)) {
            distributionComplete[smartAccount] = true;
            plan.state = PlanState.Executed;
            plan.executedAt = block.timestamp;
            plan.updatedAt = block.timestamp;
            emit DistributionComplete(smartAccount);
        }
    }

    function _executeSingleTransfer(
        address smartAccount,
        address beneficiary,
        address token,
        uint256 amount,
        bool skipOnFail
    ) private returns (bool) {
        address[] memory targets = new address[](1);
        uint256[] memory values = new uint256[](1);
        bytes[] memory data = new bytes[](1);

        if (token == NATIVE_ASSET) {
            targets[0] = beneficiary;
            values[0] = amount;
            data[0] = "";
        } else {
            targets[0] = token;
            values[0] = 0;
            data[0] = abi.encodeCall(IERC20Transfer.transfer, (beneficiary, amount));
        }

        try ISmartAccountExecutor(smartAccount).executeBatch(targets, values, data) {
            return true;
        } catch {
            emit DistributionTransferSkipped(smartAccount, beneficiary, token, amount);
            if (!skipOnFail) revert NoAssetsToTransfer();
            return false;
        }
    }

    function _allAssetsSettled(address smartAccount) private view returns (bool) {
        Beneficiary[] storage beneficiaries = _beneficiaries[smartAccount];
        ProtectedAsset[] storage assets = _protectedAssets[smartAccount];

        for (uint256 assetIndex; assetIndex < assets.length; ++assetIndex) {
            address token = assets[assetIndex].token;
            if (!assetSnapshotSet[smartAccount][token] || assetSnapshot[smartAccount][token] == 0) {
                continue;
            }

            for (uint256 beneficiaryIndex; beneficiaryIndex < beneficiaries.length; ++beneficiaryIndex) {
                if (!assetSettled[smartAccount][token][beneficiaries[beneficiaryIndex].addr]) {
                    return false;
                }
            }
        }

        return true;
    }

    function _snapshotAssetIfNeeded(address smartAccount, address token) private returns (uint256) {
        if (!assetSnapshotSet[smartAccount][token]) {
            assetSnapshot[smartAccount][token] = token == NATIVE_ASSET
                ? smartAccount.balance
                : IERC20Balance(token).balanceOf(smartAccount);
            assetSnapshotSet[smartAccount][token] = true;
        }

        return assetSnapshot[smartAccount][token];
    }

    function _clearDistributionState(address smartAccount) private {
        Beneficiary[] storage beneficiaries = _beneficiaries[smartAccount];
        ProtectedAsset[] storage assets = _protectedAssets[smartAccount];

        for (uint256 assetIndex; assetIndex < assets.length; ++assetIndex) {
            address token = assets[assetIndex].token;
            delete assetSnapshot[smartAccount][token];
            delete assetSnapshotSet[smartAccount][token];
            for (uint256 beneficiaryIndex; beneficiaryIndex < beneficiaries.length; ++beneficiaryIndex) {
                delete assetSettled[smartAccount][token][beneficiaries[beneficiaryIndex].addr];
            }
        }

        distributionComplete[smartAccount] = false;
        distributionRetryCount[smartAccount] = 0;
    }

    function _requireSmartAccount(address smartAccount) private view {
        if (smartAccount.code.length == 0) revert NotSmartAccount();
    }

    function _validateBeneficiaries(
        address smartAccount,
        Beneficiary[] calldata beneficiaries
    ) private pure {
        uint256 len = beneficiaries.length;
        if (len == 0 || len > MAX_BENEFICIARIES) revert TooManyBeneficiaries();

        uint256 total;

        for (uint256 i; i < len; ++i) {
            Beneficiary calldata beneficiary = beneficiaries[i];
            if (beneficiary.addr == address(0)) revert ZeroAddress();
            if (beneficiary.addr == smartAccount) revert SameAddress();
            if (beneficiary.shareBps == 0) revert InvalidShares();

            for (uint256 j = i + 1; j < len; ++j) {
                if (beneficiary.addr == beneficiaries[j].addr) revert SameAddress();
            }

            total += beneficiary.shareBps;
        }

        if (total != BPS_TOTAL) revert InvalidShares();
    }

    function _setBeneficiaries(
        address smartAccount,
        Beneficiary[] calldata beneficiaries
    ) private {
        _validateBeneficiaries(smartAccount, beneficiaries);
        delete _beneficiaries[smartAccount];

        for (uint256 i; i < beneficiaries.length; ++i) {
            _beneficiaries[smartAccount].push(Beneficiary({
                addr: beneficiaries[i].addr,
                shareBps: beneficiaries[i].shareBps
            }));
        }
    }

    function _setProtectedAssets(
        address smartAccount,
        ProtectedAsset[] calldata protectedAssets
    ) private {
        uint256 len = protectedAssets.length;
        if (len == 0 || len > MAX_PROTECTED_ASSETS) revert TooManyProtectedAssets();

        delete _protectedAssets[smartAccount];

        for (uint256 i; i < len; ++i) {
            address token = protectedAssets[i].token;

            for (uint256 j = i + 1; j < len; ++j) {
                if (token == protectedAssets[j].token) revert DuplicateAsset();
            }

            _protectedAssets[smartAccount].push(ProtectedAsset({ token: token }));
        }
    }

    function _isTimelockReady(Plan storage plan) private view returns (bool) {
        if (plan.state != PlanState.Active) return false;
        return block.timestamp >= plan.lastHeartbeatAt + plan.heartbeatInterval + plan.gracePeriod + plan.timelockPeriod;
    }

    function _validateDuration(uint256 duration, bool heartbeat) private pure {
        if (duration > MAX_DURATION) revert InvalidDuration();
        if (heartbeat && duration < MIN_HEARTBEAT_DURATION) revert InvalidDuration();
    }

    function _agentDeposit() private view returns (uint256) {
        return agentPlatform.getRequestDeposit() + (agentRewardPerCall * AGENT_SUBCOMMITTEE_SIZE);
    }
}
