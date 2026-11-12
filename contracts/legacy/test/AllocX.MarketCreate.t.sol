// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./AllocX.Base.t.sol";

/// @dev Marketplace.createListing: validation, events, duplicate prevention.
contract AllocXMarketCreateTest is AllocXTestBase {
    function _create(Item[] memory items) internal returns (uint256) {
        return _create(items, false);
    }

    function _create(Item[] memory items, bool auto_) internal returns (uint256 id) {
        vm.prank(seller);
        id = marketplace.createListing(
            projectId, items, PRICE, uint64(block.timestamp + 7 days), WINDOW, auto_, bytes32("lm")
        );
    }

    function _expectCreateRevert(bytes memory err, Item[] memory items) internal {
        vm.prank(seller);
        vm.expectRevert(err);
        marketplace.createListing(projectId, items, PRICE, uint64(block.timestamp + 7 days), WINDOW, false, 0);
    }

    // ----------------------------------------------------------- happy paths
    function test_Create_StoresListingAndEmitsEvents() public {
        Item[] memory items = _arr2(_i721(1), _i1155(1, 5));
        bytes32 expectedHash = keccak256(abi.encode(items));
        uint64 expiry = uint64(block.timestamp + 7 days);

        vm.expectEmit(true, true, true, true, address(marketplace));
        emit AllocXMarketplace.ListingCreated(1, projectId, seller, PRICE, expiry, expectedHash, false, WINDOW, bytes32("lm"));
        vm.expectEmit(true, false, false, true, address(marketplace));
        emit AllocXMarketplace.ListingItem(1, 0, AssetKind.ERC721, address(nft), 1, 1, address(0), bytes32(0));
        vm.expectEmit(true, false, false, true, address(marketplace));
        emit AllocXMarketplace.ListingItem(1, 1, AssetKind.ERC1155, address(multi), 1, 5, address(0), bytes32(0));
        uint256 id = _create(items);

        assertEq(id, 1);
        assertEq(marketplace.listingCount(), 1);
        Listing memory l = marketplace.getListing(id);
        assertEq(l.projectId, projectId);
        assertEq(l.seller, seller);
        assertEq(l.price, PRICE);
        assertEq(l.expiry, expiry);
        assertEq(l.settlementWindow, WINDOW);
        assertFalse(l.autoSettle);
        assertEq(uint8(l.status), uint8(ListingStatus.Active));
        assertEq(l.itemsHash, expectedHash);
        assertEq(marketplace.hashItems(items), expectedHash);
        assertEq(l.metadataHash, bytes32("lm"));
        assertEq(l.orderId, 0);
        Item[] memory stored = marketplace.getItems(id);
        assertEq(stored.length, 2);
        assertEq(stored[1].amount, 5);
        assertTrue(marketplace.isLive(id));
    }

    function test_Create_IdsAreSequentialFromOne() public {
        assertEq(_create(_arr1(_i721(1))), 1);
        assertEq(_create(_arr1(_i721(2))), 2);
        assertEq(marketplace.listingCount(), 2);
    }

    function test_Create_AutoSettleNeedsApprovalsAsyncDoesNot() public {
        Item[] memory items = _arr1(_i20(10e18));
        vm.prank(seller);
        vm.expectRevert(abi.encodeWithSelector(AllocXMarketplace.NotController.selector, 0));
        marketplace.createListing(projectId, items, PRICE, uint64(block.timestamp + 1 days), WINDOW, true, 0);
        assertGt(_create(items, false), 0);
        _approveTokens();
        // first listing holds the key; use a different item for the autoSettle one
        assertGt(_create(_arr1(_i721(4)), true), 0);
    }

    function test_Create_AllKindsInOneAsyncBundle() public {
        Item[] memory items = new Item[](7);
        items[0] = _i20(1e18);
        items[1] = _i721(1);
        items[2] = _i1155(1, 1);
        items[3] = _iOwn();
        items[4] = _iOwn2();
        items[5] = _iRole();
        items[6] = _iAdapter();
        uint256 id = _create(items);
        assertEq(marketplace.getItems(id).length, 7);
    }

    function test_Create_BoundaryValuesAccepted() public {
        Item[] memory items = _arr1(_i721(1));
        vm.prank(seller);
        marketplace.createListing(projectId, items, 1e6, uint64(block.timestamp + 365 days), 1 hours, false, 0);
        items = _arr1(_i721(2));
        vm.prank(seller);
        marketplace.createListing(projectId, items, 1e6, uint64(block.timestamp + 1), 30 days, false, 0);
        // ten items
        Item[] memory ten = new Item[](10);
        for (uint256 i; i < 10; ++i) {
            ten[i] = _i1155(i + 10, 1);
            multi.mint(seller, i + 10, 1);
        }
        assertGt(_create(ten), 0);
    }

    // ---------------------------------------------------------------- reverts
    function test_Create_RevertsForInactiveOrUnknownProject() public {
        Item[] memory items = _arr1(_i721(1));
        vm.prank(admin);
        registry.suspendProject(projectId);
        _expectCreateRevert(abi.encodeWithSelector(AllocXMarketplace.ProjectNotActive.selector), items);
        vm.prank(seller);
        vm.expectRevert(AllocXMarketplace.ProjectNotActive.selector);
        marketplace.createListing(999, items, PRICE, uint64(block.timestamp + 1 days), WINDOW, false, 0);
    }

    function test_Create_RevertsForPendingProject() public {
        MockOwnable m = new MockOwnable(seller);
        vm.prank(seller);
        uint256 pid = registry.submitProject(ProjectCategory.SmartContract, address(m), seller, new address[](0), 0, "");
        Item[] memory items = _arr1(Item(AssetKind.OWNABLE, address(m), 0, 0, address(0), bytes32(0)));
        vm.prank(seller);
        vm.expectRevert(AllocXMarketplace.ProjectNotActive.selector);
        marketplace.createListing(pid, items, PRICE, uint64(block.timestamp + 1 days), WINDOW, false, 0);
    }

    function test_Create_RevertsOnItemCount() public {
        vm.prank(seller);
        vm.expectRevert(AllocXMarketplace.InvalidItems.selector);
        marketplace.createListing(projectId, new Item[](0), PRICE, uint64(block.timestamp + 1 days), WINDOW, false, 0);
        Item[] memory eleven = new Item[](11);
        for (uint256 i; i < 11; ++i) {
            eleven[i] = _i1155(i + 10, 1);
        }
        vm.prank(seller);
        vm.expectRevert(AllocXMarketplace.InvalidItems.selector);
        marketplace.createListing(projectId, eleven, PRICE, uint64(block.timestamp + 1 days), WINDOW, false, 0);
    }

    function test_Create_RevertsOnBadTerms() public {
        Item[] memory items = _arr1(_i721(1));
        vm.startPrank(seller);
        uint64 ok = uint64(block.timestamp + 1 days);
        vm.expectRevert(AllocXMarketplace.InvalidPrice.selector);
        marketplace.createListing(projectId, items, 1e6 - 1, ok, WINDOW, false, 0);
        vm.expectRevert(AllocXMarketplace.InvalidExpiry.selector);
        marketplace.createListing(projectId, items, PRICE, uint64(block.timestamp), WINDOW, false, 0);
        vm.expectRevert(AllocXMarketplace.InvalidExpiry.selector);
        marketplace.createListing(projectId, items, PRICE, uint64(block.timestamp - 1), WINDOW, false, 0);
        vm.expectRevert(AllocXMarketplace.InvalidExpiry.selector);
        marketplace.createListing(projectId, items, PRICE, uint64(block.timestamp + 365 days + 1), WINDOW, false, 0);
        vm.expectRevert(AllocXMarketplace.InvalidSettlementWindow.selector);
        marketplace.createListing(projectId, items, PRICE, ok, 1 hours - 1, false, 0);
        vm.expectRevert(AllocXMarketplace.InvalidSettlementWindow.selector);
        marketplace.createListing(projectId, items, PRICE, ok, 30 days + 1, false, 0);
        vm.stopPrank();
    }

    function test_Create_RevertsWhenPaused() public {
        vm.prank(admin);
        marketplace.pause();
        vm.prank(seller);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        marketplace.createListing(
            projectId, _arr1(_i721(1)), PRICE, uint64(block.timestamp + 1 days), WINDOW, false, 0
        );
    }

    function test_Create_RevertsWhenItemNotLinkedToProject() public {
        MockERC721 foreign = new MockERC721();
        foreign.mint(seller, 1);
        Item memory it = Item(AssetKind.ERC721, address(foreign), 1, 1, address(0), bytes32(0));
        _expectCreateRevert(abi.encodeWithSelector(AllocXMarketplace.InvalidItem.selector, 0), _arr1(it));
        // a contract linked to a DIFFERENT project is also rejected
        MockOwnable m = new MockOwnable(seller);
        vm.prank(seller);
        uint256 pid2 = registry.submitProject(ProjectCategory.SmartContract, address(m), seller, new address[](0), 0, "");
        vm.prank(admin);
        registry.activateProject(pid2);
        Item memory other = Item(AssetKind.OWNABLE, address(m), 0, 0, address(0), bytes32(0));
        _expectCreateRevert(abi.encodeWithSelector(AllocXMarketplace.InvalidItem.selector, 1), _arr2(_i721(1), other));
    }

    function test_Create_RevertsOnEoaTarget() public {
        Item memory it = Item(AssetKind.ERC20, seller, 0, 1, address(0), bytes32(0));
        _expectCreateRevert(abi.encodeWithSelector(AllocXMarketplace.InvalidItem.selector, 0), _arr1(it));
    }

    function test_Create_RevertsOnMalformedTokenItems() public {
        Item memory it = _i20(0);
        _expectCreateRevert(abi.encodeWithSelector(AllocXMarketplace.InvalidItem.selector, 0), _arr1(it));
        it = _i20(1);
        it.id = 5;
        _expectCreateRevert(abi.encodeWithSelector(AllocXMarketplace.InvalidItem.selector, 0), _arr1(it));
        it = _i721(1);
        it.amount = 2;
        _expectCreateRevert(abi.encodeWithSelector(AllocXMarketplace.InvalidItem.selector, 0), _arr1(it));
        it = _i721(1);
        it.amount = 0;
        _expectCreateRevert(abi.encodeWithSelector(AllocXMarketplace.InvalidItem.selector, 0), _arr1(it));
        it = _i1155(1, 0);
        _expectCreateRevert(abi.encodeWithSelector(AllocXMarketplace.InvalidItem.selector, 0), _arr1(it));
    }

    function test_Create_RevertsOnStrayAdapterOrExtraOnNonAdapterItems() public {
        Item memory it = _i721(1);
        it.adapter = address(adapter);
        _expectCreateRevert(abi.encodeWithSelector(AllocXMarketplace.InvalidItem.selector, 0), _arr1(it));
        it = _iOwn();
        it.extra = bytes32(uint256(1));
        _expectCreateRevert(abi.encodeWithSelector(AllocXMarketplace.InvalidItem.selector, 0), _arr1(it));
    }

    function test_Create_RevertsOnMalformedControlItems() public {
        Item memory it = _iOwn();
        it.amount = 1;
        _expectCreateRevert(abi.encodeWithSelector(AllocXMarketplace.InvalidItem.selector, 0), _arr1(it));
        it = _iOwn();
        it.id = 1;
        _expectCreateRevert(abi.encodeWithSelector(AllocXMarketplace.InvalidItem.selector, 0), _arr1(it));
        it = _iOwn2();
        it.id = 1;
        _expectCreateRevert(abi.encodeWithSelector(AllocXMarketplace.InvalidItem.selector, 0), _arr1(it));
        it = _iAdapter();
        it.adapter = address(0);
        _expectCreateRevert(abi.encodeWithSelector(AllocXMarketplace.InvalidItem.selector, 0), _arr1(it));
        it = _iRole();
        it.amount = 3;
        _expectCreateRevert(abi.encodeWithSelector(AllocXMarketplace.InvalidItem.selector, 0), _arr1(it));
    }

    function test_Create_AutoSettleRejectsAnyControlItem() public {
        _approveTokens();
        vm.prank(seller);
        vm.expectRevert(abi.encodeWithSelector(AllocXMarketplace.InvalidItem.selector, 1));
        marketplace.createListing(
            projectId, _arr2(_i721(1), _iOwn()), PRICE, uint64(block.timestamp + 1 days), WINDOW, true, 0
        );
    }

    function test_Create_RevertsWhenSellerDoesNotControl() public {
        // buyer does not own NFT 1, does not own the ownable, and has no tokens
        Item[] memory roleItems = _arr1(_iRole());
        vm.startPrank(buyer);
        uint64 exp = uint64(block.timestamp + 1 days);
        vm.expectRevert(abi.encodeWithSelector(AllocXMarketplace.NotController.selector, 0));
        marketplace.createListing(projectId, _arr1(_i721(1)), PRICE, exp, WINDOW, false, 0);
        vm.expectRevert(abi.encodeWithSelector(AllocXMarketplace.NotController.selector, 0));
        marketplace.createListing(projectId, _arr1(_iOwn()), PRICE, exp, WINDOW, false, 0);
        vm.expectRevert(abi.encodeWithSelector(AllocXMarketplace.NotController.selector, 0));
        marketplace.createListing(projectId, roleItems, PRICE, exp, WINDOW, false, 0);
        vm.expectRevert(abi.encodeWithSelector(AllocXMarketplace.NotController.selector, 0));
        marketplace.createListing(projectId, _arr1(_iAdapter()), PRICE, exp, WINDOW, false, 0);
        vm.expectRevert(abi.encodeWithSelector(AllocXMarketplace.NotController.selector, 0));
        marketplace.createListing(projectId, _arr1(_i20(1)), PRICE, exp, WINDOW, false, 0);
        vm.stopPrank();
        // quantity beyond balance
        _expectCreateRevert(abi.encodeWithSelector(AllocXMarketplace.NotController.selector, 0), _arr1(_i1155(1, 1_001)));
        // index of the offending item is reported
        _expectCreateRevert(abi.encodeWithSelector(AllocXMarketplace.NotController.selector, 1), _arr2(_i721(1), _i721(999)));
    }

    function test_Create_RevertsForUnapprovedAdapter() public {
        vm.prank(admin);
        adapterRegistry.revokeAdapter(address(adapter), address(adapterTarget));
        _expectCreateRevert(abi.encodeWithSelector(AllocXMarketplace.NotController.selector, 0), _arr1(_iAdapter()));
    }

    // ------------------------------------------------------------ duplicates
    function test_Duplicate_SameTokenItemWhileActive() public {
        _create(_arr1(_i721(1)));
        _expectCreateRevert(abi.encodeWithSelector(AllocXMarketplace.DuplicateListing.selector), _arr1(_i721(1)));
        // a bundle containing it is also rejected
        _expectCreateRevert(abi.encodeWithSelector(AllocXMarketplace.DuplicateListing.selector), _arr2(_i721(2), _i721(1)));
    }

    function test_Duplicate_Erc20KeyIgnoresAmount() public {
        _create(_arr1(_i20(1e18)));
        _expectCreateRevert(abi.encodeWithSelector(AllocXMarketplace.DuplicateListing.selector), _arr1(_i20(2e18)));
    }

    function test_Duplicate_DifferentTokenIdsAreIndependent() public {
        _create(_arr1(_i1155(1, 10)));
        assertGt(_create(_arr1(_i1155(2, 10))), 0);
    }

    function test_Duplicate_ReleasedByCancelAndExpiry() public {
        uint256 a = _create(_arr1(_i721(1)));
        vm.prank(seller);
        marketplace.cancelListing(a);
        uint256 b = _create(_arr1(_i721(1)));
        assertGt(b, a);
        vm.warp(block.timestamp + 7 days); // b expires
        assertGt(_create(_arr1(_i721(1))), b);
    }

    function test_Duplicate_ReservedListingBlocksRelisting() public {
        uint256 a = _create(_arr1(_i721(1)));
        _buy(a);
        _expectCreateRevert(abi.encodeWithSelector(AllocXMarketplace.DuplicateListing.selector), _arr1(_i721(1)));
    }

    function test_Duplicate_RepeatedItemInsideOneListing() public {
        _expectCreateRevert(abi.encodeWithSelector(AllocXMarketplace.DuplicateListing.selector), _arr2(_i721(1), _i721(1)));
        _expectCreateRevert(abi.encodeWithSelector(AllocXMarketplace.DuplicateListing.selector), _arr2(_iOwn(), _iOwn()));
        _expectCreateRevert(abi.encodeWithSelector(AllocXMarketplace.DuplicateListing.selector), _arr2(_i20(1), _i20(2)));
    }

    function test_Duplicate_OwnableVsOwnable2StepOnSameTarget() public {
        // The same ownership right must never sit in two live listings, whichever kind label is used.
        Item memory asTwoStep = _iOwn2();
        Item memory asOwnable = Item(AssetKind.OWNABLE, address(ownable2), 0, 0, address(0), bytes32(0));
        uint256 a = _create(_arr1(asTwoStep));
        _expectCreateRevert(abi.encodeWithSelector(AllocXMarketplace.DuplicateListing.selector), _arr1(asOwnable));
        vm.prank(seller);
        marketplace.cancelListing(a);
        // reverse order
        _create(_arr1(asOwnable));
        _expectCreateRevert(abi.encodeWithSelector(AllocXMarketplace.DuplicateListing.selector), _arr1(asTwoStep));
    }

    function test_Duplicate_OwnableVsOwnable2StepInsideOneListing() public {
        Item memory asTwoStep = _iOwn2();
        Item memory asOwnable = Item(AssetKind.OWNABLE, address(ownable2), 0, 0, address(0), bytes32(0));
        _expectCreateRevert(abi.encodeWithSelector(AllocXMarketplace.DuplicateListing.selector), _arr2(asOwnable, asTwoStep));
    }

    function test_Duplicate_ControlRightIsKeyedWithoutSeller() public {
        uint256 a = _create(_arr1(_iOwn()));
        // seller hands ownership to buyer outside the marketplace; the old listing is stale but still "live" by status
        vm.prank(seller);
        ownable.transferOwnership(buyer);
        Item[] memory items = _arr1(_iOwn());
        vm.prank(buyer);
        vm.expectRevert(AllocXMarketplace.DuplicateListing.selector);
        marketplace.createListing(projectId, items, PRICE, uint64(block.timestamp + 1 days), WINDOW, false, 0);
        // anyone cleans up the stale listing, which frees the key
        marketplace.cancelStale(a);
        vm.prank(buyer);
        marketplace.createListing(projectId, items, PRICE, uint64(block.timestamp + 1 days), WINDOW, false, 0);
    }

    function test_Duplicate_TokenKeysAreSellerScoped() public {
        _create(_arr1(_i1155(1, 10)));
        multi.mint(buyer, 1, 50);
        vm.prank(buyer);
        uint256 id = marketplace.createListing(
            projectId, _arr1(_i1155(1, 10)), PRICE, uint64(block.timestamp + 1 days), WINDOW, false, 0
        );
        assertEq(marketplace.getListing(id).seller, buyer);
    }
}
