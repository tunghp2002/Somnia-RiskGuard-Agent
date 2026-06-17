// SPDX-License-Identifier: MIT
pragma solidity ^0.8.35;

import {
    TelegramCheckInUserOperation,
    TelegramCheckInValidator
} from "../src/riskguard/TelegramCheckInValidator.sol";

interface VmTelegramCheckIn {
    function addr(uint256 privateKey) external returns (address);
    function expectRevert(bytes4 selector) external;
    function prank(address sender) external;
    function sign(uint256 privateKey, bytes32 digest)
        external
        returns (uint8 v, bytes32 r, bytes32 s);
}

contract TelegramCheckInValidatorTest {
    VmTelegramCheckIn private constant vm =
        VmTelegramCheckIn(address(uint160(uint256(keccak256("hevm cheat code")))));

    uint256 private constant CHECK_IN_KEY = 0xC1EC1;
    uint256 private constant WRONG_KEY = 0xBAD;
    address private constant SMART_ACCOUNT = address(0xA11CE);
    address private constant INHERITANCE_REGISTRY = address(0xBEEF);

    TelegramCheckInValidator private validator;
    address private checkInSigner;

    function setUp() public {
        validator = new TelegramCheckInValidator(INHERITANCE_REGISTRY);
        checkInSigner = vm.addr(CHECK_IN_KEY);

        vm.prank(SMART_ACCOUNT);
        validator.onInstall(abi.encode(checkInSigner));
    }

    function testValidateAllowsConfiguredSignerForCheckInOnly() public {
        bytes memory callData =
            _singleExecute(INHERITANCE_REGISTRY, 0, abi.encodeWithSignature("checkIn()"));
        bytes32 userOpHash = keccak256("telegram checkin user op");
        TelegramCheckInUserOperation memory userOp =
            _signedUserOp(callData, userOpHash, CHECK_IN_KEY);

        vm.prank(SMART_ACCOUNT);
        uint256 validationData = validator.validateUserOp(userOp, userOpHash);

        assert(validationData == validator.VALIDATION_SUCCESS());
        assert(validator.wouldValidateCheckIn(SMART_ACCOUNT, callData));
    }

    function testValidateAllowsThirdwebWrappedSignature() public {
        bytes memory callData =
            _singleExecute(INHERITANCE_REGISTRY, 0, abi.encodeWithSignature("checkIn()"));
        bytes32 userOpHash = keccak256("telegram checkin wrapped user op");
        TelegramCheckInUserOperation memory userOp =
            _signedUserOp(callData, userOpHash, CHECK_IN_KEY);
        userOp.signature = abi.encode(address(validator), userOp.signature);

        vm.prank(SMART_ACCOUNT);
        uint256 validationData = validator.validateUserOp(userOp, userOpHash);

        assert(validationData == validator.VALIDATION_SUCCESS());
    }

    function testValidateRejectsWrappedSignatureForAnotherValidator() public {
        bytes memory callData =
            _singleExecute(INHERITANCE_REGISTRY, 0, abi.encodeWithSignature("checkIn()"));
        bytes32 userOpHash = keccak256("telegram checkin wrong wrapped validator");
        TelegramCheckInUserOperation memory userOp =
            _signedUserOp(callData, userOpHash, CHECK_IN_KEY);
        userOp.signature = abi.encode(address(0xCAFE), userOp.signature);

        vm.prank(SMART_ACCOUNT);
        uint256 validationData = validator.validateUserOp(userOp, userOpHash);

        assert(validationData == validator.VALIDATION_FAILED());
    }

    function testValidateRejectsWrongSigner() public {
        bytes memory callData =
            _singleExecute(INHERITANCE_REGISTRY, 0, abi.encodeWithSignature("checkIn()"));
        bytes32 userOpHash = keccak256("telegram checkin wrong signer");
        TelegramCheckInUserOperation memory userOp =
            _signedUserOp(callData, userOpHash, WRONG_KEY);

        vm.prank(SMART_ACCOUNT);
        uint256 validationData = validator.validateUserOp(userOp, userOpHash);

        assert(validationData == validator.VALIDATION_FAILED());
    }

    function testValidateRejectsNonCheckInCall() public {
        bytes memory callData =
            _singleExecute(INHERITANCE_REGISTRY, 0, abi.encodeWithSignature("cancelPlan()"));
        bytes32 userOpHash = keccak256("telegram checkin non checkin");
        TelegramCheckInUserOperation memory userOp =
            _signedUserOp(callData, userOpHash, CHECK_IN_KEY);

        vm.prank(SMART_ACCOUNT);
        uint256 validationData = validator.validateUserOp(userOp, userOpHash);

        assert(validationData == validator.VALIDATION_FAILED());
        assert(!validator.wouldValidateCheckIn(SMART_ACCOUNT, callData));
    }

    function testInstallRequiresSigner() public {
        TelegramCheckInValidator fresh = new TelegramCheckInValidator(INHERITANCE_REGISTRY);

        vm.expectRevert(TelegramCheckInValidator.ZeroAddress.selector);
        vm.prank(SMART_ACCOUNT);
        fresh.onInstall(abi.encode(address(0)));
    }

    function _signedUserOp(bytes memory callData, bytes32 userOpHash, uint256 signerKey)
        private
        returns (TelegramCheckInUserOperation memory userOp)
    {
        bytes32 digest = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", userOpHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(signerKey, digest);

        userOp.sender = SMART_ACCOUNT;
        userOp.callData = callData;
        userOp.signature = abi.encodePacked(r, s, v);
    }

    function _singleExecute(address target, uint256 value, bytes memory innerCallData)
        private
        pure
        returns (bytes memory)
    {
        bytes32 singleMode = bytes32(0);
        bytes memory executionCalldata = abi.encodePacked(target, value, innerCallData);
        return abi.encodeWithSignature("execute(bytes32,bytes)", singleMode, executionCalldata);
    }
}
