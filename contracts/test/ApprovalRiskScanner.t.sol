// SPDX-License-Identifier: MIT
pragma solidity ^0.8.35;

import { ApprovalRiskScanner } from "../src/riskguard/ApprovalRiskScanner.sol";
import { ConsensusType, Request, Response, ResponseStatus } from "../src/SomniaAgentInterfaces.sol";

interface VmScanner {
    function deal(address account, uint256 balance) external;
    function expectRevert() external;
    function expectRevert(bytes4 selector) external;
    function prank(address sender) external;
}

contract MockScanAgentPlatform {
    uint256 public constant REQUEST_DEPOSIT = 0.02 ether;
    uint256 public nextRequestId = 1000;

    struct Recorded {
        uint256 agentId;
        bytes4 callbackSelector;
        uint256 value;
        bool exists;
    }

    mapping(uint256 => Recorded) public recorded;

    function getRequestDeposit() external pure returns (uint256) {
        return REQUEST_DEPOSIT;
    }

    function createRequest(
        uint256 agentId,
        address,
        bytes4 callbackSelector,
        bytes calldata
    ) external payable returns (uint256 requestId) {
        requestId = nextRequestId++;
        recorded[requestId] =
            Recorded({ agentId: agentId, callbackSelector: callbackSelector, value: msg.value, exists: true });
    }

    function respond(
        ApprovalRiskScanner scanner,
        uint256 requestId,
        string memory result,
        bool success
    ) external {
        Recorded memory rec = recorded[requestId];
        require(rec.exists, "no request");

        Response[] memory responses = new Response[](1);
        responses[0] = Response({
            validator: address(this),
            result: abi.encode(result),
            status: success ? ResponseStatus.Success : ResponseStatus.Failed,
            receipt: 0,
            timestamp: block.timestamp,
            executionCost: 0
        });
        ResponseStatus status = success ? ResponseStatus.Success : ResponseStatus.Failed;

        (bool ok, bytes memory returndata) = address(scanner).call(
            abi.encodeWithSelector(
                rec.callbackSelector,
                requestId,
                responses,
                status,
                _emptyRequest(requestId)
            )
        );
        if (!ok) {
            assembly {
                revert(add(returndata, 0x20), mload(returndata))
            }
        }
    }

    function _emptyRequest(uint256 requestId) private view returns (Request memory) {
        return Request({
            id: requestId,
            requester: msg.sender,
            callbackAddress: address(0),
            callbackSelector: bytes4(0),
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
        });
    }
}

contract ApprovalRiskScannerTest {
    VmScanner private constant vm =
        VmScanner(address(uint160(uint256(keccak256("hevm cheat code")))));

    ApprovalRiskScanner private scanner;
    MockScanAgentPlatform private platform;

    uint256 private constant JSON_ID = 11;
    uint256 private constant WEB_ID = 22;
    uint256 private constant INFER_ID = 33;

    function setUp() public {
        scanner = new ApprovalRiskScanner();
        platform = new MockScanAgentPlatform();
        scanner.configureAgents(address(platform), JSON_ID, WEB_ID, INFER_ID);
        vm.deal(address(this), 100 ether);
    }

    receive() external payable {}

    function _item(address spender) private pure returns (ApprovalRiskScanner.ApprovalItem memory) {
        return ApprovalRiskScanner.ApprovalItem({
            chainId: 50312,
            spender: spender,
            token: address(0xBEEF),
            context: "token=USDC; standard=erc20; allowance=unlimited",
            explorerApiUrl: "https://explorer/api?spender=x",
            explorerApiSelector: "result.isVerified",
            explorerPageUrl: "https://explorer/address/x"
        });
    }

    function testQuoteScanMatchesDeposit() public view {
        uint256 perCall = platform.REQUEST_DEPOSIT() + (scanner.agentRewardPerCall() * 3);
        require(scanner.quoteScan(0) == 0, "zero quote mismatch");
        require(scanner.quoteScan(1) == 3 * perCall, "one quote mismatch");
        require(scanner.quoteScan(47) == 3 * perCall, "batch quote mismatch");
    }

    function testRequestScanFiresThreeBatchStagesForAllItems() public {
        ApprovalRiskScanner.ApprovalItem[] memory items = new ApprovalRiskScanner.ApprovalItem[](2);
        items[0] = _item(address(0xABCD));
        items[1] = _item(address(0xDCBA));

        uint256 deposit = scanner.quoteScan(2);
        uint256 scanId = scanner.requestScan{ value: deposit }(items);
        uint256 perCallDeposit = deposit / 3;
        ApprovalRiskScanner.Scan memory scan0 = scanner.getScan(scanId);
        require(scan0.escrow == perCallDeposit, "inference escrow mismatch");
        require(scan0.itemCount == 2, "item count mismatch");

        (,, ApprovalRiskScanner.Stage jsonStage, bool jsonExists) = scanner.getRequestRef(1000);
        (,, ApprovalRiskScanner.Stage webStage, bool webExists) = scanner.getRequestRef(1001);
        require(jsonExists && jsonStage == ApprovalRiskScanner.Stage.JsonApi, "json batch missing");
        require(webExists && webStage == ApprovalRiskScanner.Stage.ParseWebsite, "web batch missing");

        platform.respond(scanner, 1000, "verified batch facts", true);
        ApprovalRiskScanner.ItemState memory s1 = scanner.getItem(scanId, 0);
        require(s1.jsonReturned && !s1.webReturned && !s1.inferenceFired, "premature inference");

        platform.respond(scanner, 1001, "no website red flags", true);
        ApprovalRiskScanner.ItemState memory s2 = scanner.getItem(scanId, 0);
        require(s2.jsonReturned && s2.webReturned && s2.inferenceFired, "inference not fired");
        ApprovalRiskScanner.Scan memory scan1 = scanner.getScan(scanId);
        require(scan1.escrow == 0, "inference escrow not spent");
        (,, ApprovalRiskScanner.Stage inferStage, bool inferExists) = scanner.getRequestRef(1002);
        require(inferExists && inferStage == ApprovalRiskScanner.Stage.Inference, "inference batch missing");
        (,,, bool extraExists) = scanner.getRequestRef(1003);
        require(!extraExists, "unexpected fourth request");

        platform.respond(scanner, 1002, "2 unlimited approvals; review spenders", true);
        ApprovalRiskScanner.ItemState memory s3 = scanner.getItem(scanId, 0);
        ApprovalRiskScanner.ItemState memory s4 = scanner.getItem(scanId, 1);
        require(s3.riskScore == 50, "score map failed");
        require(s4.riskScore == 50, "second score map failed");
        require(keccak256(bytes(s3.verdict)) == keccak256(bytes("MEDIUM")), "verdict map failed");
        require(s3.status == ApprovalRiskScanner.ItemStatus.Complete, "not complete");
        require(s4.status == ApprovalRiskScanner.ItemStatus.Complete, "second not complete");
        require(scanner.isScanComplete(scanId), "scan not complete");
    }

    function testBatchInferenceFailureFallsBackToDeterministicRisk() public {
        ApprovalRiskScanner.ApprovalItem[] memory items = new ApprovalRiskScanner.ApprovalItem[](1);
        items[0] = _item(address(0x1234));
        uint256 scanId = scanner.requestScan{ value: scanner.quoteScan(1) }(items);

        platform.respond(scanner, 1000, "", false);
        platform.respond(scanner, 1001, "", false);
        platform.respond(scanner, 1002, "", false);

        ApprovalRiskScanner.ItemState memory s = scanner.getItem(scanId, 0);
        require(s.riskScore == 50, "fallback score wrong");
        require(keccak256(bytes(s.verdict)) == keccak256(bytes("MEDIUM")), "fallback verdict wrong");
        require(bytes(s.jsonFacts).length != 0, "json fallback missing");
        require(bytes(s.webFindings).length != 0, "web fallback missing");
        require(s.status == ApprovalRiskScanner.ItemStatus.Complete, "not complete");
    }

    function testDuplicateCallbackIsNoop() public {
        ApprovalRiskScanner.ApprovalItem[] memory items = new ApprovalRiskScanner.ApprovalItem[](1);
        items[0] = _item(address(0x5555));
        scanner.requestScan{ value: scanner.quoteScan(1) }(items);

        platform.respond(scanner, 1000, "first", true);
        // Replaying the same requestId must revert (ref deleted).
        vm.expectRevert(ApprovalRiskScanner.UnknownAgentRequest.selector);
        platform.respond(scanner, 1000, "second", true);
    }

    function testInsufficientDepositReverts() public {
        ApprovalRiskScanner.ApprovalItem[] memory items = new ApprovalRiskScanner.ApprovalItem[](1);
        items[0] = _item(address(0x9999));
        vm.expectRevert();
        scanner.requestScan{ value: 1 wei }(items);
    }

    function testOnlyPlatformCanCallback() public {
        ApprovalRiskScanner.ApprovalItem[] memory items = new ApprovalRiskScanner.ApprovalItem[](1);
        items[0] = _item(address(0x7777));
        scanner.requestScan{ value: scanner.quoteScan(1) }(items);

        Response[] memory responses = new Response[](0);
        vm.expectRevert(ApprovalRiskScanner.OnlyAgentPlatform.selector);
        scanner.handleJsonApiResponse(1000, responses, ResponseStatus.Success, _emptyReq());
    }

    function _emptyReq() private pure returns (Request memory) {
        return Request({
            id: 0,
            requester: address(0),
            callbackAddress: address(0),
            callbackSelector: bytes4(0),
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
        });
    }
}
