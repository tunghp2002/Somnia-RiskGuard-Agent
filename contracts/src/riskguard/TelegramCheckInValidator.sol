// SPDX-License-Identifier: MIT
pragma solidity ^0.8.35;

import { ECDSA } from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import { MessageHashUtils } from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

struct TelegramCheckInUserOperation {
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
 * @title TelegramCheckInValidator
 * @notice ERC-7579 validator module for a single narrow automation path:
 *         a configured signer may only call RiskGuardInheritanceRegistry.checkIn()
 *         from the smart account that installed this module.
 */
contract TelegramCheckInValidator {
    using ECDSA for bytes32;

    uint256 public constant MODULE_TYPE_VALIDATOR = 1;
    uint256 public constant VALIDATION_SUCCESS = 0;
    uint256 public constant VALIDATION_FAILED = 1;

    bytes4 public constant ERC7579_EXECUTE_SELECTOR = bytes4(keccak256("execute(bytes32,bytes)"));
    bytes4 public constant INHERITANCE_CHECK_IN_SELECTOR = bytes4(keccak256("checkIn()"));
    bytes4 public constant ERC1271_MAGICVALUE = 0x1626ba7e;
    bytes4 public constant ERC1271_INVALID = 0xffffffff;

    address public immutable inheritanceRegistry;
    mapping(address => address) public checkInSignerOf;

    error ZeroAddress();
    error AlreadyInitialized(address smartAccount);
    error NotInitialized(address smartAccount);
    error InvalidCheckInCall();

    event ModuleInstalled(address indexed smartAccount, address indexed checkInSigner);
    event ModuleUninstalled(address indexed smartAccount);
    event CheckInSignerUpdated(address indexed smartAccount, address indexed checkInSigner);

    constructor(address inheritanceRegistry_) {
        if (inheritanceRegistry_ == address(0)) revert ZeroAddress();
        inheritanceRegistry = inheritanceRegistry_;
    }

    function onInstall(bytes calldata initData) external {
        address smartAccount = msg.sender;
        if (checkInSignerOf[smartAccount] != address(0)) revert AlreadyInitialized(smartAccount);

        address checkInSigner = abi.decode(initData, (address));
        if (checkInSigner == address(0)) revert ZeroAddress();

        checkInSignerOf[smartAccount] = checkInSigner;
        emit ModuleInstalled(smartAccount, checkInSigner);
    }

    function onUninstall(bytes calldata) external {
        address smartAccount = msg.sender;
        if (checkInSignerOf[smartAccount] == address(0)) revert NotInitialized(smartAccount);

        delete checkInSignerOf[smartAccount];
        emit ModuleUninstalled(smartAccount);
    }

    function setCheckInSigner(address checkInSigner) external {
        if (checkInSigner == address(0)) revert ZeroAddress();
        if (checkInSignerOf[msg.sender] == address(0)) revert NotInitialized(msg.sender);

        checkInSignerOf[msg.sender] = checkInSigner;
        emit CheckInSignerUpdated(msg.sender, checkInSigner);
    }

    function isModuleType(uint256 moduleTypeId) external pure returns (bool) {
        return moduleTypeId == MODULE_TYPE_VALIDATOR;
    }

    function isInitialized(address smartAccount) external view returns (bool) {
        return checkInSignerOf[smartAccount] != address(0);
    }

    function validateUserOp(
        TelegramCheckInUserOperation calldata userOp,
        bytes32 userOpHash
    ) external view returns (uint256) {
        address signer = checkInSignerOf[msg.sender];
        if (signer == address(0)) revert NotInitialized(msg.sender);

        address recovered = _recoverSigner(userOpHash, userOp.signature);
        if (recovered != signer) return VALIDATION_FAILED;
        if (!_isCheckInCall(userOp.callData)) return VALIDATION_FAILED;

        return VALIDATION_SUCCESS;
    }

    function isValidSignatureWithSender(address, bytes32 hash, bytes calldata signature)
        external
        view
        returns (bytes4)
    {
        address signer = checkInSignerOf[msg.sender];
        if (signer == address(0)) return ERC1271_INVALID;

        address recovered = _recoverSigner(hash, signature);
        return recovered == signer ? ERC1271_MAGICVALUE : ERC1271_INVALID;
    }

    function wouldValidateCheckIn(address smartAccount, bytes calldata callData)
        external
        view
        returns (bool)
    {
        return checkInSignerOf[smartAccount] != address(0) && _isCheckInCall(callData);
    }

    function _isCheckInCall(bytes calldata callData) internal view returns (bool) {
        if (callData.length < 4 || bytes4(callData[:4]) != ERC7579_EXECUTE_SELECTOR) {
            return false;
        }

        (bytes32 mode, bytes memory executionCalldata) = abi.decode(callData[4:], (bytes32, bytes));
        if (mode[0] != 0x00 || executionCalldata.length != 56) return false;

        address target;
        uint256 value;
        bytes4 selector;
        assembly {
            target := shr(96, mload(add(executionCalldata, 32)))
            value := mload(add(executionCalldata, 52))
            selector := mload(add(executionCalldata, 84))
        }

        return target == inheritanceRegistry && value == 0 && selector == INHERITANCE_CHECK_IN_SELECTOR;
    }

    function _recoverSigner(bytes32 hash, bytes calldata signature) internal view returns (address) {
        if (signature.length == 65) {
            return MessageHashUtils.toEthSignedMessageHash(hash).recover(signature);
        }

        (address validator, bytes memory wrappedSignature) = abi.decode(signature, (address, bytes));
        if (validator != address(this)) return address(0);
        return MessageHashUtils.toEthSignedMessageHash(hash).recover(wrappedSignature);
    }
}
