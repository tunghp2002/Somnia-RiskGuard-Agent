// SPDX-License-Identifier: MIT
pragma solidity ^0.8.35;

import { RiskGuardValidator, PackedUserOperation } from "../src/riskguard/RiskGuardValidator.sol";
import { ConsensusType, Request, Response, ResponseStatus } from "../src/SomniaAgentInterfaces.sol";

interface VmRiskGuard {
    function addr(uint256 privateKey) external returns (address);
    function deal(address account, uint256 balance) external;
    function expectRevert() external;
    function expectRevert(bytes4 selector) external;
    function prank(address sender) external;
    function sign(uint256 privateKey, bytes32 digest)
        external
        returns (uint8 v, bytes32 r, bytes32 s);
}

contract MockRiskGuardApprovalStore {
    mapping(address => mapping(bytes32 => bool)) public approvals;

    function hasValidApproval(address smartAccount, bytes32 txHash) external view returns (bool) {
        return approvals[smartAccount][txHash];
    }

    function consumeApproval(address smartAccount, bytes32 txHash) external {
        approvals[smartAccount][txHash] = false;
    }
}

contract MockRiskGuardSmartAccount {
    address public owner;

    constructor(address owner_) {
        owner = owner_;
    }

    function hasAnyRole(address, uint256) external pure returns (bool) {
        return false;
    }
}

contract MockRiskAgentPlatform {
    uint256 public constant REQUEST_DEPOSIT = 0.02 ether;
    uint256 public nextRequestId = 100;
    uint256 public lastRequestId;
    uint256 public lastValue;
    bytes public lastPayload;

    function getRequestDeposit() external pure returns (uint256) {
        return REQUEST_DEPOSIT;
    }

    function createRequest(uint256, address, bytes4, bytes calldata payload)
        external
        payable
        returns (uint256 requestId)
    {
        lastValue = msg.value;
        lastPayload = payload;
        requestId = nextRequestId++;
        lastRequestId = requestId;
    }

    function respond(
        RiskGuardValidator validator,
        uint256 requestId,
        bool approved,
        string calldata reason
    ) external {
        Response[] memory responses = new Response[](1);
        responses[0] = Response({
            validator: address(this),
            result: abi.encode(approved, reason),
            status: ResponseStatus.Success,
            receipt: 0,
            timestamp: block.timestamp,
            executionCost: 0
        });

        validator.handleRiskAssessmentResponse(
            requestId,
            responses,
            ResponseStatus.Success,
            Request({
                id: requestId,
                requester: address(validator),
                callbackAddress: address(validator),
                callbackSelector: validator.handleRiskAssessmentResponse.selector,
                subcommittee: new address[](0),
                responses: new Response[](0),
                responseCount: 0,
                failureCount: 0,
                threshold: 0,
                createdAt: 0,
                deadline: 0,
                status: ResponseStatus.Success,
                consensusType: ConsensusType.Majority,
                remainingBudget: 0,
                perAgentBudget: 0
            })
        );
    }
}

contract RiskGuardValidatorTest {
    VmRiskGuard private constant vm =
        VmRiskGuard(address(uint160(uint256(keccak256("hevm cheat code")))));

    uint256 private constant OWNER_KEY = 0xA11CE;
    address private owner;

    MockRiskGuardApprovalStore private store;
    RiskGuardValidator private validator;
    MockRiskGuardSmartAccount private smartAccount;
    MockRiskAgentPlatform private platform;

    function setUp() public {
        store = new MockRiskGuardApprovalStore();
        owner = vm.addr(OWNER_KEY);
        validator = new RiskGuardValidator(address(store));
        smartAccount = new MockRiskGuardSmartAccount(owner);
        platform = new MockRiskAgentPlatform();

        vm.deal(address(this), 10 ether);
        vm.deal(owner, 1 ether);

        vm.prank(address(smartAccount));
        validator.onInstall(
            abi.encode(true, RiskGuardValidator.ThresholdMode.Fixed, 1 ether, address(0))
        );
        validator.configureRiskAgent(address(platform), 77);
        validator.fundAgentBudget{ value: 1 ether }(address(smartAccount));
    }

    function testAgentReviewCreatesRequestAndApprovalAllowsUserOp() public {
        bytes memory callData = hex"12345678";
        bytes32 userOpHash = keccak256("riskguard user op");
        PackedUserOperation memory userOp = _signedUserOp(callData, userOpHash);
        bytes32 txHash = keccak256(callData);

        vm.expectRevert();
        vm.prank(address(smartAccount));
        validator.validateUserOp(userOp, userOpHash);

        vm.prank(owner);
        uint256 requestId = validator.requestAgentReview(address(smartAccount), callData);

        assert(requestId == platform.lastRequestId());
        assert(validator.pendingRiskReviewRequestId(address(smartAccount)) == requestId);
        assert(platform.lastValue() == 0.05 ether);

        vm.expectRevert();
        vm.prank(address(smartAccount));
        validator.validateUserOp(userOp, userOpHash);

        platform.respond(validator, requestId, true, "approved by risk agent");

        assert(validator.pendingRiskReviewRequestId(address(smartAccount)) == 0);
        (bool exists,, bytes32 decisionHash) =
            validator.agentApprovals(address(smartAccount), txHash);
        assert(exists);
        assert(decisionHash == keccak256(abi.encode(true, "approved by risk agent")));

        vm.prank(address(smartAccount));
        uint256 validationData = validator.validateUserOp(userOp, userOpHash);

        assert(validationData == validator.VALIDATION_SUCCESS());

        (bool consumed,,) = validator.agentApprovals(address(smartAccount), txHash);
        assert(!consumed);
    }

    function _signedUserOp(bytes memory callData, bytes32 userOpHash)
        private
        returns (PackedUserOperation memory userOp)
    {
        bytes32 digest = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", userOpHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(OWNER_KEY, digest);

        userOp.sender = address(smartAccount);
        userOp.callData = callData;
        userOp.signature = abi.encodePacked(r, s, v);
    }
}
