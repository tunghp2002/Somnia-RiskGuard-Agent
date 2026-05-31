// SPDX-License-Identifier: MIT
pragma solidity ^0.8.35;

/**
 * @title RiskGuardHookModule
 * @notice ERC-7579 Hook Module that intercepts Smart Account executions.
 *
 * Expected flow:
 * 1. Every SmartAccount.execute()/executeBatch() reaches preCheck().
 * 2. A single native transfer to an EOA below threshold passes immediately.
 * 3. Everything else needs a valid ApprovalStore approval for keccak256(msgData).
 * 4. Missing approval reverts with PendingApprovalRequired. The Agent should read
 *    revert data from simulation/UserOp failure, not from an event log.
 * 5. postCheck() consumes the approval after successful execution.
 *
 * Setup note:
 * The smart account must register both its Agent and this Hook in ApprovalStore,
 * for example ApprovalStore.registerAgentAndHook(agent, hookModule).
 */

interface IRiskGuardApprovalStore {
    function hasValidApproval(address smartAccount, bytes32 txHash) external view returns (bool);
    function consumeApproval(address smartAccount, bytes32 txHash) external;
}

interface IERC20BalanceOf {
    function balanceOf(address account) external view returns (uint256);
}

contract RiskGuardHookModule {
    uint256 public constant BPS_TOTAL = 10_000;

    // executeBatch(address[],uint256[],bytes[])
    bytes4 public constant EXECUTE_BATCH_SELECTOR =
        bytes4(keccak256("executeBatch(address[],uint256[],bytes[])"));

    // execute(address,uint256,bytes)
    bytes4 public constant EXECUTE_SELECTOR = bytes4(keccak256("execute(address,uint256,bytes)"));

    // ERC-7579 execute(bytes32,bytes)
    bytes4 public constant ERC7579_EXECUTE_SELECTOR = bytes4(keccak256("execute(bytes32,bytes)"));

    // ERC-7579 module type = 4 (Hook)
    uint256 public constant MODULE_TYPE_HOOK = 4;

    enum ThresholdMode {
        Fixed,
        Percent
    }

    struct Config {
        bool installed;
        ThresholdMode mode;
        uint256 thresholdValue; // wei (Fixed) or bps (Percent)
        address balanceToken; // address(0) = native STT, else ERC-20
    }

    struct Execution {
        address target;
        uint256 value;
        bytes callData;
    }

    IRiskGuardApprovalStore public immutable approvalStore;

    mapping(address => Config) public configs;

    error NotInstalled();
    error ZeroAddress();
    error InvalidConfig();
    error PendingApprovalRequired(
        address smartAccount, bytes32 txHash, address msgSender, bytes riskContext
    );

    event ModuleInstalled(address indexed smartAccount, address indexed agent);
    event ModuleUninstalled(address indexed smartAccount);
    event ConfigUpdated(address indexed smartAccount);
    event TxAllowedByThreshold(address indexed smartAccount, uint256 value, uint256 threshold);
    event TxAllowedByApproval(address indexed smartAccount, bytes32 txHash);

    constructor(address _approvalStore) {
        if (_approvalStore == address(0)) revert ZeroAddress();
        approvalStore = IRiskGuardApprovalStore(_approvalStore);
    }

    /**
     * @notice Called by SmartAccount.installModule().
     * @param initData abi.encode(address agent, ThresholdMode mode, uint256 value, address balanceToken)
     */
    function onInstall(bytes calldata initData) external {
        address smartAccount = msg.sender;
        (address agent, ThresholdMode mode, uint256 value, address balanceToken) =
            abi.decode(initData, (address, ThresholdMode, uint256, address));

        if (agent == address(0)) revert ZeroAddress();
        _validateConfig(mode, value);

        configs[smartAccount] = Config({
            installed: true, mode: mode, thresholdValue: value, balanceToken: balanceToken
        });

        emit ModuleInstalled(smartAccount, agent);
    }

    function onUninstall(bytes calldata) external {
        delete configs[msg.sender];
        emit ModuleUninstalled(msg.sender);
    }

    function setConfig(ThresholdMode mode, uint256 value, address balanceToken) external {
        Config storage config = configs[msg.sender];
        if (!config.installed) revert NotInstalled();
        _validateConfig(mode, value);

        config.mode = mode;
        config.thresholdValue = value;
        config.balanceToken = balanceToken;

        emit ConfigUpdated(msg.sender);
    }

    /**
     * @notice Called by SmartAccount before every execution.
     * @param msgSender Original caller of the SmartAccount.
     * @param msgValue Native value sent with the SmartAccount call.
     * @param msgData SmartAccount execution calldata.
     */
    function preCheck(address msgSender, uint256 msgValue, bytes calldata msgData)
        external
        returns (bytes memory hookData)
    {
        address smartAccount = msg.sender;
        Config storage config = configs[smartAccount];
        if (!config.installed) revert NotInstalled();

        (address[] memory targets, uint256[] memory values, bytes[] memory data) =
            _decodeExecution(msgData);

        bytes32 txHash = keccak256(msgData);
        bool needsReview = _isBatchExecution(msgData, targets)
            || _needsAgentReview(smartAccount, config, targets, values, data);

        if (!needsReview) {
            emit TxAllowedByThreshold(
                smartAccount, msgValue, _resolveThreshold(smartAccount, config)
            );
            return abi.encode(bytes32(0));
        }

        if (approvalStore.hasValidApproval(smartAccount, txHash)) {
            emit TxAllowedByApproval(smartAccount, txHash);
            return abi.encode(txHash);
        }

        revert PendingApprovalRequired(
            smartAccount, txHash, msgSender, abi.encode(targets, values, data)
        );
    }

    /**
     * @notice Called by SmartAccount after successful execution.
     *         Consumes the approval for one-time use.
     */
    function postCheck(bytes calldata hookData) external {
        Config storage config = configs[msg.sender];
        if (!config.installed) revert NotInstalled();

        bytes32 txHash = abi.decode(hookData, (bytes32));
        if (txHash == bytes32(0)) return;

        approvalStore.consumeApproval(msg.sender, txHash);
    }

    function getConfig(address smartAccount) external view returns (Config memory) {
        return configs[smartAccount];
    }

    function resolvedThreshold(address smartAccount) external view returns (uint256) {
        return _resolveThreshold(smartAccount, configs[smartAccount]);
    }

    /**
     * @notice Preview whether a given execution calldata requires Agent review.
     */
    function wouldRequireReview(address smartAccount, bytes calldata msgData)
        external
        view
        returns (bool, bytes32 txHash)
    {
        Config storage config = configs[smartAccount];
        if (!config.installed) revert NotInstalled();

        (address[] memory targets, uint256[] memory values, bytes[] memory data) =
            _decodeExecution(msgData);

        bool needs = _isBatchExecution(msgData, targets)
            || _needsAgentReview(smartAccount, config, targets, values, data);

        return (needs, needs ? keccak256(msgData) : bytes32(0));
    }

    function moduleTypeId() external pure returns (uint256) {
        return MODULE_TYPE_HOOK;
    }

    function isModuleType(uint256 moduleType) external pure returns (bool) {
        return moduleType == MODULE_TYPE_HOOK;
    }

    function _decodeExecution(bytes calldata msgData)
        internal
        pure
        returns (address[] memory targets, uint256[] memory values, bytes[] memory data)
    {
        if (msgData.length < 4) {
            targets = new address[](0);
            values = new uint256[](0);
            data = new bytes[](0);
            return (targets, values, data);
        }

        bytes4 selector = bytes4(msgData[:4]);

        if (selector == EXECUTE_SELECTOR) {
            (address target, uint256 value, bytes memory callData) =
                abi.decode(msgData[4:], (address, uint256, bytes));

            targets = new address[](1);
            values = new uint256[](1);
            data = new bytes[](1);

            targets[0] = target;
            values[0] = value;
            data[0] = callData;
        } else if (selector == EXECUTE_BATCH_SELECTOR) {
            (targets, values, data) = abi.decode(msgData[4:], (address[], uint256[], bytes[]));
        } else if (selector == ERC7579_EXECUTE_SELECTOR) {
            (bytes32 mode, bytes memory executionCalldata) =
                abi.decode(msgData[4:], (bytes32, bytes));
            return _decodeErc7579Execution(mode, executionCalldata);
        } else {
            targets = new address[](1);
            values = new uint256[](1);
            data = new bytes[](1);

            targets[0] = address(0);
            values[0] = 0;
            data[0] = msgData;
        }
    }

    function _decodeErc7579Execution(bytes32 mode, bytes memory executionCalldata)
        internal
        pure
        returns (address[] memory targets, uint256[] memory values, bytes[] memory data)
    {
        bytes1 callType = mode[0];

        if (callType == 0x00) {
            if (executionCalldata.length < 52) {
                targets = new address[](1);
                values = new uint256[](1);
                data = new bytes[](1);
                data[0] = executionCalldata;
                return (targets, values, data);
            }

            address target;
            uint256 value;
            assembly {
                target := shr(96, mload(add(executionCalldata, 32)))
                value := mload(add(executionCalldata, 52))
            }

            bytes memory callData = new bytes(executionCalldata.length - 52);
            for (uint256 i; i < callData.length; ++i) {
                callData[i] = executionCalldata[i + 52];
            }

            targets = new address[](1);
            values = new uint256[](1);
            data = new bytes[](1);
            targets[0] = target;
            values[0] = value;
            data[0] = callData;
        } else if (callType == 0x01) {
            Execution[] memory executions = abi.decode(executionCalldata, (Execution[]));
            targets = new address[](executions.length);
            values = new uint256[](executions.length);
            data = new bytes[](executions.length);

            for (uint256 i; i < executions.length; ++i) {
                targets[i] = executions[i].target;
                values[i] = executions[i].value;
                data[i] = executions[i].callData;
            }
        } else {
            targets = new address[](1);
            values = new uint256[](1);
            data = new bytes[](1);
            data[0] = executionCalldata;
        }
    }

    /**
     * @dev Only a single native transfer to an EOA with value below threshold bypasses review.
     *      Contract calls, contract recipients, zero/invalid calldata, and large sends need approval.
     */
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

        uint256 threshold = _resolveThreshold(smartAccount, config);
        return values[0] >= threshold;
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

    function _isBatchExecution(bytes calldata msgData, address[] memory targets)
        internal
        pure
        returns (bool)
    {
        return msgData.length >= 4 && bytes4(msgData[:4]) == EXECUTE_BATCH_SELECTOR
            || targets.length > 1;
    }

    function _validateConfig(ThresholdMode mode, uint256 value) internal pure {
        if (uint8(mode) > uint8(ThresholdMode.Percent)) revert InvalidConfig();
        if (mode == ThresholdMode.Percent && value > BPS_TOTAL) revert InvalidConfig();
    }

    function _hasCode(address target) internal view returns (bool) {
        uint256 size;
        assembly {
            size := extcodesize(target)
        }
        return size > 0;
    }
}
