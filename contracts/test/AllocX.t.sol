// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {AllocXMarketplace} from "../AllocXMarketplace.sol";
import {AllocXEscrow} from "../AllocXEscrow.sol";
import {AllocXTransfer, AssetType, Support} from "../AllocXTransfer.sol";
import {
    BlocklistUSDC, MockERC20, FeeOnTransferERC20, MockERC721, MockERC1155
} from "./mocks/MockTokens.sol";

contract MockOwnable is Ownable {
    constructor(address o) Ownable(o) {}
}

contract MockOwnable2Step is Ownable2Step {
    constructor(address o) Ownable(o) {}
}

contract MockAdminControl is AccessControl {
    constructor(address admin) {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
    }
}

/// @dev Test suite for the deployed three-contract system (marketplace, escrow, transfer module).
contract AllocXTest is Test {
    AllocXMarketplace m;
    AllocXEscrow escrow;
    AllocXTransfer xfer;
    BlocklistUSDC usdc;

    address owner = makeAddr("owner");
    address seller = makeAddr("seller");
    address buyer = makeAddr("buyer");
    address other = makeAddr("other");

    uint256 constant PRICE = 50e6;

    function setUp() public {
        usdc = new BlocklistUSDC();
        m = new AllocXMarketplace(address(usdc), owner);
        escrow = m.escrow();
        xfer = m.transferModule();
        usdc.mint(buyer, 1_000e6);
        vm.prank(buyer);
        usdc.approve(address(escrow), type(uint256).max);
    }

    // ---------------------------------------------------------------- helpers

    function _list(AssetType t, address asset, uint256 id, uint256 amt) internal returns (uint256) {
        vm.prank(seller);
        return m.createListing(t, asset, id, amt, PRICE, "Asset", "desc", "");
    }

    function _buy(uint256 listingId) internal returns (uint256 orderId) {
        vm.prank(buyer);
        orderId = m.buy(listingId);
    }

    function _erc20Listing(uint256 amount) internal returns (MockERC20 t, uint256 id) {
        t = new MockERC20();
        t.mint(seller, 1_000 ether);
        vm.prank(seller);
        t.approve(address(xfer), type(uint256).max);
        id = _list(AssetType.ERC20, address(t), 0, amount);
    }

    // ---------------------------------------------------------------- construction

    function test_constructor_wiresModules() public view {
        assertEq(m.usdc(), address(usdc));
        assertEq(m.owner(), owner);
        assertEq(escrow.marketplace(), address(m));
        assertEq(xfer.marketplace(), address(m));
        assertEq(address(escrow.usdc()), address(usdc));
        assertEq(m.deliveryWindow(), 3 days);
    }

    function test_constructor_rejectsZero() public {
        vm.expectRevert(AllocXMarketplace.ZeroAddress.selector);
        new AllocXMarketplace(address(0), owner);
        // OpenZeppelin Ownable rejects a zero owner before our own check.
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableInvalidOwner.selector, address(0)));
        new AllocXMarketplace(address(usdc), address(0));
    }

    // ---------------------------------------------------------------- ERC-20

    function test_erc20_happyPath() public {
        (MockERC20 t, uint256 id) = _erc20Listing(100 ether);
        uint256 oid = _buy(id);
        assertEq(usdc.balanceOf(address(escrow)), PRICE);
        assertEq(escrow.totalHeld(), PRICE);

        vm.prank(seller);
        m.completeOrder(oid);

        assertEq(t.balanceOf(buyer), 100 ether);
        assertEq(usdc.balanceOf(seller), PRICE);
        assertEq(usdc.balanceOf(address(escrow)), 0);
        assertEq(escrow.totalHeld(), 0);
        assertEq(uint8(m.getListing(id).status), uint8(AllocXMarketplace.ListingStatus.Sold));
        assertEq(uint8(m.getOrder(oid).status), uint8(AllocXMarketplace.OrderStatus.Completed));
        assertEq(m.committedAmount(seller, AssetType.ERC20, address(t), 0), 0);
    }

    function test_erc20_listingRequiresApproval() public {
        MockERC20 t = new MockERC20();
        t.mint(seller, 10 ether);
        vm.prank(seller);
        vm.expectRevert(abi.encodeWithSelector(AllocXMarketplace.Unsupported.selector, Support.NotAuthorized));
        m.createListing(AssetType.ERC20, address(t), 0, 10 ether, PRICE, "x", "", "");
    }

    function test_erc20_cannotOverCommit() public {
        (MockERC20 t,) = _erc20Listing(600 ether);
        vm.prank(seller);
        vm.expectRevert(abi.encodeWithSelector(AllocXMarketplace.Unsupported.selector, Support.InsufficientBalance));
        m.createListing(AssetType.ERC20, address(t), 0, 600 ether, PRICE, "y", "", "");
        // 400 still fits
        vm.prank(seller);
        m.createListing(AssetType.ERC20, address(t), 0, 400 ether, PRICE, "y", "", "");
        assertEq(m.committedAmount(seller, AssetType.ERC20, address(t), 0), 1_000 ether);
    }

    function test_erc20_sellerSpendingAssetBlocksBuy() public {
        (MockERC20 t, uint256 id) = _erc20Listing(100 ether);
        vm.prank(seller);
        t.transfer(other, 950 ether);
        vm.prank(buyer);
        vm.expectRevert(abi.encodeWithSelector(AllocXMarketplace.Unsupported.selector, Support.InsufficientBalance));
        m.buy(id);
    }

    function test_erc20_revokedApprovalRefundsOnComplete() public {
        (MockERC20 t, uint256 id) = _erc20Listing(100 ether);
        uint256 oid = _buy(id);
        vm.prank(seller);
        t.approve(address(xfer), 0);

        uint256 before_ = usdc.balanceOf(buyer);
        vm.prank(seller);
        m.completeOrder(oid);

        assertEq(usdc.balanceOf(buyer), before_ + PRICE);
        assertEq(t.balanceOf(buyer), 0);
        assertEq(uint8(m.getOrder(oid).status), uint8(AllocXMarketplace.OrderStatus.Refunded));
        // Listing is live again.
        assertEq(uint8(m.getListing(id).status), uint8(AllocXMarketplace.ListingStatus.Active));
    }

    function test_erc20_feeOnTransferTokenRefunds() public {
        FeeOnTransferERC20 t = new FeeOnTransferERC20();
        t.mint(seller, 1_000 ether);
        vm.prank(seller);
        t.approve(address(xfer), type(uint256).max);
        uint256 id = _list(AssetType.ERC20, address(t), 0, 100 ether);
        uint256 oid = _buy(id);

        vm.prank(seller);
        m.completeOrder(oid);

        assertEq(t.balanceOf(buyer), 0, "short delivery must roll back");
        assertEq(t.balanceOf(seller), 1_000 ether);
        assertEq(uint8(m.getOrder(oid).status), uint8(AllocXMarketplace.OrderStatus.Refunded));
    }

    function test_completeOrder_onlySeller_forTokens() public {
        (, uint256 id) = _erc20Listing(1 ether);
        uint256 oid = _buy(id);
        vm.prank(buyer);
        vm.expectRevert(AllocXMarketplace.Unauthorized.selector);
        m.completeOrder(oid);
        vm.prank(other);
        vm.expectRevert(AllocXMarketplace.Unauthorized.selector);
        m.completeOrder(oid);
    }

    // ---------------------------------------------------------------- ERC-721 / 1155

    function test_erc721_happyPath() public {
        MockERC721 n = new MockERC721();
        n.mint(seller, 7);
        vm.prank(seller);
        n.approve(address(xfer), 7);
        uint256 id = _list(AssetType.ERC721, address(n), 7, 1);
        uint256 oid = _buy(id);
        vm.prank(seller);
        m.completeOrder(oid);
        assertEq(n.ownerOf(7), buyer);
        assertEq(usdc.balanceOf(seller), PRICE);
    }

    function test_erc721_notHolderCannotList() public {
        MockERC721 n = new MockERC721();
        n.mint(other, 7);
        vm.prank(seller);
        vm.expectRevert(abi.encodeWithSelector(AllocXMarketplace.Unsupported.selector, Support.NotHolder));
        m.createListing(AssetType.ERC721, address(n), 7, 1, PRICE, "x", "", "");
    }

    function test_erc721_amountMustBeOne() public {
        MockERC721 n = new MockERC721();
        n.mint(seller, 7);
        vm.prank(seller);
        vm.expectRevert(abi.encodeWithSelector(AllocXMarketplace.Unsupported.selector, Support.BadParams));
        m.createListing(AssetType.ERC721, address(n), 7, 2, PRICE, "x", "", "");
    }

    function test_erc721_cannotListTwice() public {
        MockERC721 n = new MockERC721();
        n.mint(seller, 7);
        vm.startPrank(seller);
        n.approve(address(xfer), 7);
        m.createListing(AssetType.ERC721, address(n), 7, 1, PRICE, "x", "", "");
        vm.expectRevert(abi.encodeWithSelector(AllocXMarketplace.Unsupported.selector, Support.InsufficientBalance));
        m.createListing(AssetType.ERC721, address(n), 7, 1, PRICE, "x", "", "");
        vm.stopPrank();
    }

    function test_erc1155_happyPath() public {
        MockERC1155 t = new MockERC1155();
        t.mint(seller, 3, 10);
        vm.prank(seller);
        t.setApprovalForAll(address(xfer), true);
        uint256 id = _list(AssetType.ERC1155, address(t), 3, 4);
        uint256 oid = _buy(id);
        vm.prank(seller);
        m.completeOrder(oid);
        assertEq(t.balanceOf(buyer, 3), 4);
        assertEq(t.balanceOf(seller, 3), 6);
    }

    function test_eoaAssetContractUnsupported() public {
        vm.prank(seller);
        vm.expectRevert(abi.encodeWithSelector(AllocXMarketplace.Unsupported.selector, Support.UnsupportedContract));
        m.createListing(AssetType.ERC20, other, 0, 1, PRICE, "x", "", "");
    }

    // ---------------------------------------------------------------- direct rights

    function test_ownable_happyPath_anyoneSettles() public {
        MockOwnable p = new MockOwnable(seller);
        uint256 id = _list(AssetType.OWNABLE, address(p), 0, 1);
        uint256 oid = _buy(id);

        vm.expectRevert(AllocXMarketplace.NotDelivered.selector);
        m.completeOrder(oid);

        vm.prank(seller);
        p.transferOwnership(buyer);

        vm.prank(other); // permissionless once delivered
        m.completeOrder(oid);
        assertEq(usdc.balanceOf(seller), PRICE);
        assertEq(p.owner(), buyer);
    }

    function test_ownable_refundBlockedOnceDelivered() public {
        MockOwnable p = new MockOwnable(seller);
        uint256 id = _list(AssetType.OWNABLE, address(p), 0, 1);
        uint256 oid = _buy(id);
        vm.prank(seller);
        p.transferOwnership(buyer);
        vm.prank(seller);
        vm.expectRevert(AllocXMarketplace.AlreadyDelivered.selector);
        m.refundOrder(oid);
        vm.warp(block.timestamp + 4 days);
        vm.prank(buyer);
        vm.expectRevert(AllocXMarketplace.AlreadyDelivered.selector);
        m.refundOrder(oid);
    }

    function test_ownable2Step_unsupported() public {
        MockOwnable2Step p = new MockOwnable2Step(seller);
        vm.prank(seller);
        vm.expectRevert(abi.encodeWithSelector(AllocXMarketplace.Unsupported.selector, Support.UnsupportedContract));
        m.createListing(AssetType.OWNABLE, address(p), 0, 1, PRICE, "x", "", "");
    }

    function test_ownable_notOwnerCannotList() public {
        MockOwnable p = new MockOwnable(other);
        vm.prank(seller);
        vm.expectRevert(abi.encodeWithSelector(AllocXMarketplace.Unsupported.selector, Support.NotHolder));
        m.createListing(AssetType.OWNABLE, address(p), 0, 1, PRICE, "x", "", "");
    }

    function test_ownable_cannotListTwice() public {
        MockOwnable p = new MockOwnable(seller);
        _list(AssetType.OWNABLE, address(p), 0, 1);
        vm.prank(seller);
        vm.expectRevert(abi.encodeWithSelector(AllocXMarketplace.Unsupported.selector, Support.InsufficientBalance));
        m.createListing(AssetType.OWNABLE, address(p), 0, 1, PRICE, "x", "", "");
    }

    function test_ownable_expiredWindowRefundsBuyer() public {
        MockOwnable p = new MockOwnable(seller);
        uint256 id = _list(AssetType.OWNABLE, address(p), 0, 1);
        uint256 oid = _buy(id);
        vm.prank(buyer);
        vm.expectRevert(AllocXMarketplace.RefundUnavailable.selector);
        m.refundOrder(oid);
        vm.warp(block.timestamp + 3 days + 1);
        vm.prank(buyer);
        m.refundOrder(oid);
        assertEq(usdc.balanceOf(buyer), 1_000e6);
        assertEq(uint8(m.getListing(id).status), uint8(AllocXMarketplace.ListingStatus.Active));
    }

    function test_accessControlAdmin_needsGrantAndRenounce() public {
        MockAdminControl p = new MockAdminControl(seller);
        uint256 id = _list(AssetType.ACCESS_CONTROL_ADMIN, address(p), 0, 1);
        uint256 oid = _buy(id);
        bytes32 admin = p.DEFAULT_ADMIN_ROLE();

        vm.prank(seller);
        p.grantRole(admin, buyer);
        // Seller still holds the role: not an exclusive handover yet.
        vm.expectRevert(AllocXMarketplace.NotDelivered.selector);
        m.completeOrder(oid);

        vm.prank(seller);
        p.renounceRole(admin, seller);
        m.completeOrder(oid);
        assertEq(usdc.balanceOf(seller), PRICE);
        assertTrue(p.hasRole(admin, buyer));
    }

    function test_directDelivery_settlesWhilePaused() public {
        MockOwnable p = new MockOwnable(seller);
        uint256 id = _list(AssetType.OWNABLE, address(p), 0, 1);
        uint256 oid = _buy(id);
        vm.prank(seller);
        p.transferOwnership(buyer);
        vm.prank(owner);
        m.pause();
        m.completeOrder(oid);
        assertEq(usdc.balanceOf(seller), PRICE);
    }

    // ---------------------------------------------------------------- refunds

    function test_refund_sellerCanDeclineAnytime() public {
        (, uint256 id) = _erc20Listing(1 ether);
        uint256 oid = _buy(id);
        vm.prank(seller);
        m.refundOrder(oid);
        assertEq(usdc.balanceOf(buyer), 1_000e6);
    }

    function test_refund_buyerOnlyAfterDeadline() public {
        (, uint256 id) = _erc20Listing(1 ether);
        uint256 oid = _buy(id);
        vm.prank(buyer);
        vm.expectRevert(AllocXMarketplace.RefundUnavailable.selector);
        m.refundOrder(oid);
        vm.warp(block.timestamp + 3 days + 1);
        vm.prank(buyer);
        m.refundOrder(oid);
        assertEq(usdc.balanceOf(buyer), 1_000e6);
    }

    function test_refund_anyoneWhenPaused() public {
        (, uint256 id) = _erc20Listing(1 ether);
        uint256 oid = _buy(id);
        vm.prank(owner);
        m.pause();
        vm.prank(other);
        m.refundOrder(oid);
        assertEq(usdc.balanceOf(buyer), 1_000e6);
    }

    function test_refund_paysOriginalBuyerNotCaller() public {
        (, uint256 id) = _erc20Listing(1 ether);
        uint256 oid = _buy(id);
        vm.warp(block.timestamp + 3 days + 1);
        vm.prank(other);
        m.refundOrder(oid);
        assertEq(usdc.balanceOf(other), 0);
        assertEq(usdc.balanceOf(buyer), 1_000e6);
    }

    function test_refund_cannotSettleTwice() public {
        (, uint256 id) = _erc20Listing(1 ether);
        uint256 oid = _buy(id);
        vm.prank(seller);
        m.refundOrder(oid);
        vm.prank(seller);
        vm.expectRevert(AllocXMarketplace.InvalidOrderStatus.selector);
        m.refundOrder(oid);
        vm.prank(seller);
        vm.expectRevert(AllocXMarketplace.InvalidOrderStatus.selector);
        m.completeOrder(oid);
    }

    function test_refund_afterDeadlineSellerCanStillComplete() public {
        (MockERC20 t, uint256 id) = _erc20Listing(1 ether);
        uint256 oid = _buy(id);
        vm.warp(block.timestamp + 10 days);
        vm.prank(seller);
        m.completeOrder(oid);
        assertEq(t.balanceOf(buyer), 1 ether);
    }

    // ---------------------------------------------------------------- listing lifecycle

    function test_cancelListing_releasesCommitment() public {
        (MockERC20 t, uint256 id) = _erc20Listing(100 ether);
        vm.prank(other);
        vm.expectRevert(AllocXMarketplace.Unauthorized.selector);
        m.cancelListing(id);
        vm.prank(seller);
        m.cancelListing(id);
        assertEq(m.committedAmount(seller, AssetType.ERC20, address(t), 0), 0);
        vm.prank(buyer);
        vm.expectRevert(AllocXMarketplace.InvalidListingStatus.selector);
        m.buy(id);
    }

    function test_cancelListing_notWhilePending() public {
        (, uint256 id) = _erc20Listing(1 ether);
        _buy(id);
        vm.prank(seller);
        vm.expectRevert(AllocXMarketplace.InvalidListingStatus.selector);
        m.cancelListing(id);
    }

    function test_buy_selfPurchaseAndDoubleBuyRejected() public {
        (, uint256 id) = _erc20Listing(1 ether);
        usdc.mint(seller, PRICE);
        vm.startPrank(seller);
        usdc.approve(address(escrow), PRICE);
        vm.expectRevert(AllocXMarketplace.SelfPurchase.selector);
        m.buy(id);
        vm.stopPrank();
        _buy(id);
        vm.prank(buyer);
        vm.expectRevert(AllocXMarketplace.InvalidListingStatus.selector);
        m.buy(id);
    }

    function test_buy_requiresUsdcAllowance() public {
        (, uint256 id) = _erc20Listing(1 ether);
        vm.prank(buyer);
        usdc.approve(address(escrow), PRICE - 1);
        vm.prank(buyer);
        vm.expectRevert();
        m.buy(id);
    }

    function test_createListing_validation() public {
        MockOwnable p = new MockOwnable(seller);
        vm.startPrank(seller);
        vm.expectRevert(AllocXMarketplace.InvalidName.selector);
        m.createListing(AssetType.OWNABLE, address(p), 0, 1, PRICE, "", "", "");
        vm.expectRevert(AllocXMarketplace.InvalidName.selector);
        m.createListing(AssetType.OWNABLE, address(p), 0, 1, PRICE, new string(81), "", "");
        vm.expectRevert(AllocXMarketplace.InvalidDescription.selector);
        m.createListing(AssetType.OWNABLE, address(p), 0, 1, PRICE, "n", new string(501), "");
        vm.expectRevert(AllocXMarketplace.InvalidImageUri.selector);
        m.createListing(AssetType.OWNABLE, address(p), 0, 1, PRICE, "n", "", new string(257));
        vm.expectRevert(AllocXMarketplace.InvalidPrice.selector);
        m.createListing(AssetType.OWNABLE, address(p), 0, 1, 0, "n", "", "");
        vm.stopPrank();
    }

    function test_views_pagingAndInvalidIds() public {
        (, uint256 a) = _erc20Listing(1 ether);
        (, uint256 b) = _erc20Listing(1 ether);
        assertEq(m.listingCount(), 2);
        assertEq(m.getListings(1, 10).length, 2);
        assertEq(m.getListings(2, 10).length, 1);
        assertEq(m.getListings(0, 10).length, 0);
        assertEq(m.getListings(3, 10).length, 0);
        assertEq(m.getListing(b).id, b);
        assertEq(m.getListing(a).id, a);
        vm.expectRevert(AllocXMarketplace.InvalidListing.selector);
        m.getListing(0);
        vm.expectRevert(AllocXMarketplace.InvalidListing.selector);
        m.getListing(3);
        vm.expectRevert(AllocXMarketplace.InvalidOrder.selector);
        m.getOrder(1);
    }

    // ---------------------------------------------------------------- pause & admin

    function test_pause_blocksListBuyAndTokenCompletion() public {
        (, uint256 id) = _erc20Listing(10 ether);
        uint256 oid = _buy(id);
        (, uint256 id2) = _erc20Listing(10 ether);
        vm.prank(owner);
        m.pause();

        MockOwnable p = new MockOwnable(seller);
        vm.prank(seller);
        vm.expectRevert();
        m.createListing(AssetType.OWNABLE, address(p), 0, 1, PRICE, "x", "", "");
        vm.prank(buyer);
        vm.expectRevert();
        m.buy(id2);
        vm.prank(seller);
        vm.expectRevert();
        m.completeOrder(oid);
        // Cancel stays open while paused.
        vm.prank(seller);
        m.cancelListing(id2);
    }

    function test_admin_onlyOwner_andDeliveryWindowBounds() public {
        vm.prank(other);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, other));
        m.pause();
        vm.prank(other);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, other));
        m.setDeliveryWindow(2 days);

        vm.startPrank(owner);
        vm.expectRevert(AllocXMarketplace.InvalidDeliveryWindow.selector);
        m.setDeliveryWindow(1 hours - 1);
        vm.expectRevert(AllocXMarketplace.InvalidDeliveryWindow.selector);
        m.setDeliveryWindow(30 days + 1);
        m.setDeliveryWindow(1 hours);
        vm.stopPrank();
        assertEq(m.deliveryWindow(), 1 hours);
    }

    function test_deliveryWindow_changeDoesNotAffectOpenOrders() public {
        (, uint256 id) = _erc20Listing(1 ether);
        uint256 oid = _buy(id);
        uint64 deadline = m.getOrder(oid).deadline;
        vm.prank(owner);
        m.setDeliveryWindow(1 hours);
        assertEq(m.getOrder(oid).deadline, deadline);
    }

    function test_ownership_twoStepAndRenounceDisabled() public {
        vm.prank(owner);
        vm.expectRevert(AllocXMarketplace.RenounceDisabled.selector);
        m.renounceOwnership();
        vm.prank(owner);
        m.transferOwnership(other);
        assertEq(m.owner(), owner);
        vm.prank(other);
        m.acceptOwnership();
        assertEq(m.owner(), other);
    }

    function test_ownerCannotTouchEscrowFunds() public {
        (, uint256 id) = _erc20Listing(1 ether);
        uint256 oid = _buy(id);
        vm.startPrank(owner);
        vm.expectRevert(AllocXEscrow.Unauthorized.selector);
        escrow.refund(oid);
        vm.expectRevert(AllocXEscrow.Unauthorized.selector);
        escrow.release(oid, owner);
        vm.expectRevert(AllocXEscrow.Unauthorized.selector);
        escrow.deposit(99, owner, 1);
        vm.stopPrank();
    }

    function test_transferModule_onlyMarketplaceCanExecute() public {
        MockERC20 t = new MockERC20();
        vm.prank(other);
        vm.expectRevert(AllocXTransfer.Unauthorized.selector);
        xfer.executeDelivery(AssetType.ERC20, address(t), seller, buyer, 0, 1);
    }

    // ---------------------------------------------------------------- blocklist / claims

    function test_blockedSeller_paymentBecomesClaim() public {
        (, uint256 id) = _erc20Listing(1 ether);
        uint256 oid = _buy(id);
        usdc.setBlocked(seller, true);

        vm.prank(seller);
        m.completeOrder(oid);

        assertEq(uint8(m.getOrder(oid).status), uint8(AllocXMarketplace.OrderStatus.Completed));
        (address recipient, uint256 amount) = escrow.claims(oid);
        assertEq(recipient, seller);
        assertEq(amount, PRICE);
        assertEq(escrow.totalHeld(), PRICE);
        assertEq(usdc.balanceOf(address(escrow)), PRICE);

        vm.prank(other);
        vm.expectRevert(AllocXEscrow.Unauthorized.selector);
        escrow.claim(oid);

        vm.prank(seller);
        vm.expectRevert(); // still blocked: claim is preserved
        escrow.claim(oid);
        (, amount) = escrow.claims(oid);
        assertEq(amount, PRICE);

        usdc.setBlocked(seller, false);
        vm.prank(seller);
        escrow.claim(oid);
        assertEq(usdc.balanceOf(seller), PRICE);
        assertEq(escrow.totalHeld(), 0);

        vm.prank(seller);
        vm.expectRevert(AllocXEscrow.Unauthorized.selector); // claim deleted
        escrow.claim(oid);
    }

    /// @dev A blocklisted buyer cannot receive the refund, but the order still settles and the listing
    /// reopens; the refund is held as a claim for the buyer.
    function test_blockedBuyer_refundBecomesClaim() public {
        (, uint256 id) = _erc20Listing(1 ether);
        uint256 oid = _buy(id);
        usdc.setBlocked(buyer, true);

        vm.prank(seller);
        m.refundOrder(oid);

        assertEq(uint8(m.getOrder(oid).status), uint8(AllocXMarketplace.OrderStatus.Refunded));
        assertEq(uint8(m.getListing(id).status), uint8(AllocXMarketplace.ListingStatus.Active));
        (address recipient, uint256 amount) = escrow.claims(oid);
        assertEq(recipient, buyer);
        assertEq(amount, PRICE);
        assertEq(escrow.totalHeld(), PRICE);
        assertEq(usdc.balanceOf(address(escrow)), PRICE);

        vm.prank(seller); // the seller cannot take the buyer's refund
        vm.expectRevert(AllocXEscrow.Unauthorized.selector);
        escrow.claim(oid);
        vm.prank(buyer);
        vm.expectRevert(); // still blocked: claim preserved
        escrow.claim(oid);

        usdc.setBlocked(buyer, false);
        vm.prank(buyer);
        escrow.claim(oid);
        assertEq(usdc.balanceOf(buyer), 1_000e6);
        assertEq(escrow.totalHeld(), 0);
        assertEq(usdc.balanceOf(address(escrow)), 0);
    }

    function test_blockedBuyer_completeFailureStillRefundsViaClaim() public {
        (MockERC20 t, uint256 id) = _erc20Listing(1 ether);
        uint256 oid = _buy(id);
        vm.prank(seller);
        t.approve(address(xfer), 0);
        usdc.setBlocked(buyer, true);
        vm.prank(seller);
        m.completeOrder(oid); // delivery fails -> refund path -> claim, no revert
        assertEq(uint8(m.getOrder(oid).status), uint8(AllocXMarketplace.OrderStatus.Refunded));
        (address recipient,) = escrow.claims(oid);
        assertEq(recipient, buyer);
    }

    function test_blockedBuyer_directOrderExpiryRefundsViaClaim() public {
        MockOwnable p = new MockOwnable(seller);
        uint256 id = _list(AssetType.OWNABLE, address(p), 0, 1);
        uint256 oid = _buy(id);
        usdc.setBlocked(buyer, true);
        vm.warp(block.timestamp + 3 days + 1);
        m.refundOrder(oid);
        (address recipient, uint256 amount) = escrow.claims(oid);
        assertEq(recipient, buyer);
        assertEq(amount, PRICE);
    }

    // ---------------------------------------------------------------- invariants (fuzz)

    function testFuzz_escrowNeverOverdraws(uint96 price, uint8 path) public {
        price = uint96(bound(price, 1, 500e6));
        MockERC20 t = new MockERC20();
        t.mint(seller, 10 ether);
        vm.startPrank(seller);
        t.approve(address(xfer), type(uint256).max);
        uint256 id = m.createListing(AssetType.ERC20, address(t), 0, 10 ether, price, "f", "", "");
        vm.stopPrank();
        uint256 oid = _buy(id);
        assertEq(usdc.balanceOf(address(escrow)), price);

        if (path % 3 == 0) {
            vm.prank(seller);
            m.completeOrder(oid);
            assertEq(usdc.balanceOf(seller), price);
        } else if (path % 3 == 1) {
            vm.prank(seller);
            m.refundOrder(oid);
            assertEq(usdc.balanceOf(buyer), 1_000e6);
        } else {
            vm.warp(block.timestamp + 3 days + 1);
            m.refundOrder(oid);
            assertEq(usdc.balanceOf(buyer), 1_000e6);
        }
        assertEq(usdc.balanceOf(address(escrow)), 0);
        assertEq(escrow.totalHeld(), 0);
    }
}
