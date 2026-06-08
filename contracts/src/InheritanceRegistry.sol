// SPDX-License-Identifier: MIT
pragma solidity ^0.8.35;

import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import { Strings } from "@openzeppelin/contracts/utils/Strings.sol";
import { IAgentRequester, Request, Response, ResponseStatus } from "./SomniaAgentInterfaces.sol";

interface IERC20Balance {
    function balanceOf(address account) external view returns (uint256);
}

interface IERC20Transfer {
    function transfer(address to, uint256 amount) external returns (bool);
}

interface ISmartAccountExecutor {
    function executeFromExecutor(bytes32 mode, bytes calldata executionCalldata)
        external
        returns (bytes[] memory results);

    function execute(bytes32 mode, bytes calldata executionCalldata)
        external
        returns (bytes[] memory results);

    function executeBatch(
        address[] calldata targets,
        uint256[] calldata values,
        bytes[] calldata data
    ) external returns (bytes[] memory results);
}

interface ISomniaEventHandler {
    function onEvent(address emitter, bytes32[] calldata eventTopics, bytes calldata data) external;
}

interface ISomniaReactivityPrecompile {
    struct SubscriptionData {
        bytes32[4] eventTopics;
        address origin;
        address caller;
        address emitter;
        address handlerContractAddress;
        bytes4 handlerFunctionSelector;
        uint64 priorityFeePerGas;
        uint64 maxFeePerGas;
        uint64 gasLimit;
        bool isGuaranteed;
        bool isCoalesced;
    }

    function subscribe(SubscriptionData calldata subscriptionData)
        external
        returns (uint256 subscriptionId);
}

interface ILLMInferenceAgent {
    function inferString(
        string calldata prompt,
        string calldata system,
        bool chainOfThought,
        string[] calldata allowedValues
    ) external returns (string memory response);
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
    uint256 public constant REACTIVITY_SCHEDULE_DRIFT_TOLERANCE_SECONDS = 300;
    uint256 public constant AGENT_SUBCOMMITTEE_SIZE = 3;
    uint256 public constant MODULE_TYPE_EXECUTOR = 2;
    uint256 public constant MIN_HEARTBEAT_DURATION = 1 days;
    uint256 public constant MAX_DURATION = 3650 days;
    address public constant SOMNIA_REACTIVITY_PRECOMPILE =
        address(0x0000000000000000000000000000000000000100);
    bytes32 public constant SOMNIA_SCHEDULE_EVENT_TOPIC = keccak256("Schedule(uint256)");
    address public constant NATIVE_ASSET = address(0);
    bytes32 public constant ERC7579_SINGLE_EXECUTION_MODE = bytes32(0);
    uint256 public constant DEFAULT_REACTIVITY_PRIORITY_FEE_PER_GAS = 2 gwei;
    uint256 public constant DEFAULT_REACTIVITY_MAX_FEE_PER_GAS = 0;
    uint256 public constant DEFAULT_REACTIVITY_GAS_LIMIT = 31_000_000;
    address private constant LOCAL_REACTIVITY_PRECOMPILE_MOCK =
        address(0x0000000000000000000000000000000000010100);

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
    error InvalidReactivityGasConfig();
    error WithdrawFailed();

    mapping(address => Plan) public plans;
    mapping(address => Beneficiary[]) private _beneficiaries;
    mapping(address => Beneficiary[]) private _pendingBeneficiaries;
    mapping(address => uint256) public pendingBeneficiariesAt;
    mapping(address => ProtectedAsset[]) private _protectedAssets;
    mapping(address => mapping(address => mapping(address => bool))) public assetSettled;
    mapping(address => bool) public executorInstalledFor;
    mapping(address => mapping(address => uint256)) public assetSnapshot;
    mapping(address => mapping(address => bool)) public assetSnapshotSet;
    mapping(address => bool) public distributionComplete;
    mapping(address => uint256) public distributionRetryCount;
    mapping(address => uint256) public agentBudgetOf;
    mapping(address => uint256) public pendingHeartbeatRequestId;
    mapping(address => uint256) public pendingDistributionRequestId;
    mapping(address => uint256) public currentDistributionScheduleMs;
    mapping(uint256 => address[]) private _scheduledSmartAccounts;

    address public admin;
    address public keeper;
    address public immutable somniaReactivityPrecompile;
    IAgentRequester public agentPlatform;
    uint256 public heartbeatAgentId;
    uint256 public distributionAgentId;
    uint256 public agentRewardPerCall = 0.01 ether;
    uint256 public reactivityPriorityFeePerGas = DEFAULT_REACTIVITY_PRIORITY_FEE_PER_GAS;
    uint256 public reactivityMaxFeePerGas = DEFAULT_REACTIVITY_MAX_FEE_PER_GAS;
    uint256 public reactivityGasLimit = DEFAULT_REACTIVITY_GAS_LIMIT;
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
    event AgentConfigured(
        address indexed platform, uint256 heartbeatAgentId, uint256 distributionAgentId
    );
    event AgentBudgetFunded(uint256 amount, uint256 total);
    event AgentRewardPerCallUpdated(uint256 newReward);
    event AgentHeartbeatRequested(
        uint256 indexed requestId, address indexed smartAccount, address indexed triggeredBy
    );
    event AgentHeartbeatSucceeded(uint256 indexed requestId, address indexed smartAccount);
    event AgentHeartbeatFailed(
        uint256 indexed requestId, address indexed smartAccount, ResponseStatus status
    );
    event DistributionAgentRequested(
        uint256 indexed requestId,
        address indexed smartAccount,
        address indexed triggeredBy,
        uint256 retryCount
    );
    event DistributionAgentSucceeded(
        uint256 indexed requestId, address indexed smartAccount, uint256 settledCount
    );
    event DistributionAgentFailed(
        uint256 indexed requestId, address indexed smartAccount, ResponseStatus status
    );
    event DistributionTransferSkipped(
        address indexed smartAccount,
        address indexed beneficiary,
        address indexed token,
        uint256 amount
    );
    event DistributionComplete(address indexed smartAccount);
    event ReactivityBudgetFunded(address indexed funder, uint256 amount, uint256 totalBalance);
    event ReactivityBudgetWithdrawn(address indexed to, uint256 amount, uint256 remainingBalance);
    event ReactivityGasConfigUpdated(
        uint256 priorityFeePerGas, uint256 maxFeePerGas, uint256 gasLimit
    );
    event DistributionScheduled(
        address indexed smartAccount, uint256 indexed timestampMs, uint64 subscriptionId
    );
    event DistributionScheduleFailed(address indexed smartAccount, uint256 indexed timestampMs);
    event ReactiveDistributionSkipped(address indexed smartAccount, string reason);
    event ReactiveDistributionAgentRequested(
        address indexed smartAccount, uint256 indexed requestId
    );
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
        // Somnia's on-chain Reactivity currently dispatches Solidity handler
        // calls as a transaction from the subscription owner contract to itself.
        // Keep the documented precompile caller path too so this remains
        // compatible if the runtime changes to direct precompile calls.
        if (msg.sender != somniaReactivityPrecompile && msg.sender != address(this)) {
            revert OnlyReactivityPrecompile();
        }
        _;
    }

    constructor() {
        admin = msg.sender;
        somniaReactivityPrecompile = block.chainid == 31_337
            ? LOCAL_REACTIVITY_PRECOMPILE_MOCK
            : SOMNIA_REACTIVITY_PRECOMPILE;
    }

    receive() external payable {
        emit ReactivityBudgetFunded(msg.sender, msg.value, address(this).balance);
    }

    function onInstall(bytes calldata) external {
        executorInstalledFor[msg.sender] = true;
    }

    function onUninstall(bytes calldata) external {
        delete executorInstalledFor[msg.sender];
    }

    function moduleTypeId() external pure returns (uint256) {
        return MODULE_TYPE_EXECUTOR;
    }

    function isModuleType(uint256 moduleType) external pure returns (bool) {
        return moduleType == MODULE_TYPE_EXECUTOR;
    }

    function isInitialized(address smartAccount) external view returns (bool) {
        return executorInstalledFor[smartAccount];
    }

    function createPlan(
        Beneficiary[] calldata beneficiaries,
        ProtectedAsset[] calldata protectedAssets,
        uint256 heartbeatInterval,
        uint256 gracePeriod,
        uint256 timelockPeriod
    ) external {
        _createPlan(msg.sender, beneficiaries, protectedAssets, heartbeatInterval, gracePeriod, timelockPeriod);
    }

    function createPlanFor(
        address smartAccount,
        Beneficiary[] calldata beneficiaries,
        ProtectedAsset[] calldata protectedAssets,
        uint256 heartbeatInterval,
        uint256 gracePeriod,
        uint256 timelockPeriod
    ) external onlyAdmin {
        _createPlan(smartAccount, beneficiaries, protectedAssets, heartbeatInterval, gracePeriod, timelockPeriod);
    }

    function _createPlan(
        address smartAccount,
        Beneficiary[] calldata beneficiaries,
        ProtectedAsset[] calldata protectedAssets,
        uint256 heartbeatInterval,
        uint256 gracePeriod,
        uint256 timelockPeriod
    ) private {
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

        _scheduleDistribution(smartAccount);
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

        _scheduleDistribution(msg.sender);
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
        _scheduleDistribution(msg.sender);
        emit HeartbeatCheckedIn(msg.sender, block.timestamp);
    }

    function setKeeper(address newKeeper) external onlyAdmin {
        keeper = newKeeper;
        emit KeeperSet(newKeeper);
    }

    function configureAgent(
        address platform,
        uint256 nextHeartbeatAgentId,
        uint256 nextDistributionAgentId
    ) external onlyAdmin {
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

    function withdrawReactivityBudget(address payable to, uint256 amount)
        external
        onlyAdmin
        nonReentrant
    {
        if (to == address(0)) revert ZeroAddress();
        (bool ok,) = to.call{ value: amount }("");
        if (!ok) revert WithdrawFailed();
        emit ReactivityBudgetWithdrawn(to, amount, address(this).balance);
    }

    function setAgentRewardPerCall(uint256 newReward) external onlyAdmin {
        agentRewardPerCall = newReward;
        emit AgentRewardPerCallUpdated(newReward);
    }

    function setReactivityGasConfig(
        uint256 priorityFeePerGas,
        uint256 maxFeePerGas,
        uint256 gasLimit
    ) external onlyAdmin {
        if (
            priorityFeePerGas == 0
                || (maxFeePerGas != 0 && maxFeePerGas < priorityFeePerGas)
                || gasLimit == 0
                || priorityFeePerGas > type(uint64).max || maxFeePerGas > type(uint64).max
                || gasLimit > type(uint64).max
        ) {
            revert InvalidReactivityGasConfig();
        }

        reactivityPriorityFeePerGas = priorityFeePerGas;
        reactivityMaxFeePerGas = maxFeePerGas;
        reactivityGasLimit = gasLimit;
        emit ReactivityGasConfigUpdated(priorityFeePerGas, maxFeePerGas, gasLimit);
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
            _pendingBeneficiaries[msg.sender].push(
                Beneficiary({ addr: next[i].addr, shareBps: next[i].shareBps })
            );
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

    function triggerAgentHeartbeat(address smartAccount)
        external
        onlyAuthorized(smartAccount)
        nonReentrant
    {
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

        string[] memory allowedValues = new string[](0);
        bytes memory payload = abi.encodeWithSelector(
            ILLMInferenceAgent.inferString.selector,
            string.concat(
                "Confirm whether this active smart-account inheritance plan should receive a heartbeat refresh. ",
                "Smart account: ",
                Strings.toHexString(smartAccount),
                ". Current block timestamp: ",
                Strings.toString(block.timestamp),
                ". Return OK with a concise reason if the plan is still active."
            ),
            "You are Somnia RiskGuard Inheritance. Return one concise line for an on-chain callback.",
            false,
            allowedValues
        );

        uint256 requestId = agentPlatform.createRequest{ value: deposit }(
            heartbeatAgentId,
            address(this),
            this.handleHeartbeatResponse.selector,
            payload
        );
        pendingHeartbeatSmartAccount[requestId] = smartAccount;
        pendingHeartbeatRequestId[smartAccount] = requestId;
        emit AgentHeartbeatRequested(requestId, smartAccount, msg.sender);
    }

    function handleHeartbeatResponse(
        uint256 requestId,
        Response[] memory responses,
        ResponseStatus status,
        Request memory
    ) external {
        if (msg.sender != address(agentPlatform)) {
            revert OnlyAgentPlatform();
        }
        address smartAccount = pendingHeartbeatSmartAccount[requestId];
        if (smartAccount == address(0)) revert UnknownAgentRequest();
        delete pendingHeartbeatSmartAccount[requestId];
        delete pendingHeartbeatRequestId[smartAccount];

        if (
            status == ResponseStatus.Success && responses.length > 0
                && plans[smartAccount].state == PlanState.Active
        ) {
            plans[smartAccount].lastHeartbeatAt = block.timestamp;
            plans[smartAccount].updatedAt = block.timestamp;
            _scheduleDistribution(smartAccount);
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
        if (distributionRetryCount[smartAccount] >= MAX_DISTRIBUTION_RETRIES) {
            revert MaxRetriesReached();
        }
        if (pendingDistributionRequestId[smartAccount] != 0) revert AgentRequestPending();

        uint256 deposit = _agentDeposit();
        if (agentBudgetOf[smartAccount] < deposit) revert AgentBudgetInsufficient();

        _createDistributionAgentRequest(smartAccount, msg.sender, deposit);
    }

    function handleDistributionResponse(
        uint256 requestId,
        Response[] memory responses,
        ResponseStatus status,
        Request memory
    ) external nonReentrant {
        if (msg.sender != address(agentPlatform)) {
            revert OnlyAgentPlatform();
        }
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

    function onEvent(address emitter, bytes32[] calldata eventTopics, bytes calldata)
        external
        onlyReactivityPrecompile
        nonReentrant
    {
        if (emitter != somniaReactivityPrecompile) {
            emit ReactiveDistributionSkipped(address(0), "non-system event");
            return;
        }

        if (eventTopics.length < 2 || eventTopics[0] != SOMNIA_SCHEDULE_EVENT_TOPIC) {
            emit ReactiveDistributionSkipped(address(0), "non-schedule event");
            return;
        }

        uint256 timestampMs = _resolveScheduleTimestampMs(uint256(eventTopics[1]));
        address[] storage smartAccounts = _scheduledSmartAccounts[timestampMs];
        if (smartAccounts.length == 0) {
            emit ReactiveDistributionSkipped(address(0), "unknown schedule");
            return;
        }

        for (uint256 i; i < smartAccounts.length; ++i) {
            address smartAccount = smartAccounts[i];
            if (currentDistributionScheduleMs[smartAccount] != timestampMs) {
                emit ReactiveDistributionSkipped(smartAccount, "stale schedule");
                continue;
            }

            if (!_isTimelockReady(plans[smartAccount])) {
                emit ReactiveDistributionSkipped(smartAccount, "timelock not ready");
                continue;
            }

            uint256 settled = _executeDistribution(smartAccount, true);
            if (settled == 0) {
                emit ReactiveDistributionSkipped(smartAccount, "no assets settled");
            } else {
                emit ReactiveDistributionSucceeded(smartAccount, settled);
            }
        }
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

    function getProtectedAssets(address smartAccount)
        external
        view
        returns (ProtectedAsset[] memory)
    {
        return _protectedAssets[smartAccount];
    }

    function getScheduledSmartAccounts(uint256 timestampMs)
        external
        view
        returns (address[] memory)
    {
        return _scheduledSmartAccounts[timestampMs];
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

    function _executeDistribution(address smartAccount, bool skipOnFail)
        private
        returns (uint256 settledCount)
    {
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

            for (
                uint256 beneficiaryIndex;
                beneficiaryIndex < beneficiaries.length;
                ++beneficiaryIndex
            ) {
                Beneficiary storage beneficiary = beneficiaries[beneficiaryIndex];
                if (assetSettled[smartAccount][token][beneficiary.addr]) {
                    continue;
                }

                uint256 amount = (balance * beneficiary.shareBps) / BPS_TOTAL;
                if (amount == 0) {
                    continue;
                }

                bool ok = _executeSingleTransfer(
                    smartAccount, beneficiary.addr, token, amount, skipOnFail
                );
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

    function _requestDistributionAgentFromReactivity(address smartAccount)
        private
        returns (bool requested, uint256 requestId)
    {
        if (distributionComplete[smartAccount]) {
            emit ReactiveDistributionSkipped(smartAccount, "already executed");
            return (false, 0);
        }

        if (address(agentPlatform) == address(0)) {
            emit ReactiveDistributionSkipped(smartAccount, "agent not configured");
            return (false, 0);
        }

        if (distributionRetryCount[smartAccount] >= MAX_DISTRIBUTION_RETRIES) {
            emit ReactiveDistributionSkipped(smartAccount, "max retries reached");
            return (false, 0);
        }

        if (pendingDistributionRequestId[smartAccount] != 0) {
            emit ReactiveDistributionSkipped(smartAccount, "agent request pending");
            return (false, 0);
        }

        uint256 deposit = _agentDeposit();
        if (agentBudgetOf[smartAccount] < deposit) {
            emit ReactiveDistributionSkipped(smartAccount, "agent budget insufficient");
            return (false, 0);
        }

        requestId = _createDistributionAgentRequest(smartAccount, address(this), deposit);
        return (true, requestId);
    }

    function _createDistributionAgentRequest(
        address smartAccount,
        address triggeredBy,
        uint256 deposit
    ) private returns (uint256 requestId) {
        agentBudgetOf[smartAccount] -= deposit;

        string[] memory allowedValues = new string[](0);
        bytes memory payload = abi.encodeWithSelector(
            ILLMInferenceAgent.inferString.selector,
            string.concat(
                "Review inheritance distribution readiness for smart account ",
                Strings.toHexString(smartAccount),
                ". Retry count: ",
                Strings.toString(distributionRetryCount[smartAccount]),
                ". If the plan is expired and distribution should proceed, return OK with a concise reason."
            ),
            "You are Somnia RiskGuard Inheritance. Return one concise line for an on-chain callback.",
            false,
            allowedValues
        );

        requestId = agentPlatform.createRequest{ value: deposit }(
            distributionAgentId,
            address(this),
            this.handleDistributionResponse.selector,
            payload
        );
        pendingDistributionSmartAccount[requestId] = smartAccount;
        pendingDistributionRequestId[smartAccount] = requestId;
        emit DistributionAgentRequested(
            requestId, smartAccount, triggeredBy, distributionRetryCount[smartAccount]
        );
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

        try ISmartAccountExecutor(smartAccount).executeFromExecutor(
            ERC7579_SINGLE_EXECUTION_MODE,
            abi.encodePacked(targets[0], values[0], data[0])
        ) {
            return true;
        } catch {
            // Production ERC-7579 executor modules use executeFromExecutor.
        }

        try ISmartAccountExecutor(smartAccount).execute(
            ERC7579_SINGLE_EXECUTION_MODE,
            abi.encodePacked(targets[0], values[0], data[0])
        ) {
            return true;
        } catch {
            // Older/local mocks may only expose executeBatch.
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

            for (
                uint256 beneficiaryIndex;
                beneficiaryIndex < beneficiaries.length;
                ++beneficiaryIndex
            ) {
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
            for (
                uint256 beneficiaryIndex;
                beneficiaryIndex < beneficiaries.length;
                ++beneficiaryIndex
            ) {
                delete assetSettled[smartAccount][token][beneficiaries[beneficiaryIndex].addr];
            }
        }

        distributionComplete[smartAccount] = false;
        distributionRetryCount[smartAccount] = 0;
    }

    function _requireSmartAccount(address smartAccount) private view {
        if (smartAccount.code.length == 0) revert NotSmartAccount();
    }

    function _validateBeneficiaries(address smartAccount, Beneficiary[] calldata beneficiaries)
        private
        pure
    {
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

    function _setBeneficiaries(address smartAccount, Beneficiary[] calldata beneficiaries) private {
        _validateBeneficiaries(smartAccount, beneficiaries);
        delete _beneficiaries[smartAccount];

        for (uint256 i; i < beneficiaries.length; ++i) {
            _beneficiaries[smartAccount].push(
                Beneficiary({ addr: beneficiaries[i].addr, shareBps: beneficiaries[i].shareBps })
            );
        }
    }

    function _setProtectedAssets(address smartAccount, ProtectedAsset[] calldata protectedAssets)
        private
    {
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
        return block.timestamp
            >= plan.lastHeartbeatAt + plan.heartbeatInterval + plan.gracePeriod
                + plan.timelockPeriod;
    }

    function _scheduleDistribution(address smartAccount) private {
        uint256 timestamp = timelockEndsAt(smartAccount);
        if (timestamp <= block.timestamp) {
            return;
        }

        uint256 timestampMs = timestamp * 1000;
        currentDistributionScheduleMs[smartAccount] = timestampMs;
        _scheduledSmartAccounts[timestampMs].push(smartAccount);

        bytes32[4] memory eventTopics =
            [SOMNIA_SCHEDULE_EVENT_TOPIC, bytes32(timestampMs), bytes32(0), bytes32(0)];
        ISomniaReactivityPrecompile.SubscriptionData memory subscriptionData =
            ISomniaReactivityPrecompile.SubscriptionData({
                eventTopics: eventTopics,
                origin: address(0),
                caller: address(0),
                emitter: somniaReactivityPrecompile,
                handlerContractAddress: address(this),
                handlerFunctionSelector: ISomniaEventHandler.onEvent.selector,
                priorityFeePerGas: uint64(reactivityPriorityFeePerGas),
                maxFeePerGas: uint64(reactivityMaxFeePerGas),
                gasLimit: uint64(reactivityGasLimit),
                isGuaranteed: false,
                isCoalesced: false
            });

        try ISomniaReactivityPrecompile(somniaReactivityPrecompile).subscribe(subscriptionData)
            returns (uint256 subscriptionId)
        {
            emit DistributionScheduled(smartAccount, timestampMs, uint64(subscriptionId));
        } catch {
            emit DistributionScheduleFailed(smartAccount, timestampMs);
        }
    }

    function _resolveScheduleTimestampMs(uint256 rawTimestampMs)
        private
        view
        returns (uint256)
    {
        uint256 normalizedTimestampMs = (rawTimestampMs / 1000) * 1000;

        for (uint256 offset; offset <= REACTIVITY_SCHEDULE_DRIFT_TOLERANCE_SECONDS; ++offset) {
            uint256 driftMs = offset * 1000;
            if (driftMs > normalizedTimestampMs) break;

            uint256 candidateTimestampMs = normalizedTimestampMs - driftMs;
            if (_scheduledSmartAccounts[candidateTimestampMs].length > 0) {
                return candidateTimestampMs;
            }
        }

        return normalizedTimestampMs;
    }

    function _validateDuration(uint256 duration, bool heartbeat) private pure {
        if (duration > MAX_DURATION) revert InvalidDuration();
        if (heartbeat && duration < MIN_HEARTBEAT_DURATION) revert InvalidDuration();
    }

    function _agentDeposit() private view returns (uint256) {
        return agentPlatform.getRequestDeposit() + (agentRewardPerCall * AGENT_SUBCOMMITTEE_SIZE);
    }
}
