// SPDX-License-Identifier: MIT
pragma solidity ^0.8.35;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SomniaDeadManSwitch } from "../src/DeadManSwitch.sol";

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

contract DeadManSwitchTest {
    Vm private constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    address private constant OWNER = address(0xA11CE);
    address private constant BENEFICIARY = address(0xB0B);
    address private constant PENDING = address(0xCAFE);
    address private constant STRANGER = address(0xE11E);

    SomniaDeadManSwitch private dms;
    TestToken private token;

    function setUp() public {
        vm.warp(1_000 days);
        dms = new SomniaDeadManSwitch(OWNER, BENEFICIARY, 3 days, 1 days, 1 days);
        token = new TestToken();
    }

    function testConstructorStoresBaselineState() public view {
        assert(dms.owner() == OWNER);
        assert(dms.beneficiary() == BENEFICIARY);
        assert(dms.nextDeadlineAt() == 1_003 days);
        assert(dms.graceEndsAt() == 1_004 days);
        assert(dms.timelockEndsAt() == 1_005 days);
        assert(!dms.isExpired());
    }

    function testRejectsInvalidDurations() public {
        vm.expectRevert(SomniaDeadManSwitch.InvalidDuration.selector);
        new SomniaDeadManSwitch(OWNER, BENEFICIARY, 1 days - 1, 1 days, 1 days);

        vm.expectRevert(SomniaDeadManSwitch.InvalidDuration.selector);
        new SomniaDeadManSwitch(OWNER, BENEFICIARY, 3650 days + 1, 1 days, 1 days);
    }

    function testTwoStepBeneficiaryChange() public {
        vm.prank(OWNER);
        dms.proposeBeneficiary(PENDING);

        vm.expectRevert(SomniaDeadManSwitch.BeneficiaryTimelockNotReady.selector);
        vm.prank(OWNER);
        dms.confirmBeneficiary();

        vm.warp(block.timestamp + dms.BENEFICIARY_TIMELOCK());
        vm.prank(OWNER);
        dms.confirmBeneficiary();

        assert(dms.beneficiary() == PENDING);
    }

    function testCannotChangeBeneficiaryAfterExpiry() public {
        vm.warp(dms.graceEndsAt());

        vm.expectRevert(SomniaDeadManSwitch.DeadManSwitchActive.selector);
        vm.prank(OWNER);
        dms.proposeBeneficiary(PENDING);
    }

    function testTwoStepOwnershipTransfer() public {
        vm.prank(OWNER);
        dms.transferOwnership(PENDING);

        vm.expectRevert(SomniaDeadManSwitch.NotPendingOwner.selector);
        vm.prank(STRANGER);
        dms.acceptOwnership();

        vm.prank(PENDING);
        dms.acceptOwnership();

        assert(dms.owner() == PENDING);
    }

    function testOwnerCanRenewHeartbeatBeforeExpiry() public {
        vm.warp(1_000 days + 12 hours);
        vm.prank(OWNER);
        dms.renewHeartbeat();

        assert(dms.lastHeartbeatAt() == 1_000 days + 12 hours);
        assert(dms.nextDeadlineAt() == 1_003 days + 12 hours);
        assert(!dms.isExpired());
    }

    function testOwnerCannotRenewHeartbeatAfterExpiry() public {
        vm.warp(dms.graceEndsAt());

        vm.expectRevert(SomniaDeadManSwitch.DeadManSwitchActive.selector);
        vm.prank(OWNER);
        dms.renewHeartbeat();
    }

    function testExpiryAndTimelockRequireElapsedTime() public {
        vm.warp(dms.graceEndsAt() - 1);
        assert(!dms.isExpired());
        assert(!dms.isTimelockReady());

        vm.warp(dms.graceEndsAt());
        assert(dms.isExpired());
        assert(!dms.isTimelockReady());

        vm.warp(dms.timelockEndsAt());
        assert(dms.isTimelockReady());
        assert(dms.canExecute(BENEFICIARY));
    }

    function testPrematureExecutionReverts() public {
        vm.expectRevert(SomniaDeadManSwitch.TimelockNotReady.selector);
        vm.prank(BENEFICIARY);
        dms.markSafeExecution();
    }

    function testUnauthorizedExecutionReverts() public {
        vm.warp(dms.timelockEndsAt());

        vm.expectRevert(SomniaDeadManSwitch.NotBeneficiary.selector);
        vm.prank(STRANGER);
        dms.markSafeExecution();
    }

    function testBeneficiaryCanMarkSafeExecutionAfterTimelock() public {
        vm.warp(dms.timelockEndsAt());
        vm.prank(BENEFICIARY);
        dms.markSafeExecution();

        assert(dms.executedAt() == dms.timelockEndsAt());
        assert(!dms.canExecute(BENEFICIARY));
    }

    function testClaimsRequireExecutionMarker() public {
        vm.warp(dms.timelockEndsAt());

        vm.expectRevert(SomniaDeadManSwitch.NotExecuted.selector);
        vm.prank(BENEFICIARY);
        dms.claimNative();
    }

    function testBeneficiaryCanClaimNativeAfterExecution() public {
        vm.deal(address(dms), 1 ether);
        vm.warp(dms.timelockEndsAt());
        vm.prank(BENEFICIARY);
        dms.markSafeExecution();

        uint256 beforeBalance = BENEFICIARY.balance;
        vm.prank(BENEFICIARY);
        dms.claimNative();

        assert(BENEFICIARY.balance == beforeBalance + 1 ether);
    }

    function testBeneficiaryCanClaimERC20AfterExecution() public {
        token.mint(address(dms), 100 ether);
        vm.warp(dms.timelockEndsAt());
        vm.prank(BENEFICIARY);
        dms.markSafeExecution();

        vm.prank(BENEFICIARY);
        dms.claimERC20(address(token));

        assert(token.balanceOf(BENEFICIARY) == 100 ether);
    }

    function testOwnerCanRescueBeforeExpiryOnly() public {
        token.mint(address(dms), 100 ether);

        vm.prank(OWNER);
        dms.rescueERC20(address(token), OWNER, 0);
        assert(token.balanceOf(OWNER) == 100 ether);

        vm.warp(dms.graceEndsAt());
        vm.expectRevert(SomniaDeadManSwitch.DeadManSwitchActive.selector);
        vm.prank(OWNER);
        dms.rescueNative(OWNER, 0);
    }
}
