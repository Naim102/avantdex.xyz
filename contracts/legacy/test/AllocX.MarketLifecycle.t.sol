// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./AllocX.Base.t.sol";

/// @dev Marketplace update / cancel / stale / buy / pause / settlement hooks.
contract AllocXMarketLifecycleTest is AllocXTestBase {
    uint256 internal lid; // an async ERC721 listing

    function setUp() public override {
        super.setUp();
        lid = _listAsync(_arr1(_i721(1)));
    }

    // ---------------------------------------------------------------- update
    function test_Update_ChangesTermsAndEmits() public {
        uint64 newExp = uint64(block.timestamp + 30 days);
        vm.expectEmit(true, false, false, true, address(marketplace));
        emit AllocXMarketplace.ListingUpdated(lid, 250e6, newExp);
        vm.prank(seller);
        marketplace.updateListing(lid, 250e6, newExp);
        Listing memory l = marketplace.getListing(lid);
        assertEq(l.price, 250e6);
        assertEq(l.expiry, newExp);
        assertEq(uint8(l.status), uint8(ListingStatus.Active));
    }

    function test_Update_OnlySellerAndOnlyActive() public {
        vm.prank(stranger);
        vm.expectRevert(AllocXMarketplace.NotSeller.selector);
        marketplace.updateListing(lid, PRICE, uint64(block.timestamp + 1 days));

        _buy(lid);
        vm.prank(seller);
        vm.expectRevert(AllocXMarketplace.InvalidStatus.selector);
        marketplace.updateListing(lid, PRICE, uint64(block.timestamp + 1 days));

        uint256 other = _listAsync(_arr1(_i721(2)));
        vm.prank(seller);
        marketplace.cancelListing(other);
        vm.prank(seller);
        vm.expectRevert(AllocXMarketplace.InvalidStatus.selector);
        marketplace.updateListing(other, PRICE, uint64(block.timestamp + 1 days));

        vm.prank(seller);
        vm.expectRevert(AllocXMarketplace.InvalidListing.selector);
        marketplace.updateListing(999, PRICE, uint64(block.timestamp + 1 days));
    }

    function test_Update_ValidatesTerms() public {
        vm.startPrank(seller);
        vm.expectRevert(AllocXMarketplace.InvalidPrice.selector);
        marketplace.updateListing(lid, 1e6 - 1, uint64(block.timestamp + 1 days));
        vm.expectRevert(AllocXMarketplace.InvalidExpiry.selector);
        marketplace.updateListing(lid, PRICE, uint64(block.timestamp));
        vm.expectRevert(AllocXMarketplace.InvalidExpiry.selector);
        marketplace.updateListing(lid, PRICE, uint64(block.timestamp + 365 days + 1));
        vm.stopPrank();
    }

    function test_Update_CanReviveExpiredListingIfKeyStillFree() public {
        vm.warp(block.timestamp + 8 days);
        assertFalse(marketplace.isLive(lid));
        vm.prank(seller);
        marketplace.updateListing(lid, PRICE, uint64(block.timestamp + 1 days));
        assertTrue(marketplace.isLive(lid));
    }

    function test_Update_CannotReviveExpiredListingWhenAnotherLiveListingHoldsKey() public {
        vm.warp(block.timestamp + 8 days);
        _listAsync(_arr1(_i721(1))); // new live listing for the same NFT
        vm.prank(seller);
        vm.expectRevert(AllocXMarketplace.DuplicateListing.selector);
        marketplace.updateListing(lid, PRICE, uint64(block.timestamp + 1 days));
    }

    // ---------------------------------------------------------------- cancel
    function test_Cancel_BySellerEmitsAndFreesKey() public {
        vm.expectEmit(true, true, false, false, address(marketplace));
        emit AllocXMarketplace.ListingCancelled(lid, seller);
        vm.prank(seller);
        marketplace.cancelListing(lid);
        assertEq(uint8(_lstatus(lid)), uint8(ListingStatus.Cancelled));
        assertFalse(marketplace.isLive(lid));
        vm.prank(buyer);
        vm.expectRevert(AllocXMarketplace.InvalidStatus.selector);
        marketplace.buy(lid, type(uint256).max);
    }

    function test_Cancel_Reverts() public {
        vm.prank(stranger);
        vm.expectRevert(AllocXMarketplace.NotSeller.selector);
        marketplace.cancelListing(lid);
        vm.prank(seller);
        marketplace.cancelListing(lid);
        vm.prank(seller);
        vm.expectRevert(AllocXMarketplace.InvalidStatus.selector);
        marketplace.cancelListing(lid);
        vm.prank(seller);
        vm.expectRevert(AllocXMarketplace.InvalidListing.selector);
        marketplace.cancelListing(999);
    }

    function test_Cancel_ReservedListingCannotBeCancelled() public {
        uint256 orderId = _buy(lid);
        vm.prank(seller);
        vm.expectRevert(AllocXMarketplace.InvalidStatus.selector);
        marketplace.cancelListing(lid);
        vm.prank(admin);
        vm.expectRevert(AllocXMarketplace.InvalidStatus.selector);
        marketplace.moderatorCancel(lid);
        vm.expectRevert(AllocXMarketplace.InvalidStatus.selector);
        marketplace.cancelStale(lid);
        assertEq(uint8(_lstatus(lid)), uint8(ListingStatus.Reserved));
        assertEq(orderId, 1);
    }

    function test_ModeratorCancel() public {
        vm.expectEmit(true, true, false, false, address(marketplace));
        emit AllocXMarketplace.ListingCancelled(lid, admin);
        vm.prank(admin);
        marketplace.moderatorCancel(lid);
        assertEq(uint8(_lstatus(lid)), uint8(ListingStatus.Cancelled));
    }

    function test_ModeratorCancel_RoleOnlyAndWorksWhilePaused() public {
        vm.prank(stranger);
        vm.expectRevert(_unauth(stranger, MODERATOR_ROLE));
        marketplace.moderatorCancel(lid);
        vm.prank(seller);
        vm.expectRevert(_unauth(seller, MODERATOR_ROLE));
        marketplace.moderatorCancel(lid);
        vm.startPrank(admin);
        marketplace.pause();
        marketplace.moderatorCancel(lid);
        vm.stopPrank();
        assertEq(uint8(_lstatus(lid)), uint8(ListingStatus.Cancelled));
    }

    function test_Cancel_SellerCanCancelWhilePaused() public {
        vm.prank(admin);
        marketplace.pause();
        vm.prank(seller);
        marketplace.cancelListing(lid);
        assertEq(uint8(_lstatus(lid)), uint8(ListingStatus.Cancelled));
    }

    // ------------------------------------------------------------ cancelStale
    function test_CancelStale_RevertsWhileHealthy() public {
        vm.prank(stranger);
        vm.expectRevert(AllocXMarketplace.NotStale.selector);
        marketplace.cancelStale(lid);
    }

    function test_CancelStale_Expired() public {
        vm.warp(block.timestamp + 7 days - 1);
        vm.expectRevert(AllocXMarketplace.NotStale.selector);
        marketplace.cancelStale(lid);
        vm.warp(block.timestamp + 1); // exactly at expiry
        vm.prank(stranger);
        marketplace.cancelStale(lid);
        assertEq(uint8(_lstatus(lid)), uint8(ListingStatus.Cancelled));
    }

    function test_CancelStale_ProjectNoLongerActive() public {
        vm.prank(admin);
        registry.suspendProject(projectId);
        assertFalse(marketplace.isLive(lid));
        marketplace.cancelStale(lid);
        assertEq(uint8(_lstatus(lid)), uint8(ListingStatus.Cancelled));
    }

    function test_CancelStale_SellerNoLongerOwnsItem() public {
        vm.prank(seller);
        nft.transferFrom(seller, stranger, 1);
        assertFalse(marketplace.isLive(lid));
        marketplace.cancelStale(lid);
        assertEq(uint8(_lstatus(lid)), uint8(ListingStatus.Cancelled));
    }

    function test_CancelStale_ControlRightMovedAway() public {
        uint256 id = _listAsync(_arr1(_iOwn()));
        vm.prank(seller);
        ownable.transferOwnership(stranger);
        marketplace.cancelStale(id);
        assertEq(uint8(_lstatus(id)), uint8(ListingStatus.Cancelled));
    }

    function test_CancelStale_AutoSettleListingWithRevokedApproval() public {
        _approveTokens();
        uint256 id = _list(_arr1(_i721(2)), PRICE, true);
        assertTrue(marketplace.isLive(id));
        vm.prank(seller);
        nft.setApprovalForAll(address(assetManager), false);
        assertFalse(marketplace.isLive(id));
        marketplace.cancelStale(id);
        assertEq(uint8(_lstatus(id)), uint8(ListingStatus.Cancelled));
    }

    function test_CancelStale_AsyncListingIgnoresApprovals() public {
        // async listings never needed approval, so missing approval is not staleness
        vm.expectRevert(AllocXMarketplace.NotStale.selector);
        marketplace.cancelStale(lid);
    }

    function test_CancelStale_OnlyActiveListings() public {
        vm.prank(seller);
        marketplace.cancelListing(lid);
        vm.expectRevert(AllocXMarketplace.InvalidStatus.selector);
        marketplace.cancelStale(lid);
        vm.expectRevert(AllocXMarketplace.InvalidListing.selector);
        marketplace.cancelStale(999);
    }

    // ------------------------------------------------------------------- buy
    function test_Buy_ReservesListingAndFundsEscrow() public {
        uint256 before = usdc.balanceOf(buyer);
        vm.expectEmit(true, true, true, false, address(marketplace));
        emit AllocXMarketplace.ListingReserved(lid, 1, buyer);
        vm.prank(buyer);
        uint256 orderId = marketplace.buy(lid, PRICE);
        assertEq(orderId, 1);
        Listing memory l = marketplace.getListing(lid);
        assertEq(uint8(l.status), uint8(ListingStatus.Reserved));
        assertEq(l.orderId, orderId);
        assertEq(usdc.balanceOf(buyer), before - PRICE);
        assertEq(usdc.balanceOf(address(escrow)), PRICE);
        assertEq(escrow.heldAmount(orderId), PRICE);
        Order memory o = settlement.getOrder(orderId);
        assertEq(o.buyer, buyer);
        assertEq(o.seller, seller);
        assertEq(o.price, PRICE);
        assertEq(o.deadline, block.timestamp + WINDOW);
        assertEq(uint8(o.status), uint8(OrderStatus.Funded));
        assertEq(o.itemsHash, l.itemsHash);
        assertEq(nft.ownerOf(1), seller, "async purchase does not move tokens yet");
    }

    function test_Buy_OrderOpenedEvent() public {
        Listing memory l = marketplace.getListing(lid);
        vm.expectEmit(true, true, true, true, address(settlement));
        emit AllocXSettlement.OrderOpened(
            1, lid, projectId, buyer, seller, PRICE, uint64(block.timestamp + WINDOW), l.itemsHash
        );
        _buy(lid);
    }

    function test_Buy_RevertsOnUnknownOrNonActiveListing() public {
        vm.prank(buyer);
        vm.expectRevert(AllocXMarketplace.InvalidListing.selector);
        marketplace.buy(999, type(uint256).max);
        _buy(lid);
        vm.prank(stranger);
        vm.expectRevert(AllocXMarketplace.InvalidStatus.selector);
        marketplace.buy(lid, type(uint256).max);
    }

    function test_Buy_RevertsWhenExpired() public {
        vm.warp(block.timestamp + 7 days - 1);
        _buy(lid); // last valid second
        uint256 id2 = _listAsync(_arr1(_i721(2)));
        vm.warp(marketplace.getListing(id2).expiry);
        vm.prank(buyer);
        vm.expectRevert(AllocXMarketplace.InvalidExpiry.selector);
        marketplace.buy(id2, type(uint256).max);
    }

    function test_Buy_SelfPurchaseReverts() public {
        usdc.mint(seller, PRICE);
        vm.prank(seller);
        usdc.approve(address(escrow), type(uint256).max);
        vm.prank(seller);
        vm.expectRevert(AllocXMarketplace.SelfPurchase.selector);
        marketplace.buy(lid, type(uint256).max);
    }

    function test_Buy_MaxPriceSlippageProtection() public {
        vm.prank(buyer);
        vm.expectRevert(AllocXMarketplace.PriceExceedsMaximum.selector);
        marketplace.buy(lid, PRICE - 1);
        vm.prank(buyer);
        marketplace.buy(lid, PRICE); // exact max passes
    }

    function test_Buy_SellerRaisesPriceAfterBuyerQuote() public {
        // buyer saw PRICE; seller front-runs with a price hike
        vm.prank(seller);
        marketplace.updateListing(lid, PRICE * 10, uint64(block.timestamp + 7 days));
        vm.prank(buyer);
        vm.expectRevert(AllocXMarketplace.PriceExceedsMaximum.selector);
        marketplace.buy(lid, PRICE);
        assertEq(usdc.balanceOf(address(escrow)), 0);
    }

    function test_Buy_RevertsWhenProjectNotActive() public {
        vm.prank(admin);
        registry.suspendProject(projectId);
        vm.prank(buyer);
        vm.expectRevert(AllocXMarketplace.ProjectNotActive.selector);
        marketplace.buy(lid, type(uint256).max);
    }

    function test_Buy_RevertsWhenSellerNoLongerControlsItem() public {
        vm.prank(seller);
        nft.transferFrom(seller, stranger, 1);
        vm.prank(buyer);
        vm.expectRevert(abi.encodeWithSelector(AllocXMarketplace.NotController.selector, 0));
        marketplace.buy(lid, type(uint256).max);
    }

    function test_Buy_RevertsWhenPaused() public {
        vm.prank(admin);
        marketplace.pause();
        vm.prank(buyer);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        marketplace.buy(lid, type(uint256).max);
        vm.prank(admin);
        marketplace.unpause();
        _buy(lid);
    }

    function test_Buy_RevertsWithoutUsdcAllowanceOrBalance() public {
        vm.prank(stranger);
        vm.expectRevert(); // no allowance / balance
        marketplace.buy(lid, type(uint256).max);
        assertEq(uint8(_lstatus(lid)), uint8(ListingStatus.Active), "failed buy leaves listing untouched");
    }

    function test_Buy_RevertsWhenSettlementPaused() public {
        vm.prank(admin);
        settlement.pause();
        vm.prank(buyer);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        marketplace.buy(lid, type(uint256).max);
    }

    function test_Buy_RevertsWhenSettlementNotSet() public {
        AllocXMarketplace m = new AllocXMarketplace(admin, address(registry), address(assetManager), address(ownership));
        vm.prank(seller);
        uint256 id = m.createListing(
            projectId, _arr1(_i721(5)), PRICE, uint64(block.timestamp + 1 days), WINDOW, false, 0
        );
        vm.prank(buyer);
        vm.expectRevert(AllocXMarketplace.SettlementNotSet.selector);
        m.buy(id, type(uint256).max);
    }

    // ------------------------------------------------------------ views/hooks
    function test_IsLive_ReflectsStatusExpiryProjectAndControl() public {
        assertTrue(marketplace.isLive(lid));
        assertFalse(marketplace.isLive(999));
        _buy(lid);
        assertFalse(marketplace.isLive(lid), "reserved is not live");
    }

    function test_Views_UnknownListingReverts() public {
        vm.expectRevert(AllocXMarketplace.InvalidListing.selector);
        marketplace.getListing(0);
        vm.expectRevert(AllocXMarketplace.InvalidListing.selector);
        marketplace.getItems(999);
    }

    function test_Hooks_OnlySettlementRole() public {
        _buy(lid);
        vm.prank(stranger);
        vm.expectRevert(_unauth(stranger, SETTLEMENT_ROLE));
        marketplace.onOrderSettled(lid);
        vm.prank(stranger);
        vm.expectRevert(_unauth(stranger, SETTLEMENT_ROLE));
        marketplace.onOrderReopened(lid);
        vm.prank(admin);
        vm.expectRevert(_unauth(admin, SETTLEMENT_ROLE));
        marketplace.onOrderSettled(lid);
    }

    function test_Hooks_RequireReservedListing() public {
        vm.prank(admin);
        marketplace.grantRole(SETTLEMENT_ROLE, address(this));
        vm.expectRevert(AllocXMarketplace.InvalidStatus.selector);
        marketplace.onOrderSettled(lid); // Active, not Reserved
        vm.expectRevert(AllocXMarketplace.InvalidStatus.selector);
        marketplace.onOrderReopened(lid);
        vm.expectRevert(AllocXMarketplace.InvalidListing.selector);
        marketplace.onOrderSettled(999);
    }

    // ----------------------------------------------------------------- pause
    function test_Pause_RolesAndState() public {
        vm.prank(stranger);
        vm.expectRevert(_unauth(stranger, PAUSER_ROLE));
        marketplace.pause();
        vm.prank(admin);
        marketplace.pause();
        assertTrue(marketplace.paused());
        vm.prank(stranger);
        vm.expectRevert(_unauth(stranger, PAUSER_ROLE));
        marketplace.unpause();
        vm.prank(admin);
        marketplace.unpause();
        assertFalse(marketplace.paused());
    }

    function test_Pause_UpdateStillWorksWhilePaused() public {
        vm.prank(admin);
        marketplace.pause();
        vm.prank(seller);
        marketplace.updateListing(lid, 5e6, uint64(block.timestamp + 1 days));
        assertEq(marketplace.getListing(lid).price, 5e6);
    }

    function test_SetSettlement_Validation() public {
        AllocXMarketplace m = new AllocXMarketplace(admin, address(registry), address(assetManager), address(ownership));
        vm.startPrank(admin);
        vm.expectRevert(AllocXMarketplace.ZeroAddress.selector);
        m.setSettlement(address(0));
        vm.expectRevert(AllocXMarketplace.InvalidContract.selector);
        m.setSettlement(stranger);
        vm.expectEmit(true, false, false, false, address(m));
        emit AllocXMarketplace.SettlementSet(address(settlement));
        m.setSettlement(address(settlement));
        vm.stopPrank();
        assertEq(address(m.settlement()), address(settlement));
    }
}
