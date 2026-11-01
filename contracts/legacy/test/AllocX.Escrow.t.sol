// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./AllocX.Base.t.sol";

/// @dev Unit tests for AllocXEscrow, driven directly by a SETTLEMENT_ROLE holder (this test contract).
contract AllocXEscrowTest is AllocXTestBase {
    address internal payee = makeAddr("payee");
    address internal other = makeAddr("other");
    uint256 internal constant OID = 1001;

    function setUp() public override {
        super.setUp();
        vm.prank(admin);
        escrow.grantRole(SETTLEMENT_ROLE, address(this));
    }

    function _deposit(uint256 oid, uint256 amt) internal {
        escrow.deposit(oid, buyer, amt, projectId);
    }

    // --------------------------------------------------------------- deposit
    function test_Deposit_PullsUsdcAndRecordsState() public {
        uint256 before = usdc.balanceOf(buyer);
        vm.expectEmit(true, true, false, true, address(escrow));
        emit AllocXEscrow.Deposited(OID, buyer, 100e6);
        _deposit(OID, 100e6);
        assertEq(usdc.balanceOf(buyer), before - 100e6);
        assertEq(usdc.balanceOf(address(escrow)), 100e6);
        assertEq(escrow.totalHeld(), 100e6);
        assertEq(escrow.heldAmount(OID), 100e6);
        (address payer, uint256 amount, AllocXEscrow.DepositState st) = escrow.depositOf(OID);
        assertEq(payer, buyer);
        assertEq(amount, 100e6);
        assertEq(uint8(st), uint8(AllocXEscrow.DepositState.Held));
    }

    function test_Deposit_OnlySettlementRole() public {
        vm.prank(stranger);
        vm.expectRevert(_unauth(stranger, SETTLEMENT_ROLE));
        escrow.deposit(OID, buyer, 1e6, projectId);
        vm.prank(admin);
        vm.expectRevert(_unauth(admin, SETTLEMENT_ROLE));
        escrow.deposit(OID, buyer, 1e6, projectId);
    }

    function test_Deposit_InputValidation() public {
        vm.expectRevert(AllocXEscrow.ZeroAddress.selector);
        escrow.deposit(OID, address(0), 1e6, projectId);
        vm.expectRevert(AllocXEscrow.InvalidAmount.selector);
        escrow.deposit(OID, buyer, 0, projectId);
    }

    function test_Deposit_OnlyOncePerOrderEvenAfterTerminalState() public {
        _deposit(OID, 10e6);
        vm.expectRevert(AllocXEscrow.AlreadyDeposited.selector);
        _deposit(OID, 10e6);
        escrow.refund(OID);
        vm.expectRevert(AllocXEscrow.AlreadyDeposited.selector);
        _deposit(OID, 10e6);
    }

    function test_Deposit_RevertsWithoutAllowanceOrBalance() public {
        vm.prank(buyer);
        usdc.approve(address(escrow), 0);
        vm.expectRevert();
        _deposit(OID, 1e6);
        vm.prank(buyer);
        usdc.approve(address(escrow), type(uint256).max);
        vm.expectRevert();
        _deposit(OID, 100_000_000e6);
        assertEq(escrow.totalHeld(), 0, "failed deposit leaves no accounting");
    }

    function test_Deposit_RejectsFeeOnTransferUsdc() public {
        FeeOnTransferERC20 taxed = new FeeOnTransferERC20();
        AllocXFeeManager fm = new AllocXFeeManager(admin, address(taxed), treasury, 200);
        AllocXEscrow esc = new AllocXEscrow(admin, address(taxed), address(fm));
        vm.prank(admin);
        esc.grantRole(SETTLEMENT_ROLE, address(this));
        taxed.mint(buyer, 1_000e6);
        vm.prank(buyer);
        taxed.approve(address(esc), type(uint256).max);
        vm.expectRevert(AllocXEscrow.BalanceDeltaMismatch.selector);
        esc.deposit(1, buyer, 100e6, projectId);
    }

    // --------------------------------------------------------------- release
    function test_Release_SplitsFeeAndNetAndMarksReleased() public {
        _deposit(OID, 100e6);
        vm.expectEmit(true, true, true, true, address(escrow));
        emit AllocXEscrow.Released(OID, payee, projectId, 100e6, 2e6, 98e6);
        (uint256 fee, uint256 net) = escrow.release(OID, payee);
        assertEq(fee, 2e6);
        assertEq(net, 98e6);
        assertEq(usdc.balanceOf(payee), 98e6);
        assertEq(usdc.balanceOf(treasury), 2e6);
        assertEq(usdc.balanceOf(address(escrow)), 0);
        assertEq(escrow.totalHeld(), 0);
        assertEq(escrow.heldAmount(OID), 0);
        (,, AllocXEscrow.DepositState st) = escrow.depositOf(OID);
        assertEq(uint8(st), uint8(AllocXEscrow.DepositState.Released));
    }

    function test_Release_UsesFeeSnapshotTakenAtDeposit() public {
        _deposit(OID, 100e6); // snapshot: 2%
        vm.startPrank(admin);
        feeManager.setDefaultFee(1000);
        feeManager.setProjectFee(projectId, 900);
        vm.stopPrank();
        (uint256 fee,) = escrow.release(OID, payee);
        assertEq(fee, 2e6, "later fee changes must not affect a funded order");

        // an order funded after the change snapshots the new fee
        _deposit(OID + 1, 100e6);
        vm.prank(admin);
        feeManager.setProjectFee(projectId, 0);
        (fee,) = escrow.release(OID + 1, payee);
        assertEq(fee, 9e6);
    }

    function test_Release_SnapshotsProjectOverride() public {
        vm.prank(admin);
        feeManager.setProjectFee(projectId, 500);
        _deposit(OID, 200e6);
        vm.prank(admin);
        feeManager.clearProjectFee(projectId);
        (uint256 fee, uint256 net) = escrow.release(OID, payee);
        assertEq(fee, 10e6);
        assertEq(net, 190e6);
    }

    function test_Release_Reverts() public {
        vm.expectRevert(AllocXEscrow.NotHeld.selector);
        escrow.release(OID, payee);
        _deposit(OID, 5e6);
        vm.expectRevert(AllocXEscrow.ZeroAddress.selector);
        escrow.release(OID, address(0));
        vm.prank(stranger);
        vm.expectRevert(_unauth(stranger, SETTLEMENT_ROLE));
        escrow.release(OID, payee);
        escrow.release(OID, payee);
        vm.expectRevert(AllocXEscrow.NotHeld.selector);
        escrow.release(OID, payee);
    }

    function test_Release_PaysSellerEvenWhenRecipientsBlocked() public {
        usdc.setBlocked(payee, true);
        usdc.setBlocked(treasury, true);
        _deposit(OID, 100e6);
        (uint256 fee, uint256 net) = escrow.release(OID, payee);
        assertEq(feeManager.pendingOf(payee), net);
        assertEq(feeManager.pendingOf(treasury), fee);
        assertEq(usdc.balanceOf(address(escrow)), 0);
    }

    // ---------------------------------------------------------------- refund
    function test_Refund_ReturnsFundsToPayer() public {
        uint256 before = usdc.balanceOf(buyer);
        _deposit(OID, 100e6);
        vm.expectEmit(true, true, false, true, address(escrow));
        emit AllocXEscrow.Refunded(OID, buyer, 100e6);
        uint256 amt = escrow.refund(OID);
        assertEq(amt, 100e6);
        assertEq(usdc.balanceOf(buyer), before);
        assertEq(escrow.totalHeld(), 0);
        (,, AllocXEscrow.DepositState st) = escrow.depositOf(OID);
        assertEq(uint8(st), uint8(AllocXEscrow.DepositState.Refunded));
    }

    function test_Refund_Reverts() public {
        vm.expectRevert(AllocXEscrow.NotHeld.selector);
        escrow.refund(OID);
        _deposit(OID, 5e6);
        vm.prank(stranger);
        vm.expectRevert(_unauth(stranger, SETTLEMENT_ROLE));
        escrow.refund(OID);
        escrow.refund(OID);
        vm.expectRevert(AllocXEscrow.NotHeld.selector);
        escrow.refund(OID);
    }

    function test_Refund_CannotFollowReleaseAndViceVersa() public {
        _deposit(OID, 5e6);
        escrow.release(OID, payee);
        vm.expectRevert(AllocXEscrow.NotHeld.selector);
        escrow.refund(OID);
        _deposit(OID + 1, 5e6);
        escrow.refund(OID + 1);
        vm.expectRevert(AllocXEscrow.NotHeld.selector);
        escrow.release(OID + 1, payee);
    }

    function test_Refund_BlockedPayerIsDeferredNotReverted() public {
        _deposit(OID, 100e6);
        usdc.setBlocked(buyer, true);
        vm.expectEmit(true, true, false, true, address(escrow));
        emit AllocXEscrow.RefundDeferred(OID, buyer, 100e6);
        escrow.refund(OID);
        assertEq(escrow.pendingRefundOf(buyer), 100e6);
        assertEq(escrow.pendingRefund(buyer), 100e6);
        assertEq(escrow.totalPendingRefunds(), 100e6);
        assertEq(escrow.totalHeld(), 0);
        assertEq(usdc.balanceOf(address(escrow)), 100e6, "funds stay reserved");
    }

    function test_WithdrawRefund_ToAnotherAddress() public {
        _deposit(OID, 100e6);
        usdc.setBlocked(buyer, true);
        escrow.refund(OID);

        vm.prank(buyer);
        vm.expectRevert(AllocXEscrow.ZeroAddress.selector);
        escrow.withdrawRefund(address(0));

        // blocked destination: transfer fails, entitlement preserved
        vm.prank(buyer);
        vm.expectRevert();
        escrow.withdrawRefund(buyer);
        assertEq(escrow.pendingRefundOf(buyer), 100e6);

        vm.expectEmit(true, true, false, true, address(escrow));
        emit AllocXEscrow.RefundWithdrawn(buyer, other, 100e6);
        vm.prank(buyer);
        escrow.withdrawRefund(other);
        assertEq(usdc.balanceOf(other), 100e6);
        assertEq(escrow.pendingRefundOf(buyer), 0);
        assertEq(escrow.totalPendingRefunds(), 0);
        assertEq(usdc.balanceOf(address(escrow)), 0);

        vm.prank(buyer);
        vm.expectRevert(AllocXEscrow.InvalidAmount.selector);
        escrow.withdrawRefund(other);
    }

    function test_WithdrawRefund_NothingPendingReverts() public {
        vm.prank(stranger);
        vm.expectRevert(AllocXEscrow.InvalidAmount.selector);
        escrow.withdrawRefund(stranger);
    }

    // ------------------------------------------------------------ accounting
    function testFuzz_BalanceAlwaysCoversHeldPlusPending(uint8 count, uint256 seed) public {
        count = uint8(bound(count, 1, 12));
        uint256 held;
        for (uint256 i; i < count; ++i) {
            uint256 amt = bound(uint256(keccak256(abi.encode(seed, i))), 1e6, 1_000e6);
            _deposit(OID + i, amt);
            held += amt;
            uint256 pick = uint256(keccak256(abi.encode(seed, i, "act"))) % 3;
            if (pick == 1) {
                escrow.release(OID + i, payee);
                held -= amt;
            } else if (pick == 2) {
                escrow.refund(OID + i);
                held -= amt;
            }
            assertEq(escrow.totalHeld(), held);
            assertGe(usdc.balanceOf(address(escrow)), escrow.totalHeld() + escrow.totalPendingRefunds());
        }
    }

    function test_NoAdminWithdrawPath() public {
        _deposit(OID, 100e6);
        // Admin can configure roles but has no function to move escrowed funds.
        vm.prank(admin);
        vm.expectRevert(_unauth(admin, SETTLEMENT_ROLE));
        escrow.refund(OID);
        vm.prank(admin);
        vm.expectRevert(_unauth(admin, SETTLEMENT_ROLE));
        escrow.release(OID, admin);
        assertEq(usdc.balanceOf(address(escrow)), 100e6);
    }
}
