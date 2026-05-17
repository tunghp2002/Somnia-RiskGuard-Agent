// SPDX-License-Identifier: MIT
pragma solidity ^0.8.35;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {
    AgentRequest,
    Response,
    ResponseStatus,
    SomniaDeadManSwitch
} from "../src/DeadManSwitch.sol";

interface Vm {
    function deal(address who, uint256 newBalance) external;
    function expectRevert(bytes4 selector) external;
    function prank(address sender) external;
    function warp(uint256 timestamp) external;
}

contract TestToken is IERC20 {
    string public constant name = "Test Token";
    string public constant symbol = "TEST";
    uint8 public constant decimals = 18;

    uint256 public override totalSupply;
    mapping(address => uint256) public override balanceOf;
    mapping(address => mapping(address => uint256)) public override allowance;

    function transfer(address to, uint256 amount) external override returns (bool) {
        _transfer(msg.sender, to, amount);
        return true;
    }

    function approve(address spender, uint256 amount) external override returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external override returns (bool) {
        uint256 currentAllowance = allowance[from][msg.sender];
        require(currentAllowance >= amount, "insufficient allowance");
        allowance[from][msg.sender] = currentAllowance - amount;
        _transfer(from, to, amount);
        return true;
    }

    function mint(address to, uint256 amount) external {
        totalSupply += amount;
        balanceOf[to] += amount;
        emit Transfer(address(0), to, amount);
    }

    function _transfer(address from, address to, uint256 amount) private {
        require(balanceOf[from] >= amount, "insufficient balance");
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        emit Transfer(from, to, amount);
    }
}

contract MockAgentPlatform {
    uint256 public constant REQUEST_DEPOSIT = 0.02 ether;
    uint256 public nextRequestId = 41;
    uint256 public lastValue;

    function getRequestDeposit() external pure returns (uint256) {
        return REQUEST_DEPOSIT;
    }

    function createRequest(
        uint256,
        address,
        bytes4,
        bytes calldata
    ) external payable returns (uint256 requestId) {
        lastValue = msg.value;
        requestId = nextRequestId++;
    }

    function respond(
        SomniaDeadManSwitch dms,
        uint256 requestId,
        ResponseStatus status
    ) external {
        Response[] memory responses = status == ResponseStatus.Success
            ? new Response[](1)
            : new Response[](0);
        if (responses.length == 1) {
            responses[0].status = ResponseStatus.Success;
            responses[0].timestamp = block.timestamp;
        }

        AgentRequest memory details;
        dms.handleHeartbeatResponse(requestId, responses, status, details);
    }

    receive() external payable {}
}

contract DeadManSwitchTest {
    Vm private constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    address private constant OWNER = address(0xA11CE);
    address private constant BENEFICIARY_A = address(0xB0B);
    address private constant BENEFICIARY_B = address(0xCAFE);
    address private constant BENEFICIARY_C = address(0xDAD);
    address private constant KEEPER = address(0x1CE);
    address private constant STRANGER = address(0xE11E);

    SomniaDeadManSwitch private dms;
    TestToken private token;
    MockAgentPlatform private platform;

    function setUp() public {
        vm.warp(1_000 days);
        vm.deal(OWNER, 100 ether);
        dms = new SomniaDeadManSwitch(OWNER, _beneficiaries60_40(), 3 days, 1 days, 1 days);
        token = new TestToken();
        platform = new MockAgentPlatform();
    }

    function testConstructorStoresMultiBeneficiaryBaselineState() public view {
        SomniaDeadManSwitch.Beneficiary[] memory beneficiaries = dms.getBeneficiaries();

        assert(dms.owner() == OWNER);
        assert(beneficiaries.length == 2);
        assert(beneficiaries[0].addr == BENEFICIARY_A);
        assert(beneficiaries[0].shareBps == 6_000);
        assert(beneficiaries[1].addr == BENEFICIARY_B);
        assert(beneficiaries[1].shareBps == 4_000);
        assert(dms.nextDeadlineAt() == 1_003 days);
        assert(dms.graceEndsAt() == 1_004 days);
        assert(dms.timelockEndsAt() == 1_005 days);
        assert(!dms.isExpired());
    }

    function testRejectsInvalidDurationsAndInvalidShares() public {
        vm.expectRevert(SomniaDeadManSwitch.InvalidDuration.selector);
        new SomniaDeadManSwitch(OWNER, _beneficiaries60_40(), 1 days - 1, 1 days, 1 days);

        vm.expectRevert(SomniaDeadManSwitch.InvalidDuration.selector);
        new SomniaDeadManSwitch(OWNER, _beneficiaries60_40(), 3650 days + 1, 1 days, 1 days);

        vm.expectRevert(SomniaDeadManSwitch.InvalidShares.selector);
        new SomniaDeadManSwitch(OWNER, _beneficiariesBadTotal(), 3 days, 1 days, 1 days);
    }

    function testTwoStepBeneficiariesChange() public {
        SomniaDeadManSwitch.Beneficiary[] memory next = _singleBeneficiaryC();

        vm.prank(OWNER);
        dms.proposeBeneficiaries(next);

        vm.expectRevert(SomniaDeadManSwitch.BeneficiaryTimelockNotReady.selector);
        vm.prank(OWNER);
        dms.confirmBeneficiaries();

        vm.warp(block.timestamp + dms.BENEFICIARY_TIMELOCK());
        vm.prank(OWNER);
        dms.confirmBeneficiaries();

        SomniaDeadManSwitch.Beneficiary[] memory beneficiaries = dms.getBeneficiaries();
        assert(beneficiaries.length == 1);
        assert(beneficiaries[0].addr == BENEFICIARY_C);
        assert(beneficiaries[0].shareBps == 10_000);
    }

    function testCannotChangeBeneficiariesAfterExpiry() public {
        vm.warp(dms.graceEndsAt());

        vm.expectRevert(SomniaDeadManSwitch.DeadManSwitchActive.selector);
        vm.prank(OWNER);
        dms.proposeBeneficiaries(_singleBeneficiaryC());
    }

    function testTwoStepOwnershipTransfer() public {
        vm.prank(OWNER);
        dms.transferOwnership(BENEFICIARY_C);

        vm.expectRevert(SomniaDeadManSwitch.NotPendingOwner.selector);
        vm.prank(STRANGER);
        dms.acceptOwnership();

        vm.prank(BENEFICIARY_C);
        dms.acceptOwnership();

        assert(dms.owner() == BENEFICIARY_C);
    }

    function testOwnerCanRenewHeartbeatBeforeExpiryOnly() public {
        vm.warp(1_000 days + 12 hours);
        vm.prank(OWNER);
        dms.renewHeartbeat();

        assert(dms.lastHeartbeatAt() == 1_000 days + 12 hours);
        assert(dms.nextDeadlineAt() == 1_003 days + 12 hours);
        assert(!dms.isExpired());

        vm.warp(dms.graceEndsAt());
        vm.expectRevert(SomniaDeadManSwitch.DeadManSwitchActive.selector);
        vm.prank(OWNER);
        dms.renewHeartbeat();
    }

    function testExpiryTimelockAndPerBeneficiaryExecutionReadiness() public {
        vm.warp(dms.graceEndsAt() - 1);
        assert(!dms.isExpired());
        assert(!dms.isTimelockReady());

        vm.warp(dms.graceEndsAt());
        assert(dms.isExpired());
        assert(!dms.isTimelockReady());

        vm.warp(dms.timelockEndsAt());
        assert(dms.isTimelockReady());
        assert(dms.canExecute(BENEFICIARY_A));
        assert(dms.canExecute(BENEFICIARY_B));
        assert(!dms.canExecute(STRANGER));
    }

    function testPrematureAndUnauthorizedExecutionRevert() public {
        vm.expectRevert(SomniaDeadManSwitch.TimelockNotReady.selector);
        vm.prank(BENEFICIARY_A);
        dms.markSafeExecution();

        vm.warp(dms.timelockEndsAt());
        vm.expectRevert(SomniaDeadManSwitch.NotBeneficiary.selector);
        vm.prank(STRANGER);
        dms.markSafeExecution();
    }

    function testBeneficiariesMarkIndividuallyAndCannotMarkTwice() public {
        vm.warp(dms.timelockEndsAt());

        vm.prank(BENEFICIARY_A);
        dms.markSafeExecution();

        assert(dms.globalExecutedAt() == dms.timelockEndsAt());
        assert(!dms.canExecute(BENEFICIARY_A));
        assert(dms.canExecute(BENEFICIARY_B));

        vm.expectRevert(SomniaDeadManSwitch.AlreadyExecuted.selector);
        vm.prank(BENEFICIARY_A);
        dms.markSafeExecution();

        vm.prank(BENEFICIARY_B);
        dms.markSafeExecution();

        assert(!dms.canExecute(BENEFICIARY_B));
    }

    function testNativeClaimsUseFrozenPotAndShareWeights() public {
        vm.deal(address(dms), 10 ether);
        vm.warp(dms.timelockEndsAt());

        vm.prank(BENEFICIARY_A);
        dms.markSafeExecution();
        assert(dms.snapshotNativePot() == 10 ether);

        vm.deal(address(dms), 20 ether);
        vm.prank(BENEFICIARY_B);
        dms.markSafeExecution();

        uint256 beforeA = BENEFICIARY_A.balance;
        uint256 beforeB = BENEFICIARY_B.balance;

        vm.prank(BENEFICIARY_B);
        dms.claimNative();
        vm.prank(BENEFICIARY_A);
        dms.claimNative();

        assert(BENEFICIARY_A.balance == beforeA + 6 ether);
        assert(BENEFICIARY_B.balance == beforeB + 4 ether);
        assert(dms.nativeClaimed(BENEFICIARY_A) == 6 ether);
        assert(dms.nativeClaimed(BENEFICIARY_B) == 4 ether);
    }

    function testClaimNativeRequiresCallerExecutionMarker() public {
        vm.deal(address(dms), 10 ether);
        vm.warp(dms.timelockEndsAt());

        vm.prank(BENEFICIARY_A);
        dms.markSafeExecution();

        vm.expectRevert(SomniaDeadManSwitch.NotExecuted.selector);
        vm.prank(BENEFICIARY_B);
        dms.claimNative();
    }

    function testERC20ClaimsSnapshotTokenPotOnFirstClaim() public {
        token.mint(address(dms), 100 ether);
        vm.warp(dms.timelockEndsAt());

        vm.prank(BENEFICIARY_A);
        dms.markSafeExecution();
        vm.prank(BENEFICIARY_B);
        dms.markSafeExecution();

        vm.prank(BENEFICIARY_A);
        dms.claimERC20(address(token));
        assert(dms.snapshotERC20Pot(address(token)) == 100 ether);

        token.mint(address(dms), 100 ether);
        vm.prank(BENEFICIARY_B);
        dms.claimERC20(address(token));

        assert(token.balanceOf(BENEFICIARY_A) == 60 ether);
        assert(token.balanceOf(BENEFICIARY_B) == 40 ether);
    }

    function testOwnerCanRescueBeforeExpiryAndAgentBudgetIsExcludedFromNativeRescue() public {
        vm.deal(address(dms), 10 ether);
        vm.prank(OWNER);
        dms.fundAgentBudget{ value: 3 ether }();

        uint256 beforeOwner = OWNER.balance;
        vm.prank(OWNER);
        dms.rescueNative(OWNER, 0);

        assert(OWNER.balance == beforeOwner + 10 ether);
        assert(address(dms).balance == 3 ether);
        assert(dms.agentBudget() == 3 ether);

        token.mint(address(dms), 100 ether);
        vm.prank(OWNER);
        dms.rescueERC20(address(token), OWNER, 0);
        assert(token.balanceOf(OWNER) == 100 ether);

        vm.warp(dms.graceEndsAt());
        vm.expectRevert(SomniaDeadManSwitch.DeadManSwitchActive.selector);
        vm.prank(OWNER);
        dms.rescueNative(OWNER, 0);
    }

    function testAgentHeartbeatRequiresOwnerOrKeeperAndClearsPendingRequestOnSuccess() public {
        vm.prank(OWNER);
        dms.configureAgent(address(platform), 7);
        vm.prank(OWNER);
        dms.setKeeper(KEEPER);
        vm.prank(OWNER);
        dms.fundAgentBudget{ value: 1 ether }();

        vm.expectRevert(SomniaDeadManSwitch.NotAuthorized.selector);
        vm.prank(STRANGER);
        dms.triggerAgentHeartbeat();

        vm.prank(KEEPER);
        dms.triggerAgentHeartbeat();

        uint256 requestId = dms.pendingAgentRequestId();
        assert(requestId == 41);
        assert(platform.lastValue() == platform.REQUEST_DEPOSIT() + dms.agentRewardPerCall() * dms.AGENT_SUBCOMMITTEE_SIZE());

        vm.warp(block.timestamp + 1 hours);
        platform.respond(dms, requestId, ResponseStatus.Success);

        assert(dms.pendingAgentRequestId() == 0);
        assert(dms.lastHeartbeatAt() == block.timestamp);
    }

    function testAgentHeartbeatFailureClearsPendingRequestWithoutRenewal() public {
        vm.prank(OWNER);
        dms.configureAgent(address(platform), 7);
        vm.prank(OWNER);
        dms.fundAgentBudget{ value: 1 ether }();

        uint256 originalHeartbeat = dms.lastHeartbeatAt();
        vm.prank(OWNER);
        dms.triggerAgentHeartbeat();
        uint256 requestId = dms.pendingAgentRequestId();

        vm.warp(block.timestamp + 1 hours);
        platform.respond(dms, requestId, ResponseStatus.Failed);

        assert(dms.pendingAgentRequestId() == 0);
        assert(dms.lastHeartbeatAt() == originalHeartbeat);
    }

    function testAgentHeartbeatBlocksSecondPendingRequestAndRejectsUnknownCallback() public {
        vm.prank(OWNER);
        dms.configureAgent(address(platform), 7);
        vm.prank(OWNER);
        dms.fundAgentBudget{ value: 1 ether }();

        vm.prank(OWNER);
        dms.triggerAgentHeartbeat();

        vm.expectRevert(SomniaDeadManSwitch.AgentRequestPending.selector);
        vm.prank(OWNER);
        dms.triggerAgentHeartbeat();

        vm.expectRevert(SomniaDeadManSwitch.UnknownAgentRequest.selector);
        platform.respond(dms, 999, ResponseStatus.Success);
    }

    function _beneficiaries60_40()
        private
        pure
        returns (SomniaDeadManSwitch.Beneficiary[] memory list)
    {
        list = new SomniaDeadManSwitch.Beneficiary[](2);
        list[0] = SomniaDeadManSwitch.Beneficiary(BENEFICIARY_A, 6_000);
        list[1] = SomniaDeadManSwitch.Beneficiary(BENEFICIARY_B, 4_000);
    }

    function _beneficiariesBadTotal()
        private
        pure
        returns (SomniaDeadManSwitch.Beneficiary[] memory list)
    {
        list = new SomniaDeadManSwitch.Beneficiary[](2);
        list[0] = SomniaDeadManSwitch.Beneficiary(BENEFICIARY_A, 6_000);
        list[1] = SomniaDeadManSwitch.Beneficiary(BENEFICIARY_B, 3_000);
    }

    function _singleBeneficiaryC()
        private
        pure
        returns (SomniaDeadManSwitch.Beneficiary[] memory list)
    {
        list = new SomniaDeadManSwitch.Beneficiary[](1);
        list[0] = SomniaDeadManSwitch.Beneficiary(BENEFICIARY_C, 10_000);
    }
}
