// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./AllocX.Base.t.sol";

/// @dev Unit tests for AllocXFeeManager, driving distribute() directly as an ESCROW_ROLE holder.
contract AllocXFeeManagerTest is AllocXTestBase {
    address internal payee = makeAddr("payee");
    address internal other = makeAddr("other");

    function setUp() public override {
        super.setUp();
        vm.prank(admin);
        feeManager.grantRole(ESCROW_ROLE, address(this));
    }

    function _distribute(address to, uint256 gross, uint16 bps) internal returns (uint256 fee, uint256 net) {
        usdc.mint(address(feeManager), gross);
        (fee, net) = feeManager.distribute(to, gross, projectId, bps);
    }

    // ------------------------------------------------------------ fee config
    function test_DefaultFeeIsTwoPercent() public view {
        assertEq(feeManager.feeBps(projectId), 200);
        assertEq(feeManager.MAX_FEE_BPS(), 1000);
        (uint256 fee, uint256 net) = feeManager.quote(projectId, 1_000e6);
        assertEq(fee, 20e6);
        assertEq(net, 980e6);
    }

    function test_Quote_RoundsFeeDown() public view {
        (uint256 fee, uint256 net) = feeManager.quote(projectId, 999);
        assertEq(fee, 19); // 999 * 2% = 19.98
        assertEq(net, 980);
        (fee, net) = feeManager.quote(projectId, 49);
        assertEq(fee, 0);
        assertEq(net, 49);
    }

    function test_SetDefaultFee_UpdatesAndEmits() public {
        vm.expectEmit(false, false, false, true, address(feeManager));
        emit AllocXFeeManager.DefaultFeeUpdated(200, 500);
        vm.prank(admin);
        feeManager.setDefaultFee(500);
        assertEq(feeManager.feeBps(projectId), 500);
        assertEq(feeManager.feeBps(12345), 500);
    }

    function test_SetDefaultFee_CapAndRole() public {
        vm.prank(admin);
        feeManager.setDefaultFee(1000);
        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSelector(AllocXFeeManager.FeeTooHigh.selector, uint16(1001)));
        feeManager.setDefaultFee(1001);
        vm.prank(stranger);
        vm.expectRevert(_unauth(stranger, FEE_ADMIN_ROLE));
        feeManager.setDefaultFee(100);
    }

    function test_ProjectFeeOverrideAndClear() public {
        vm.expectEmit(true, false, false, true, address(feeManager));
        emit AllocXFeeManager.ProjectFeeUpdated(projectId, 50);
        vm.prank(admin);
        feeManager.setProjectFee(projectId, 50);
        assertEq(feeManager.feeBps(projectId), 50);
        assertEq(feeManager.feeBps(projectId + 1), 200, "other projects keep the default");
        (uint256 fee,) = feeManager.quote(projectId, 1_000e6);
        assertEq(fee, 5e6);

        vm.expectEmit(true, false, false, false, address(feeManager));
        emit AllocXFeeManager.ProjectFeeCleared(projectId);
        vm.prank(admin);
        feeManager.clearProjectFee(projectId);
        assertEq(feeManager.feeBps(projectId), 200);
    }

    function test_ProjectFee_ZeroOverrideIsHonoured() public {
        vm.prank(admin);
        feeManager.setProjectFee(projectId, 0);
        assertEq(feeManager.feeBps(projectId), 0, "explicit zero override beats the default");
    }

    function test_ProjectFee_RevertsAboveCapOrWithoutRole() public {
        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSelector(AllocXFeeManager.FeeTooHigh.selector, uint16(1001)));
        feeManager.setProjectFee(projectId, 1001);
        vm.prank(stranger);
        vm.expectRevert(_unauth(stranger, FEE_ADMIN_ROLE));
        feeManager.setProjectFee(projectId, 1);
        vm.prank(stranger);
        vm.expectRevert(_unauth(stranger, FEE_ADMIN_ROLE));
        feeManager.clearProjectFee(projectId);
    }

    function test_SetTreasury() public {
        vm.expectEmit(true, true, false, false, address(feeManager));
        emit AllocXFeeManager.TreasuryUpdated(treasury, other);
        vm.prank(admin);
        feeManager.setTreasury(other);
        assertEq(feeManager.treasury(), other);

        vm.startPrank(admin);
        vm.expectRevert(AllocXFeeManager.ZeroAddress.selector);
        feeManager.setTreasury(address(0));
        vm.expectRevert(AllocXFeeManager.InvalidRecipient.selector);
        feeManager.setTreasury(address(feeManager));
        vm.stopPrank();
        vm.prank(stranger);
        vm.expectRevert(_unauth(stranger, FEE_ADMIN_ROLE));
        feeManager.setTreasury(stranger);
    }

    // ------------------------------------------------------------ distribute
    function test_Distribute_PaysFeeToTreasuryAndNetToSeller() public {
        usdc.mint(address(feeManager), 100e6);
        vm.expectEmit(true, true, true, true, address(feeManager));
        emit AllocXFeeManager.PaymentDistributed(projectId, payee, 100e6, 2e6, 98e6, treasury);
        (uint256 fee, uint256 net) = feeManager.distribute(payee, 100e6, projectId, 200);
        assertEq(fee, 2e6);
        assertEq(net, 98e6);
        assertEq(usdc.balanceOf(treasury), 2e6);
        assertEq(usdc.balanceOf(payee), 98e6);
        assertEq(usdc.balanceOf(address(feeManager)), 0);
        assertEq(feeManager.totalFeesCollected(), 2e6);
        assertEq(feeManager.totalVolume(), 100e6);
        assertEq(feeManager.accounted(), 0);
    }

    function test_Distribute_UsesSnapshotNotLiveFee() public {
        vm.prank(admin);
        feeManager.setDefaultFee(900);
        (uint256 fee, uint256 net) = _distribute(payee, 100e6, 100); // snapshot of 1%
        assertEq(fee, 1e6);
        assertEq(net, 99e6);
    }

    function test_Distribute_ZeroFeeSnapshotPaysEverythingToSeller() public {
        (uint256 fee, uint256 net) = _distribute(payee, 77e6, 0);
        assertEq(fee, 0);
        assertEq(net, 77e6);
        assertEq(usdc.balanceOf(treasury), 0);
        assertEq(usdc.balanceOf(payee), 77e6);
    }

    function test_Distribute_RevertsForNonEscrow() public {
        usdc.mint(address(feeManager), 100e6);
        vm.prank(stranger);
        vm.expectRevert(_unauth(stranger, ESCROW_ROLE));
        feeManager.distribute(payee, 100e6, projectId, 200);
    }

    function test_Distribute_InputValidation() public {
        usdc.mint(address(feeManager), 100e6);
        vm.expectRevert(AllocXFeeManager.ZeroAddress.selector);
        feeManager.distribute(address(0), 100e6, projectId, 200);
        vm.expectRevert(AllocXFeeManager.InvalidRecipient.selector);
        feeManager.distribute(address(feeManager), 100e6, projectId, 200);
        vm.expectRevert(AllocXFeeManager.ZeroGross.selector);
        feeManager.distribute(payee, 0, projectId, 200);
        vm.expectRevert(abi.encodeWithSelector(AllocXFeeManager.FeeTooHigh.selector, uint16(1001)));
        feeManager.distribute(payee, 100e6, projectId, 1001);
    }

    function test_Distribute_RevertsWithoutFreshFunding() public {
        vm.expectRevert(abi.encodeWithSelector(AllocXFeeManager.InsufficientFunding.selector, 0, 100e6));
        feeManager.distribute(payee, 100e6, projectId, 200);
        // funding can not be reused: one funding covers one distribution
        _distribute(payee, 100e6, 200);
        vm.expectRevert(abi.encodeWithSelector(AllocXFeeManager.InsufficientFunding.selector, 0, 100e6));
        feeManager.distribute(payee, 100e6, projectId, 200);
    }

    function test_Distribute_PartialFundingReverts() public {
        usdc.mint(address(feeManager), 99e6);
        vm.expectRevert(abi.encodeWithSelector(AllocXFeeManager.InsufficientFunding.selector, 99e6, 100e6));
        feeManager.distribute(payee, 100e6, projectId, 200);
    }

    function testFuzz_Distribute_ConservesValue(uint256 gross, uint16 bps, uint256 prior) public {
        gross = bound(gross, 1, 1e15);
        bps = uint16(bound(bps, 0, 1000));
        prior = bound(prior, 0, 1e12);
        _distribute(makeAddr("prior"), prior == 0 ? 1 : prior, 200); // totals already non-zero
        uint256 volBefore = feeManager.totalVolume();
        uint256 feesBefore = feeManager.totalFeesCollected();
        (uint256 fee, uint256 net) = _distribute(payee, gross, bps);
        assertEq(fee, (gross * bps) / 10_000);
        assertEq(fee + net, gross);
        assertEq(usdc.balanceOf(payee), net);
        assertEq(feeManager.totalVolume(), volBefore + gross);
        assertEq(feeManager.totalFeesCollected(), feesBefore + fee);
        assertEq(usdc.balanceOf(address(feeManager)), feeManager.accounted());
    }

    // ------------------------------------------------- blocklisted recipients
    function test_BlockedTreasury_FeeDeferredAndWithdrawable() public {
        usdc.setBlocked(treasury, true);
        usdc.mint(address(feeManager), 100e6);
        vm.expectEmit(true, false, false, true, address(feeManager));
        emit AllocXFeeManager.PayoutDeferred(treasury, 2e6);
        (uint256 fee, uint256 net) = feeManager.distribute(payee, 100e6, projectId, 200);
        assertEq(fee, 2e6);
        assertEq(usdc.balanceOf(payee), net, "seller still paid");
        assertEq(feeManager.pendingOf(treasury), 2e6);
        assertEq(usdc.balanceOf(address(feeManager)), 2e6);
        assertEq(feeManager.accounted(), 2e6);

        // blocked account cannot be paid out to itself, and the failed withdrawal keeps the balance
        vm.prank(treasury);
        vm.expectRevert();
        feeManager.withdrawPending(treasury);
        assertEq(feeManager.pendingOf(treasury), 2e6);

        vm.expectEmit(true, true, false, true, address(feeManager));
        emit AllocXFeeManager.PendingWithdrawn(treasury, other, 2e6);
        vm.prank(treasury);
        feeManager.withdrawPending(other);
        assertEq(usdc.balanceOf(other), 2e6);
        assertEq(feeManager.pendingOf(treasury), 0);
        assertEq(feeManager.accounted(), 0);
        assertEq(usdc.balanceOf(address(feeManager)), 0);
    }

    function test_BlockedSeller_NetDeferredAndWithdrawable() public {
        usdc.setBlocked(payee, true);
        (uint256 fee, uint256 net) = _distribute(payee, 100e6, 200);
        assertEq(usdc.balanceOf(treasury), fee, "treasury still paid");
        assertEq(feeManager.pendingOf(payee), net);
        vm.prank(payee);
        feeManager.withdrawPending(other);
        assertEq(usdc.balanceOf(other), net);
        assertEq(feeManager.pendingOf(payee), 0);
    }

    function test_BothBlocked_BothDeferredAndBalanceCoversPending() public {
        usdc.setBlocked(payee, true);
        usdc.setBlocked(treasury, true);
        (uint256 fee, uint256 net) = _distribute(payee, 100e6, 200);
        assertEq(feeManager.pendingOf(treasury), fee);
        assertEq(feeManager.pendingOf(payee), net);
        assertEq(usdc.balanceOf(address(feeManager)), fee + net);
        assertEq(feeManager.accounted(), fee + net);
        // later distributions are unaffected by the stuck liabilities and cannot spend them
        usdc.setBlocked(payee, false);
        usdc.setBlocked(treasury, false);
        _distribute(payee, 50e6, 200);
        assertEq(usdc.balanceOf(address(feeManager)), fee + net);
        // pending is still fully backed
        assertGe(usdc.balanceOf(address(feeManager)), feeManager.pendingOf(payee) + feeManager.pendingOf(treasury));
    }

    function test_PendingPayoutsAccumulate() public {
        usdc.setBlocked(payee, true);
        (, uint256 n1) = _distribute(payee, 100e6, 200);
        (, uint256 n2) = _distribute(payee, 40e6, 200);
        assertEq(feeManager.pendingOf(payee), n1 + n2);
    }

    function test_WithdrawPending_Reverts() public {
        vm.prank(payee);
        vm.expectRevert(AllocXFeeManager.NoPendingPayout.selector);
        feeManager.withdrawPending(payee);
        vm.prank(payee);
        vm.expectRevert(AllocXFeeManager.ZeroAddress.selector);
        feeManager.withdrawPending(address(0));
        vm.prank(payee);
        vm.expectRevert(AllocXFeeManager.InvalidRecipient.selector);
        feeManager.withdrawPending(address(feeManager));
    }

    function test_WithdrawPending_SecondCallHasNothing() public {
        usdc.setBlocked(payee, true);
        _distribute(payee, 100e6, 200);
        vm.startPrank(payee);
        feeManager.withdrawPending(other);
        vm.expectRevert(AllocXFeeManager.NoPendingPayout.selector);
        feeManager.withdrawPending(other);
        vm.stopPrank();
    }
}
