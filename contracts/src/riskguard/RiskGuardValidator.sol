// SPDX-License-Identifier: MIT
pragma solidity ^0.8.35;

import { ECDSA } from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import { MessageHashUtils } from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import { Strings } from "@openzeppelin/contracts/utils/Strings.sol";
import { IAgentRequester, Request, Response, ResponseStatus } from "../SomniaAgentInterfaces.sol";

interface IRiskGuardApprovalStoreForValidator {
    function hasValidApproval(address smartAccount, bytes32 txHash) external view returns (bool);
    function consumeApproval(address smartAccount, bytes32 txHash) external;
}

interface IThirdwebModularAccount {
    function owner() external view returns (address);
    function hasAnyRole(address user, uint256 roles) external view returns (bool);
}

interface ILLMInferenceAgent {
    function inferString(
        string calldata prompt,
        string calldata system,
        bool chainOfThought,
        string[] calldata allowedValues
    ) external returns (string memory response);
}

struct PackedUserOperation {
    address sender;
    uint256 nonce;
    bytes initCode;
    bytes callData;
    bytes32 accountGasLimits;
    uint256 preVerificationGas;
    bytes32 gasFees;
    bytes paymasterAndData;
    bytes signature;
}

/**
 * @title RiskGuardValidator
 * @notice ERC-7579 validator module that validates Thirdweb ModularAccount signatures
 *         and enforces RiskGuard approval policy during ERC-4337 validation.
 */
contract RiskGuardValidator {
    using ECDSA for bytes32;

    uint256 public constant BPS_TOTAL = 10_000;
    uint256 public constant MODULE_TYPE_VALIDATOR = 1;
    uint256 public constant VALIDATION_SUCCESS = 0;
    uint256 public constant VALIDATION_FAILED = 1;
    uint256 public constant AGENT_APPROVAL_TTL = 10 minutes;
    uint256 public constant AGENT_SUBCOMMITTEE_SIZE = 3;
    uint256 private constant ADMIN_ROLE = 1 << 0;

    bytes4 public constant ERC7579_EXECUTE_SELECTOR = bytes4(keccak256("execute(bytes32,bytes)"));
    bytes4 public constant ERC1271_MAGICVALUE = 0x1626ba7e;
    bytes4 public constant ERC1271_INVALID = 0xffffffff;

    bytes32 private constant MSG_TYPEHASH = keccak256("AccountMessage(bytes message)");
    bytes32 private constant DOMAIN_TYPEHASH = keccak256(
        "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
    );
    bytes32 private constant NAME_HASH = keccak256("DefaultValidator");
    bytes32 private constant VERSION_HASH = keccak256("1");

    enum ThresholdMode {
        Fixed,
        Percent
    }

    struct Config {
        bool initialized;
        bool enabled;
        ThresholdMode mode;
        uint256 thresholdValue;
        address balanceToken;
    }

    struct Execution {
        address target;
        uint256 value;
        bytes callData;
    }

    struct PendingAgentReview {
        address smartAccount;
        bytes32 txHash;
        address signer;
    }

    struct AgentApproval {
        bool exists;
        uint256 expiry;
        bytes32 decisionHash;
    }

    IRiskGuardApprovalStoreForValidator public immutable approvalStore;
    address public admin;
    IAgentRequester public agentPlatform;
    uint256 public riskAssessmentAgentId;
    uint256 public riskAgentRewardPerCall = 0.01 ether;
    mapping(address => Config) public configs;
    mapping(address => uint256) public agentBudgetOf;
    mapping(address => uint256) public pendingRiskReviewRequestId;
    mapping(uint256 => PendingAgentReview) public pendingRiskReviewByRequestId;
    mapping(address => mapping(bytes32 => AgentApproval)) public agentApprovals;

    error AlreadyInitialized(address smartAccount);
    error NotInitialized(address smartAccount);
    error ZeroAddress();
    error InvalidConfig();
    error NotAdmin();
    error NotAuthorized();
    error AgentNotConfigured();
    error AgentBudgetInsufficient();
    error AgentRequestPending();
    error OnlyAgentPlatform();
    error UnknownAgentRequest();
    error AgentReviewNotRequired();
    error AgentReviewPending(address smartAccount, bytes32 txHash, uint256 requestId);
    error PendingApprovalRequired(
        address smartAccount, bytes32 txHash, address signer, bytes riskContext
    );

    event ModuleInstalled(address indexed smartAccount);
    event ModuleUninstalled(address indexed smartAccount);
    event ConfigUpdated(
        address indexed smartAccount,
        bool enabled,
        ThresholdMode mode,
        uint256 thresholdValue,
        address balanceToken
    );
    event TxAllowedByThreshold(address indexed smartAccount, uint256 value, uint256 threshold);
    event TxAllowedByApproval(address indexed smartAccount, bytes32 txHash);
    event TxAllowedByAgent(address indexed smartAccount, bytes32 indexed txHash);
    event RiskAgentConfigured(address indexed platform, uint256 riskAssessmentAgentId);
    event AgentBudgetFunded(address indexed smartAccount, uint256 amount, uint256 total);
    event AgentRebateReceived(address indexed sender, uint256 amount);
    event RiskAgentRewardPerCallUpdated(uint256 newReward);
    event RiskAgentReviewRequested(
        uint256 indexed requestId,
        address indexed smartAccount,
        bytes32 indexed txHash,
        address signer
    );
    event RiskAgentReviewCompleted(
        uint256 indexed requestId,
        address indexed smartAccount,
        bytes32 indexed txHash,
        bool approved,
        string reason
    );

    constructor(address approvalStore_) {
        if (approvalStore_ == address(0)) revert ZeroAddress();
        approvalStore = IRiskGuardApprovalStoreForValidator(approvalStore_);
        admin = msg.sender;
    }

    receive() external payable {
        emit AgentRebateReceived(msg.sender, msg.value);
    }

    modifier onlyAdmin() {
        if (msg.sender != admin) revert NotAdmin();
        _;
    }

    function onInstall(bytes calldata initData) external {
        address smartAccount = msg.sender;
        if (configs[smartAccount].initialized) revert AlreadyInitialized(smartAccount);

        Config memory config = Config({
            initialized: true,
            enabled: false,
            mode: ThresholdMode.Fixed,
            thresholdValue: 0,
            balanceToken: address(0)
        });

        if (initData.length > 0) {
            (bool enabled, ThresholdMode mode, uint256 value, address balanceToken) =
                abi.decode(initData, (bool, ThresholdMode, uint256, address));
            _validateConfig(mode, value);
            config.enabled = enabled;
            config.mode = mode;
            config.thresholdValue = value;
            config.balanceToken = balanceToken;
        }

        configs[smartAccount] = config;
        emit ModuleInstalled(smartAccount);
    }

    function onUninstall(bytes calldata) external {
        address smartAccount = msg.sender;
        if (!configs[smartAccount].initialized) revert NotInitialized(smartAccount);

        delete configs[smartAccount];
        emit ModuleUninstalled(smartAccount);
    }

    function isModuleType(uint256 moduleTypeId) external pure returns (bool) {
        return moduleTypeId == MODULE_TYPE_VALIDATOR;
    }

    function isInitialized(address smartAccount) external view returns (bool) {
        return configs[smartAccount].initialized;
    }

    function setConfig(
        bool enabled,
        ThresholdMode mode,
        uint256 thresholdValue,
        address balanceToken
    ) external {
        address smartAccount = msg.sender;
        if (!configs[smartAccount].initialized) revert NotInitialized(smartAccount);
        _validateConfig(mode, thresholdValue);

        configs[smartAccount].enabled = enabled;
        configs[smartAccount].mode = mode;
        configs[smartAccount].thresholdValue = thresholdValue;
        configs[smartAccount].balanceToken = balanceToken;

        emit ConfigUpdated(smartAccount, enabled, mode, thresholdValue, balanceToken);
    }

    function configureRiskAgent(address platform, uint256 agentId) external onlyAdmin {
        if (platform == address(0)) revert ZeroAddress();
        agentPlatform = IAgentRequester(platform);
        riskAssessmentAgentId = agentId;
        emit RiskAgentConfigured(platform, agentId);
    }

    function fundAgentBudget(address smartAccount) external payable {
        if (smartAccount == address(0)) revert ZeroAddress();
        agentBudgetOf[smartAccount] += msg.value;
        emit AgentBudgetFunded(smartAccount, msg.value, agentBudgetOf[smartAccount]);
    }

    function setRiskAgentRewardPerCall(uint256 newReward) external onlyAdmin {
        riskAgentRewardPerCall = newReward;
        emit RiskAgentRewardPerCallUpdated(newReward);
    }

    function requestAgentReview(address smartAccount, bytes calldata callData)
        external
        returns (uint256 requestId)
    {
        Config storage config = configs[smartAccount];
        if (!config.initialized) revert NotInitialized(smartAccount);
        if (!config.enabled) revert AgentReviewNotRequired();
        if (msg.sender != smartAccount && !_isOwnerOrAdmin(smartAccount, msg.sender)) {
            revert NotAuthorized();
        }
        if (address(agentPlatform) == address(0)) revert AgentNotConfigured();

        (address[] memory targets, uint256[] memory values, bytes[] memory data) =
            _decodeExecution(callData);

        bytes32 txHash = keccak256(callData);
        bool needsReview = _isBatch(callData, targets)
            || _needsAgentReview(smartAccount, config, targets, values, data);
        if (!needsReview) revert AgentReviewNotRequired();

        if (pendingRiskReviewRequestId[smartAccount] != 0) revert AgentRequestPending();

        uint256 deposit = _agentDeposit();
        if (agentBudgetOf[smartAccount] < deposit) revert AgentBudgetInsufficient();
        agentBudgetOf[smartAccount] -= deposit;

        string[] memory allowedValues = new string[](0);
        bytes memory payload = abi.encodeWithSelector(
            ILLMInferenceAgent.inferString.selector,
            _riskReviewPrompt(smartAccount, txHash, msg.sender, targets, values, data),
            _riskReviewSystemPrompt(),
            false,
            allowedValues
        );

        requestId = agentPlatform.createRequest{ value: deposit }(
            riskAssessmentAgentId,
            address(this),
            this.handleRiskAssessmentResponse.selector,
            payload
        );

        pendingRiskReviewRequestId[smartAccount] = requestId;
        pendingRiskReviewByRequestId[requestId] =
            PendingAgentReview({ smartAccount: smartAccount, txHash: txHash, signer: msg.sender });

        emit RiskAgentReviewRequested(requestId, smartAccount, txHash, msg.sender);
    }

    function handleRiskAssessmentResponse(
        uint256 requestId,
        Response[] memory responses,
        ResponseStatus status,
        Request memory
    ) external {
        if (msg.sender != address(agentPlatform)) {
            revert OnlyAgentPlatform();
        }

        PendingAgentReview memory pendingReview = pendingRiskReviewByRequestId[requestId];
        if (pendingReview.smartAccount == address(0)) revert UnknownAgentRequest();

        delete pendingRiskReviewByRequestId[requestId];
        delete pendingRiskReviewRequestId[pendingReview.smartAccount];

        bool approved;
        string memory reason;
        bytes32 decisionHash;
        if (status == ResponseStatus.Success && responses.length > 0) {
            (approved, reason, decisionHash) = _firstSuccessfulRiskDecision(responses);
        } else {
            reason = "agent request failed";
        }

        if (approved) {
            agentApprovals[pendingReview.smartAccount][pendingReview.txHash] = AgentApproval({
                exists: true,
                expiry: block.timestamp + AGENT_APPROVAL_TTL,
                decisionHash: decisionHash
            });
        }

        emit RiskAgentReviewCompleted(
            requestId, pendingReview.smartAccount, pendingReview.txHash, approved, reason
        );
    }

    function validateUserOp(PackedUserOperation calldata userOp, bytes32 userOpHash)
        external
        returns (uint256)
    {
        address smartAccount = msg.sender;
        Config storage config = configs[smartAccount];
        if (!config.initialized) revert NotInitialized(smartAccount);

        address signer =
            MessageHashUtils.toEthSignedMessageHash(userOpHash).recover(userOp.signature);
        if (!_isOwnerOrAdmin(smartAccount, signer)) {
            return VALIDATION_FAILED;
        }

        if (config.enabled) {
            _enforcePolicy(smartAccount, signer, config, userOp.callData);
        }

        return VALIDATION_SUCCESS;
    }

    function isValidSignatureWithSender(address, bytes32 hash, bytes calldata signature)
        external
        view
        returns (bytes4)
    {
        address smartAccount = msg.sender;
        bytes32 wrappedMessageHash = keccak256(abi.encode(hash));
        bytes32 typedDataHash = keccak256(abi.encode(MSG_TYPEHASH, wrappedMessageHash));
        bytes32 digest = MessageHashUtils.toTypedDataHash(_domainSeparator(), typedDataHash);
        address signer = digest.recover(signature);

        return _isOwnerOrAdmin(smartAccount, signer) ? ERC1271_MAGICVALUE : ERC1271_INVALID;
    }

    function wouldRequireReview(address smartAccount, bytes calldata callData)
        external
        view
        returns (bool, bytes32 txHash)
    {
        Config storage config = configs[smartAccount];
        if (!config.initialized) revert NotInitialized(smartAccount);
        if (!config.enabled) return (false, bytes32(0));

        (address[] memory targets, uint256[] memory values, bytes[] memory data) =
            _decodeExecution(callData);
        bool needs = _isBatch(callData, targets)
            || _needsAgentReview(smartAccount, config, targets, values, data);

        return (needs, needs ? keccak256(callData) : bytes32(0));
    }

    function _enforcePolicy(
        address smartAccount,
        address signer,
        Config storage config,
        bytes calldata callData
    ) internal {
        (address[] memory targets, uint256[] memory values, bytes[] memory data) =
            _decodeExecution(callData);

        bytes32 txHash = keccak256(callData);
        bool needsReview = _isBatch(callData, targets)
            || _needsAgentReview(smartAccount, config, targets, values, data);

        if (!needsReview) {
            emit TxAllowedByThreshold(
                smartAccount,
                values.length == 1 ? values[0] : 0,
                _resolveThreshold(smartAccount, config)
            );
            return;
        }

        if (approvalStore.hasValidApproval(smartAccount, txHash)) {
            approvalStore.consumeApproval(smartAccount, txHash);
            emit TxAllowedByApproval(smartAccount, txHash);
            return;
        }

        AgentApproval storage agentApproval = agentApprovals[smartAccount][txHash];
        if (agentApproval.exists && block.timestamp <= agentApproval.expiry) {
            delete agentApprovals[smartAccount][txHash];
            emit TxAllowedByAgent(smartAccount, txHash);
            return;
        }

        uint256 pendingRequestId = pendingRiskReviewRequestId[smartAccount];
        if (pendingRequestId != 0) {
            PendingAgentReview storage pendingReview =
                pendingRiskReviewByRequestId[pendingRequestId];
            if (pendingReview.txHash == txHash) {
                revert AgentReviewPending(smartAccount, txHash, pendingRequestId);
            }
        }

        revert PendingApprovalRequired(
            smartAccount, txHash, signer, abi.encode(targets, values, data)
        );
    }

    function _decodeExecution(bytes calldata callData)
        internal
        pure
        returns (address[] memory targets, uint256[] memory values, bytes[] memory data)
    {
        if (callData.length < 4 || bytes4(callData[:4]) != ERC7579_EXECUTE_SELECTOR) {
            targets = new address[](1);
            values = new uint256[](1);
            data = new bytes[](1);
            data[0] = callData;
            return (targets, values, data);
        }

        (bytes32 mode, bytes memory executionCalldata) = abi.decode(callData[4:], (bytes32, bytes));

        bytes1 callType = mode[0];
        if (callType == 0x00) {
            return _decodeSingle(executionCalldata);
        }
        if (callType == 0x01) {
            Execution[] memory executions = abi.decode(executionCalldata, (Execution[]));
            targets = new address[](executions.length);
            values = new uint256[](executions.length);
            data = new bytes[](executions.length);
            for (uint256 i; i < executions.length; ++i) {
                targets[i] = executions[i].target;
                values[i] = executions[i].value;
                data[i] = executions[i].callData;
            }
            return (targets, values, data);
        }

        targets = new address[](1);
        values = new uint256[](1);
        data = new bytes[](1);
        data[0] = executionCalldata;
    }

    function _decodeSingle(bytes memory executionCalldata)
        internal
        pure
        returns (address[] memory targets, uint256[] memory values, bytes[] memory data)
    {
        targets = new address[](1);
        values = new uint256[](1);
        data = new bytes[](1);

        if (executionCalldata.length < 52) {
            data[0] = executionCalldata;
            return (targets, values, data);
        }

        address target;
        uint256 value;
        assembly {
            target := shr(96, mload(add(executionCalldata, 32)))
            value := mload(add(executionCalldata, 52))
        }

        bytes memory innerData = new bytes(executionCalldata.length - 52);
        for (uint256 i; i < innerData.length; ++i) {
            innerData[i] = executionCalldata[i + 52];
        }

        targets[0] = target;
        values[0] = value;
        data[0] = innerData;
    }

    function _needsAgentReview(
        address smartAccount,
        Config storage config,
        address[] memory targets,
        uint256[] memory values,
        bytes[] memory data
    ) internal view returns (bool) {
        if (targets.length != 1) return true;
        if (values.length != 1 || data.length != 1) return true;
        if (data[0].length > 0) return true;
        if (targets[0] == address(0)) return true;
        if (_hasCode(targets[0])) return true;

        return values[0] >= _resolveThreshold(smartAccount, config);
    }

    function _resolveThreshold(address smartAccount, Config storage config)
        internal
        view
        returns (uint256)
    {
        if (config.mode == ThresholdMode.Fixed) {
            return config.thresholdValue;
        }

        uint256 balance = config.balanceToken == address(0)
            ? smartAccount.balance
            : IERC20BalanceOf(config.balanceToken).balanceOf(smartAccount);

        return (balance * config.thresholdValue) / BPS_TOTAL;
    }

    function _isBatch(bytes calldata callData, address[] memory targets)
        internal
        pure
        returns (bool)
    {
        if (targets.length > 1) return true;
        if (callData.length < 4 || bytes4(callData[:4]) != ERC7579_EXECUTE_SELECTOR) return false;

        (bytes32 mode,) = abi.decode(callData[4:], (bytes32, bytes));
        return mode[0] == 0x01;
    }

    function _isOwnerOrAdmin(address smartAccount, address signer) internal view returns (bool) {
        IThirdwebModularAccount account = IThirdwebModularAccount(smartAccount);
        return signer == account.owner() || account.hasAnyRole(signer, ADMIN_ROLE);
    }

    function _validateConfig(ThresholdMode mode, uint256 value) internal pure {
        if (uint8(mode) > uint8(ThresholdMode.Percent)) revert InvalidConfig();
        if (mode == ThresholdMode.Percent && value > BPS_TOTAL) revert InvalidConfig();
    }

    function _domainSeparator() internal view returns (bytes32) {
        return keccak256(
            abi.encode(DOMAIN_TYPEHASH, NAME_HASH, VERSION_HASH, block.chainid, address(this))
        );
    }

    function _hasCode(address target) internal view returns (bool) {
        uint256 size;
        assembly {
            size := extcodesize(target)
        }
        return size > 0;
    }

    function _agentDeposit() internal view returns (uint256) {
        return
            agentPlatform.getRequestDeposit() + (riskAgentRewardPerCall * AGENT_SUBCOMMITTEE_SIZE);
    }

    function decodeRiskDecision(bytes calldata result)
        external
        pure
        returns (bool approved, string memory reason)
    {
        string memory output = abi.decode(result, (string));
        bytes memory raw = bytes(output);

        if (_startsWith(raw, bytes("APPROVE:")) || _startsWith(raw, bytes("APPROVE"))) {
            return (true, output);
        }

        if (_startsWith(raw, bytes("REJECT:")) || _startsWith(raw, bytes("REJECT"))) {
            return (false, output);
        }

        return (false, string.concat("Agent response did not approve: ", output));
    }

    function _firstSuccessfulRiskDecision(Response[] memory responses)
        internal
        view
        returns (bool approved, string memory reason, bytes32 decisionHash)
    {
        for (uint256 i; i < responses.length; ++i) {
            if (responses[i].status != ResponseStatus.Success) {
                continue;
            }

            bytes memory result = responses[i].result;
            try this.decodeRiskDecision(result) returns (
                bool decodedApproved, string memory decodedReason
            ) {
                return (decodedApproved, decodedReason, keccak256(result));
            } catch {
                return (false, "malformed agent result", keccak256(result));
            }
        }

        return (false, "no successful agent response", bytes32(0));
    }

    function _riskReviewSystemPrompt() internal pure returns (string memory) {
        return string.concat(
            "You are Somnia RiskGuard. Review smart-account transactions for user safety. ",
            "Return exactly one concise line. Start with APPROVE: if the transaction is acceptable, ",
            "or REJECT: if it should remain blocked. Include a short concrete reason after the prefix."
        );
    }

    function _riskReviewPrompt(
        address smartAccount,
        bytes32 txHash,
        address signer,
        address[] memory targets,
        uint256[] memory values,
        bytes[] memory data
    ) internal pure returns (string memory prompt) {
        prompt = string.concat(
            "Review this Somnia smart-account transaction.\nSmart account: ",
            Strings.toHexString(smartAccount),
            "\nSigner: ",
            Strings.toHexString(signer),
            "\nTx hash: ",
            Strings.toHexString(uint256(txHash), 32),
            "\nRules: reject scams, suspicious contract calls, unexpected approvals, batches, ",
            "and transfers that look unsafe. Approve ordinary user-intended native transfers when reasonable.\n"
        );

        for (uint256 i; i < targets.length; ++i) {
            prompt = string.concat(
                prompt,
                "Call ",
                Strings.toString(i + 1),
                ": target=",
                Strings.toHexString(targets[i]),
                ", valueWei=",
                Strings.toString(values[i]),
                ", calldataBytes=",
                Strings.toString(data[i].length),
                ", selector=",
                _selectorString(data[i]),
                "\n"
            );
        }
    }

    function _selectorString(bytes memory data) internal pure returns (string memory) {
        if (data.length < 4) {
            return "0x";
        }

        bytes4 selector;
        assembly {
            selector := mload(add(data, 32))
        }

        return Strings.toHexString(uint32(selector), 4);
    }

    function _startsWith(bytes memory value, bytes memory prefix) internal pure returns (bool) {
        if (value.length < prefix.length) {
            return false;
        }

        for (uint256 i; i < prefix.length; ++i) {
            if (value[i] != prefix[i]) {
                return false;
            }
        }

        return true;
    }
}

interface IERC20BalanceOf {
    function balanceOf(address account) external view returns (uint256);
}
