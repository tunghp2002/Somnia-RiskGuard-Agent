// SPDX-License-Identifier: MIT
pragma solidity ^0.8.35;

import {
    AgentRequest,
    ConsensusType,
    Response,
    ResponseStatus,
    RiskGuardInheritanceRegistry
} from "../src/InheritanceRegistry.sol";

interface VmRegistry {
    function deal(address account, uint256 balance) external;
    function etch(address target, bytes calldata newRuntimeBytecode) external;
    function expectRevert() external;
    function expectRevert(bytes4 selector) external;
    function prank(address sender) external;
    function warp(uint256 timestamp) external;
}

contract MockToken {
    mapping(address => uint256) public balanceOf;

    function mint(address account, uint256 amount) external {
        balanceOf[account] += amount;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        require(balanceOf[msg.sender] >= amount, "insufficient token balance");
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}

contract MockSmartAccount {
    mapping(address => bool) public authorizedExecutor;

    receive() external payable { }

    function setAuthorizedExecutor(address executor, bool authorized) external {
        authorizedExecutor[executor] = authorized;
    }

    function executeBatch(
        address[] calldata targets,
        uint256[] calldata values,
        bytes[] calldata data
    ) external returns (bytes[] memory results) {
        require(authorizedExecutor[msg.sender], "unauthorized executor");
        require(targets.length == values.length && values.length == data.length, "array mismatch");

        results = new bytes[](targets.length);
        for (uint256 i; i < targets.length; ++i) {
            (bool ok, bytes memory result) = targets[i].call{ value: values[i] }(data[i]);
            require(ok, "account call failed");
            results[i] = result;
        }
    }
}

contract MockAgentPlatform {
    uint256 public constant REQUEST_DEPOSIT = 0.02 ether;
    uint256 public nextRequestId = 41;
    uint256 public lastRequestId;
    uint256 public lastValue;

    function getRequestDeposit() external pure returns (uint256) {
        return REQUEST_DEPOSIT;
    }

    function createRequest(uint256, address, bytes4, bytes calldata)
        external
        payable
        returns (uint256 requestId)
    {
        lastValue = msg.value;
        requestId = nextRequestId++;
        lastRequestId = requestId;
    }

    function respondHeartbeat(
        RiskGuardInheritanceRegistry registry,
        uint256 requestId,
        ResponseStatus status
    ) external {
        registry.handleHeartbeatResponse(
            requestId,
            _responses(status),
            status,
            AgentRequest({
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
                status: ResponseStatus.None,
                consensusType: ConsensusType.Majority,
                remainingBudget: 0,
                perAgentBudget: 0
            })
        );
    }

    function respondDistribution(
        RiskGuardInheritanceRegistry registry,
        uint256 requestId,
        ResponseStatus status
    ) external {
        registry.handleDistributionResponse(
            requestId,
            _responses(status),
            status,
            AgentRequest({
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
                status: ResponseStatus.None,
                consensusType: ConsensusType.Majority,
                remainingBudget: 0,
                perAgentBudget: 0
            })
        );
    }

    function _responses(ResponseStatus status) private view returns (Response[] memory responses) {
        responses = status == ResponseStatus.Success ? new Response[](1) : new Response[](0);
        if (responses.length == 1) {
            responses[0].validator = address(this);
            responses[0].status = ResponseStatus.Success;
            responses[0].timestamp = block.timestamp;
        }
    }

    receive() external payable { }
}

contract RevertingReceiver {
    receive() external payable {
        revert("reject native");
    }
}

contract MockReactivityPrecompile {
    function invoke(
        RiskGuardInheritanceRegistry registry,
        address emitter,
        bytes32[] calldata eventTopics,
        bytes calldata data
    ) external {
        registry.onEvent(emitter, eventTopics, data);
    }
}

contract InheritanceRegistryTest {
    VmRegistry private constant vm =
        VmRegistry(address(uint160(uint256(keccak256("hevm cheat code")))));

    address private constant BENEFICIARY_A = address(0xB0B);
    address private constant BENEFICIARY_B = address(0xCAFE);
    address private constant AGENT = address(0xA6E17);
    RiskGuardInheritanceRegistry private registry;
    MockSmartAccount private smartAccount;
    MockToken private token;
    MockAgentPlatform private platform;

    function setUp() public {
        vm.warp(1_000 days);
        registry = new RiskGuardInheritanceRegistry();
        smartAccount = new MockSmartAccount();
        token = new MockToken();
        platform = new MockAgentPlatform();
        smartAccount.setAuthorizedExecutor(address(registry), true);
        vm.etch(registry.somniaReactivityPrecompile(), address(new MockReactivityPrecompile()).code);
    }

    function testCreatePlanStoresActivePlanTimingBeneficiariesAndAssets() public {
        vm.prank(address(smartAccount));
        registry.createPlan(_beneficiaries60_40(), _nativeAndTokenAssets(), 30 days, 7 days, 2 days);

        (
            RiskGuardInheritanceRegistry.Plan memory plan,
            RiskGuardInheritanceRegistry.Beneficiary[] memory beneficiaries,
            RiskGuardInheritanceRegistry.ProtectedAsset[] memory assets
        ) = registry.getPlan(address(smartAccount));

        assert(plan.smartAccount == address(smartAccount));
        assert(plan.state == RiskGuardInheritanceRegistry.PlanState.Active);
        assert(plan.lastHeartbeatAt == 1_000 days);
        assert(registry.nextDeadlineAt(address(smartAccount)) == 1_030 days);
        assert(registry.graceEndsAt(address(smartAccount)) == 1_037 days);
        assert(registry.timelockEndsAt(address(smartAccount)) == 1_039 days);
        assert(beneficiaries.length == 2);
        assert(beneficiaries[0].addr == BENEFICIARY_A);
        assert(beneficiaries[0].shareBps == 6_000);
        assert(beneficiaries[1].addr == BENEFICIARY_B);
        assert(beneficiaries[1].shareBps == 4_000);
        assert(assets.length == 2);
        assert(assets[0].token == address(0));
        assert(assets[1].token == address(token));
    }

    function testRejectsEOAPlanCreation() public {
        vm.expectRevert(RiskGuardInheritanceRegistry.NotSmartAccount.selector);
        vm.prank(AGENT);
        registry.createPlan(_singleBeneficiary(), _nativeAsset(), 1 days, 0, 0);
    }

    function testRejectsSecondActivePlanUntilCancelled() public {
        vm.prank(address(smartAccount));
        registry.createPlan(_beneficiaries60_40(), _nativeAsset(), 30 days, 7 days, 2 days);

        vm.expectRevert(RiskGuardInheritanceRegistry.ActivePlanExists.selector);
        vm.prank(address(smartAccount));
        registry.createPlan(_beneficiaries60_40(), _nativeAsset(), 30 days, 7 days, 2 days);

        vm.prank(address(smartAccount));
        registry.cancelPlan();

        vm.prank(address(smartAccount));
        registry.createPlan(_singleBeneficiary(), _nativeAsset(), 1 days, 0, 0);
        assert(registry.hasActivePlan(address(smartAccount)));
    }

    function testUpdatePlanChangesBeneficiariesAssetsAndAllowsZeroDelays() public {
        vm.prank(address(smartAccount));
        registry.createPlan(_beneficiaries60_40(), _nativeAndTokenAssets(), 30 days, 7 days, 2 days);

        vm.prank(address(smartAccount));
        registry.updatePlan(_singleBeneficiary(), _nativeAsset(), 1 days, 0, 0);

        (
            RiskGuardInheritanceRegistry.Plan memory plan,
            RiskGuardInheritanceRegistry.Beneficiary[] memory beneficiaries,
            RiskGuardInheritanceRegistry.ProtectedAsset[] memory assets
        ) = registry.getPlan(address(smartAccount));

        assert(plan.heartbeatInterval == 1 days);
        assert(plan.gracePeriod == 0);
        assert(plan.timelockPeriod == 0);
        assert(beneficiaries.length == 1);
        assert(beneficiaries[0].addr == BENEFICIARY_A);
        assert(beneficiaries[0].shareBps == 10_000);
        assert(assets.length == 1);
        assert(assets[0].token == address(0));
    }

    function testCancelPlanClearsBeneficiariesAndAssets() public {
        vm.prank(address(smartAccount));
        registry.createPlan(_beneficiaries60_40(), _nativeAndTokenAssets(), 30 days, 7 days, 2 days);

        vm.prank(address(smartAccount));
        registry.cancelPlan();

        (
            RiskGuardInheritanceRegistry.Plan memory plan,
            RiskGuardInheritanceRegistry.Beneficiary[] memory beneficiaries,
            RiskGuardInheritanceRegistry.ProtectedAsset[] memory assets
        ) = registry.getPlan(address(smartAccount));

        assert(plan.state == RiskGuardInheritanceRegistry.PlanState.Cancelled);
        assert(beneficiaries.length == 0);
        assert(assets.length == 0);
        assert(!registry.hasActivePlan(address(smartAccount)));
    }

    function testCancelPlanIsBlockedAfterExpiry() public {
        vm.prank(address(smartAccount));
        registry.createPlan(_beneficiaries60_40(), _nativeAsset(), 1 days, 0, 0);

        vm.warp(registry.graceEndsAt(address(smartAccount)));

        vm.expectRevert(RiskGuardInheritanceRegistry.DeadManSwitchActive.selector);
        vm.prank(address(smartAccount));
        registry.cancelPlan();
    }

    function testValidationRejectsBadSharesSelfBeneficiaryAndDuplicateAssets() public {
        vm.expectRevert(RiskGuardInheritanceRegistry.InvalidShares.selector);
        vm.prank(address(smartAccount));
        registry.createPlan(_badShares(), _nativeAsset(), 30 days, 7 days, 2 days);

        vm.expectRevert(RiskGuardInheritanceRegistry.SameAddress.selector);
        vm.prank(address(smartAccount));
        registry.createPlan(_selfBeneficiary(), _nativeAsset(), 30 days, 7 days, 2 days);

        vm.expectRevert(RiskGuardInheritanceRegistry.SameAddress.selector);
        vm.prank(address(smartAccount));
        registry.createPlan(_duplicateBeneficiaries(), _nativeAsset(), 30 days, 7 days, 2 days);

        vm.expectRevert(RiskGuardInheritanceRegistry.DuplicateAsset.selector);
        vm.prank(address(smartAccount));
        registry.createPlan(_singleBeneficiary(), _duplicateAssets(), 30 days, 7 days, 2 days);
    }

    function testHeartbeatCheckInRefreshesDeadline() public {
        vm.prank(address(smartAccount));
        registry.createPlan(_beneficiaries60_40(), _nativeAsset(), 30 days, 7 days, 2 days);

        vm.warp(1_010 days);
        vm.prank(address(smartAccount));
        registry.checkIn();

        assert(registry.nextDeadlineAt(address(smartAccount)) == 1_040 days);
    }

    function testReactivityScheduleTransfersAtTimelock() public {
        vm.deal(address(smartAccount), 10 ether);

        vm.prank(address(smartAccount));
        registry.createPlan(_singleBeneficiary(), _nativeAsset(), 1 days, 0, 0);

        uint256 timestampMs = registry.timelockEndsAt(address(smartAccount)) * 1000;
        assert(registry.currentDistributionScheduleMs(address(smartAccount)) == timestampMs);

        vm.warp(1_001 days);
        MockReactivityPrecompile(registry.somniaReactivityPrecompile())
            .invoke(
                registry, registry.somniaReactivityPrecompile(), _scheduleTopics(timestampMs), ""
            );

        assert(BENEFICIARY_A.balance == 10 ether);
        assert(registry.distributionComplete(address(smartAccount)));
    }

    function testStaleReactivityScheduleIsSkippedAfterCheckIn() public {
        vm.deal(address(smartAccount), 10 ether);

        vm.prank(address(smartAccount));
        registry.createPlan(_singleBeneficiary(), _nativeAsset(), 1 days, 0, 0);
        uint256 staleTimestampMs = registry.currentDistributionScheduleMs(address(smartAccount));

        vm.warp(1_000 days + 12 hours);
        vm.prank(address(smartAccount));
        registry.checkIn();
        uint256 currentTimestampMs = registry.currentDistributionScheduleMs(address(smartAccount));

        assert(currentTimestampMs != staleTimestampMs);

        vm.warp(1_001 days);
        MockReactivityPrecompile(registry.somniaReactivityPrecompile())
            .invoke(
                registry,
                registry.somniaReactivityPrecompile(),
                _scheduleTopics(staleTimestampMs),
                ""
            );

        assert(BENEFICIARY_A.balance == 0);
        assert(!registry.distributionComplete(address(smartAccount)));

        vm.warp(1_001 days + 12 hours);
        MockReactivityPrecompile(registry.somniaReactivityPrecompile())
            .invoke(
                registry,
                registry.somniaReactivityPrecompile(),
                _scheduleTopics(currentTimestampMs),
                ""
            );

        assert(BENEFICIARY_A.balance == 10 ether);
        assert(registry.distributionComplete(address(smartAccount)));
    }

    function testBeneficiaryChangeUsesTimelockAndBlocksAfterExpiry() public {
        vm.prank(address(smartAccount));
        registry.createPlan(_beneficiaries60_40(), _nativeAsset(), 30 days, 7 days, 2 days);

        vm.prank(address(smartAccount));
        registry.proposeBeneficiaries(_singleBeneficiary());

        vm.expectRevert(RiskGuardInheritanceRegistry.BeneficiaryTimelockNotReady.selector);
        vm.prank(address(smartAccount));
        registry.confirmBeneficiaries();

        vm.warp(block.timestamp + registry.BENEFICIARY_TIMELOCK());
        vm.prank(address(smartAccount));
        registry.confirmBeneficiaries();

        (, RiskGuardInheritanceRegistry.Beneficiary[] memory beneficiaries,) =
            registry.getPlan(address(smartAccount));
        assert(beneficiaries.length == 1);
        assert(beneficiaries[0].addr == BENEFICIARY_A);

        vm.warp(registry.graceEndsAt(address(smartAccount)));
        vm.expectRevert(RiskGuardInheritanceRegistry.DeadManSwitchActive.selector);
        vm.prank(address(smartAccount));
        registry.proposeBeneficiaries(_beneficiaries60_40());
    }

    function testAgentHeartbeatRenewsOnSuccessAndFailureSkipsRenewal() public {
        vm.prank(address(smartAccount));
        registry.createPlan(_singleBeneficiary(), _nativeAsset(), 1 days, 0, 0);
        registry.configureAgent(address(platform), 7, 8);
        registry.setKeeper(AGENT);
        registry.fundAgentBudget{ value: 1 ether }(address(smartAccount));

        vm.warp(1_000 days + 12 hours);
        vm.prank(AGENT);
        registry.triggerAgentHeartbeat(address(smartAccount));

        uint256 requestId = platform.lastRequestId();
        assert(registry.pendingHeartbeatSmartAccount(requestId) == address(smartAccount));
        platform.respondHeartbeat(registry, requestId, ResponseStatus.Success);
        assert(registry.lastHeartbeatAt(address(smartAccount)) == block.timestamp);

        uint256 renewedAt = registry.lastHeartbeatAt(address(smartAccount));
        vm.warp(block.timestamp + 12 hours);
        vm.prank(AGENT);
        registry.triggerAgentHeartbeat(address(smartAccount));
        platform.respondHeartbeat(registry, platform.lastRequestId(), ResponseStatus.Failed);
        assert(registry.lastHeartbeatAt(address(smartAccount)) == renewedAt);
    }

    function testDistributionAgentTransfersAfterSuccessfulCallback() public {
        vm.deal(address(smartAccount), 10 ether);
        token.mint(address(smartAccount), 1_000 ether);
        vm.prank(address(smartAccount));
        registry.createPlan(_beneficiaries60_40(), _nativeAndTokenAssets(), 1 days, 0, 0);
        registry.configureAgent(address(platform), 7, 8);
        registry.fundAgentBudget{ value: 1 ether }(address(smartAccount));

        vm.warp(1_001 days);
        registry.triggerDistributionAgent(address(smartAccount));
        platform.respondDistribution(registry, 41, ResponseStatus.Success);

        assert(BENEFICIARY_A.balance == 6 ether);
        assert(BENEFICIARY_B.balance == 4 ether);
        assert(token.balanceOf(BENEFICIARY_A) == 600 ether);
        assert(token.balanceOf(BENEFICIARY_B) == 400 ether);
        assert(registry.distributionComplete(address(smartAccount)));

        vm.expectRevert(RiskGuardInheritanceRegistry.AlreadyExecuted.selector);
        registry.triggerDistributionAgent(address(smartAccount));
    }

    function testDistributionSkipsFailedNativeTransferWithoutLosingRemainingFunds() public {
        RevertingReceiver badBeneficiary = new RevertingReceiver();
        vm.deal(address(smartAccount), 10 ether);
        vm.prank(address(smartAccount));
        registry.createPlan(
            _beneficiariesBadReceiver60_40(address(badBeneficiary)), _nativeAsset(), 1 days, 0, 0
        );
        registry.configureAgent(address(platform), 7, 8);
        registry.fundAgentBudget{ value: 1 ether }(address(smartAccount));

        vm.warp(1_001 days);
        registry.triggerDistributionAgent(address(smartAccount));
        platform.respondDistribution(registry, 41, ResponseStatus.Success);

        assert(address(badBeneficiary).balance == 0);
        assert(BENEFICIARY_B.balance == 4 ether);
        assert(address(smartAccount).balance == 6 ether);
        assert(!registry.distributionComplete(address(smartAccount)));
        assert(registry.assetSettled(address(smartAccount), address(0), BENEFICIARY_B));
        assert(!registry.assetSettled(address(smartAccount), address(0), address(badBeneficiary)));
    }

    function testSettledBeneficiaryDoesNotInflateLaterRecipientShareOnRetry() public {
        RevertingReceiver badBeneficiary = new RevertingReceiver();
        vm.deal(address(smartAccount), 10 ether);
        vm.prank(address(smartAccount));
        registry.createPlan(
            _threeBeneficiariesWithBadMiddle(address(badBeneficiary)), _nativeAsset(), 1 days, 0, 0
        );
        registry.configureAgent(address(platform), 7, 8);
        registry.fundAgentBudget{ value: 1 ether }(address(smartAccount));

        vm.warp(1_001 days);
        registry.triggerDistributionAgent(address(smartAccount));
        platform.respondDistribution(registry, 41, ResponseStatus.Success);

        assert(BENEFICIARY_A.balance == 5 ether);
        assert(address(badBeneficiary).balance == 0);
        assert(BENEFICIARY_B.balance == 2 ether);
        assert(address(smartAccount).balance == 3 ether);

        registry.triggerDistributionAgent(address(smartAccount));
        platform.respondDistribution(registry, 42, ResponseStatus.Success);

        assert(BENEFICIARY_A.balance == 5 ether);
        assert(BENEFICIARY_B.balance == 2 ether);
        assert(address(smartAccount).balance == 3 ether);
        assert(!registry.distributionComplete(address(smartAccount)));
        assert(!registry.assetSettled(address(smartAccount), address(0), address(badBeneficiary)));
    }

    function testPendingRequestsAndBudgetAreScopedPerSmartAccount() public {
        MockSmartAccount secondAccount = new MockSmartAccount();
        secondAccount.setAuthorizedExecutor(address(registry), true);
        vm.prank(address(smartAccount));
        registry.createPlan(_singleBeneficiary(), _nativeAsset(), 1 days, 0, 0);
        vm.prank(address(secondAccount));
        registry.createPlan(_singleBeneficiary(), _nativeAsset(), 1 days, 0, 0);
        registry.configureAgent(address(platform), 7, 8);
        registry.setKeeper(AGENT);
        registry.fundAgentBudget{ value: 1 ether }(address(smartAccount));

        vm.warp(1_000 days + 12 hours);
        vm.prank(AGENT);
        registry.triggerAgentHeartbeat(address(smartAccount));

        vm.expectRevert(RiskGuardInheritanceRegistry.AgentRequestPending.selector);
        vm.prank(AGENT);
        registry.triggerAgentHeartbeat(address(smartAccount));

        vm.expectRevert(RiskGuardInheritanceRegistry.AgentBudgetInsufficient.selector);
        vm.prank(AGENT);
        registry.triggerAgentHeartbeat(address(secondAccount));
    }

    function testBeneficiaryTimelockCanSettleWhileHeartbeatRequestIsPending() public {
        vm.prank(address(smartAccount));
        registry.createPlan(_beneficiaries60_40(), _nativeAsset(), 30 days, 7 days, 2 days);
        registry.configureAgent(address(platform), 7, 8);
        registry.setKeeper(AGENT);
        registry.fundAgentBudget{ value: 1 ether }(address(smartAccount));

        vm.prank(address(smartAccount));
        registry.proposeBeneficiaries(_singleBeneficiary());

        vm.prank(AGENT);
        registry.triggerAgentHeartbeat(address(smartAccount));
        uint256 requestId = platform.lastRequestId();

        vm.warp(block.timestamp + registry.BENEFICIARY_TIMELOCK());
        vm.prank(address(smartAccount));
        registry.confirmBeneficiaries();

        platform.respondHeartbeat(registry, requestId, ResponseStatus.Success);

        (, RiskGuardInheritanceRegistry.Beneficiary[] memory beneficiaries,) =
            registry.getPlan(address(smartAccount));
        assert(beneficiaries.length == 1);
        assert(beneficiaries[0].addr == BENEFICIARY_A);
        assert(registry.pendingHeartbeatRequestId(address(smartAccount)) == 0);
    }

    function testExecuteInheritanceTransfersAllConfiguredNativeAndERC20() public {
        vm.deal(address(smartAccount), 10 ether);
        token.mint(address(smartAccount), 1_000 ether);

        vm.prank(address(smartAccount));
        registry.createPlan(_beneficiaries60_40(), _nativeAndTokenAssets(), 1 days, 0, 0);

        vm.expectRevert(RiskGuardInheritanceRegistry.TimelockNotReady.selector);
        vm.prank(AGENT);
        registry.executeInheritance(address(smartAccount));

        vm.warp(1_001 days);
        vm.prank(AGENT);
        registry.executeInheritance(address(smartAccount));

        assert(address(smartAccount).balance == 0);
        assert(BENEFICIARY_A.balance == 6 ether);
        assert(BENEFICIARY_B.balance == 4 ether);
        assert(token.balanceOf(address(smartAccount)) == 0);
        assert(token.balanceOf(BENEFICIARY_A) == 600 ether);
        assert(token.balanceOf(BENEFICIARY_B) == 400 ether);

        (RiskGuardInheritanceRegistry.Plan memory plan,,) = registry.getPlan(address(smartAccount));
        assert(plan.state == RiskGuardInheritanceRegistry.PlanState.Executed);
        assert(plan.executedAt == 1_001 days);
    }

    function testExecutionFailsClosedWhenSmartAccountHasNotAuthorizedRegistry() public {
        MockSmartAccount unauthorizedAccount = new MockSmartAccount();
        vm.deal(address(unauthorizedAccount), 1 ether);

        vm.prank(address(unauthorizedAccount));
        registry.createPlan(_singleBeneficiary(), _nativeAsset(), 1 days, 0, 0);

        vm.warp(1_001 days);
        vm.expectRevert();
        registry.executeInheritance(address(unauthorizedAccount));

        assert(address(unauthorizedAccount).balance == 1 ether);
        assert(BENEFICIARY_A.balance == 0);
        (RiskGuardInheritanceRegistry.Plan memory plan,,) =
            registry.getPlan(address(unauthorizedAccount));
        assert(plan.state == RiskGuardInheritanceRegistry.PlanState.Active);
    }

    function _beneficiaries60_40()
        private
        pure
        returns (RiskGuardInheritanceRegistry.Beneficiary[] memory list)
    {
        list = new RiskGuardInheritanceRegistry.Beneficiary[](2);
        list[0] = RiskGuardInheritanceRegistry.Beneficiary(BENEFICIARY_A, 6_000);
        list[1] = RiskGuardInheritanceRegistry.Beneficiary(BENEFICIARY_B, 4_000);
    }

    function _singleBeneficiary()
        private
        pure
        returns (RiskGuardInheritanceRegistry.Beneficiary[] memory list)
    {
        list = new RiskGuardInheritanceRegistry.Beneficiary[](1);
        list[0] = RiskGuardInheritanceRegistry.Beneficiary(BENEFICIARY_A, 10_000);
    }

    function _badShares()
        private
        pure
        returns (RiskGuardInheritanceRegistry.Beneficiary[] memory list)
    {
        list = new RiskGuardInheritanceRegistry.Beneficiary[](2);
        list[0] = RiskGuardInheritanceRegistry.Beneficiary(BENEFICIARY_A, 6_000);
        list[1] = RiskGuardInheritanceRegistry.Beneficiary(BENEFICIARY_B, 3_000);
    }

    function _duplicateBeneficiaries()
        private
        pure
        returns (RiskGuardInheritanceRegistry.Beneficiary[] memory list)
    {
        list = new RiskGuardInheritanceRegistry.Beneficiary[](2);
        list[0] = RiskGuardInheritanceRegistry.Beneficiary(BENEFICIARY_A, 5_000);
        list[1] = RiskGuardInheritanceRegistry.Beneficiary(BENEFICIARY_A, 5_000);
    }

    function _beneficiariesBadReceiver60_40(address badReceiver)
        private
        pure
        returns (RiskGuardInheritanceRegistry.Beneficiary[] memory list)
    {
        list = new RiskGuardInheritanceRegistry.Beneficiary[](2);
        list[0] = RiskGuardInheritanceRegistry.Beneficiary(badReceiver, 6_000);
        list[1] = RiskGuardInheritanceRegistry.Beneficiary(BENEFICIARY_B, 4_000);
    }

    function _threeBeneficiariesWithBadMiddle(address badReceiver)
        private
        pure
        returns (RiskGuardInheritanceRegistry.Beneficiary[] memory list)
    {
        list = new RiskGuardInheritanceRegistry.Beneficiary[](3);
        list[0] = RiskGuardInheritanceRegistry.Beneficiary(BENEFICIARY_A, 5_000);
        list[1] = RiskGuardInheritanceRegistry.Beneficiary(badReceiver, 3_000);
        list[2] = RiskGuardInheritanceRegistry.Beneficiary(BENEFICIARY_B, 2_000);
    }

    function _selfBeneficiary()
        private
        view
        returns (RiskGuardInheritanceRegistry.Beneficiary[] memory list)
    {
        list = new RiskGuardInheritanceRegistry.Beneficiary[](1);
        list[0] = RiskGuardInheritanceRegistry.Beneficiary(address(smartAccount), 10_000);
    }

    function _nativeAsset()
        private
        pure
        returns (RiskGuardInheritanceRegistry.ProtectedAsset[] memory list)
    {
        list = new RiskGuardInheritanceRegistry.ProtectedAsset[](1);
        list[0] = RiskGuardInheritanceRegistry.ProtectedAsset(address(0));
    }

    function _nativeAndTokenAssets()
        private
        view
        returns (RiskGuardInheritanceRegistry.ProtectedAsset[] memory list)
    {
        list = new RiskGuardInheritanceRegistry.ProtectedAsset[](2);
        list[0] = RiskGuardInheritanceRegistry.ProtectedAsset(address(0));
        list[1] = RiskGuardInheritanceRegistry.ProtectedAsset(address(token));
    }

    function _duplicateAssets()
        private
        view
        returns (RiskGuardInheritanceRegistry.ProtectedAsset[] memory list)
    {
        list = new RiskGuardInheritanceRegistry.ProtectedAsset[](2);
        list[0] = RiskGuardInheritanceRegistry.ProtectedAsset(address(token));
        list[1] = RiskGuardInheritanceRegistry.ProtectedAsset(address(token));
    }

    function _scheduleTopics(uint256 timestampMs) private view returns (bytes32[] memory topics) {
        topics = new bytes32[](2);
        topics[0] = registry.SOMNIA_SCHEDULE_EVENT_TOPIC();
        topics[1] = bytes32(timestampMs);
    }
}
