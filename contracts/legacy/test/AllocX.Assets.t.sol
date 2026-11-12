// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./AllocX.Base.t.sol";

/// @dev Unit tests for AllocXAssetManager (token kinds) and AllocXOwnershipManager (control kinds).
contract AllocXAssetsTest is AllocXTestBase {
    address internal other = makeAddr("other");

    function setUp() public override {
        super.setUp();
        vm.prank(admin);
        assetManager.grantRole(SETTLEMENT_ROLE, address(this));
    }

    function _am(Item memory it, address who, bool approval) internal view returns (bool) {
        return assetManager.controls(it, who, approval);
    }

    // ----------------------------------------------------- AssetManager.controls
    function test_Controls_Erc20BalanceAndAllowance() public {
        Item memory it = _i20(100e18);
        assertTrue(_am(it, seller, false));
        assertFalse(_am(it, seller, true), "no allowance yet");
        vm.prank(seller);
        token20.approve(address(assetManager), 99e18);
        assertFalse(_am(it, seller, true), "allowance below amount");
        vm.prank(seller);
        token20.approve(address(assetManager), 100e18);
        assertTrue(_am(it, seller, true));
        assertFalse(_am(_i20(2_000_000e18), seller, false), "balance below amount");
        assertFalse(_am(it, stranger, false));
    }

    function test_Controls_Erc721OwnerAndApprovals() public {
        Item memory it = _i721(1);
        assertTrue(_am(it, seller, false));
        assertFalse(_am(it, seller, true));
        vm.prank(seller);
        nft.approve(address(assetManager), 1);
        assertTrue(_am(it, seller, true), "single-token approval");
        assertFalse(_am(_i721(2), seller, true), "approval is per token");
        vm.prank(seller);
        nft.setApprovalForAll(address(assetManager), true);
        assertTrue(_am(_i721(2), seller, true), "operator approval");
        assertFalse(_am(it, stranger, false));
        assertFalse(_am(_i721(999), seller, false), "nonexistent token");
    }

    function test_Controls_Erc1155BalanceAndApproval() public {
        Item memory it = _i1155(1, 500);
        assertTrue(_am(it, seller, false));
        assertFalse(_am(it, seller, true));
        vm.prank(seller);
        multi.setApprovalForAll(address(assetManager), true);
        assertTrue(_am(it, seller, true));
        assertFalse(_am(_i1155(1, 1_001), seller, false));
        assertFalse(_am(_i1155(3, 1), seller, false));
    }

    function test_Controls_MalformedItemsAreFalse() public view {
        Item memory it = _i20(0);
        assertFalse(_am(it, seller, false));
        it = _i721(1);
        it.amount = 2;
        assertFalse(_am(it, seller, false));
        assertFalse(_am(_i1155(1, 0), seller, false));
        assertFalse(_am(_i20(1), address(0), false));
        it = _i20(1);
        it.target = stranger; // EOA
        assertFalse(_am(it, seller, false));
    }

    function test_Controls_ControlKindsAreNotTokenKinds() public view {
        assertFalse(_am(_iOwn(), seller, false));
        assertFalse(_am(_iOwn2(), seller, false));
        assertFalse(_am(_iRole(), seller, false));
        assertFalse(_am(_iAdapter(), seller, false));
    }

    // ---------------------------------------------------------- AssetManager.pull
    function test_Pull_Erc20() public {
        _approveTokens();
        vm.expectEmit(true, true, true, true, address(assetManager));
        emit AllocXAssetManager.AssetPulled(address(token20), seller, buyer, AssetKind.ERC20, 0, 5e18);
        assetManager.pull(_i20(5e18), seller, buyer);
        assertEq(token20.balanceOf(buyer), 5e18);
    }

    function test_Pull_Erc721() public {
        _approveTokens();
        assetManager.pull(_i721(3), seller, buyer);
        assertEq(nft.ownerOf(3), buyer);
    }

    function test_Pull_Erc1155() public {
        _approveTokens();
        assetManager.pull(_i1155(2, 40), seller, buyer);
        assertEq(multi.balanceOf(buyer, 2), 40);
        assertEq(multi.balanceOf(seller, 2), 960);
    }

    function test_Pull_OnlySettlementRole() public {
        _approveTokens();
        vm.prank(stranger);
        vm.expectRevert(_unauth(stranger, SETTLEMENT_ROLE));
        assetManager.pull(_i20(1), seller, buyer);
        vm.prank(admin);
        vm.expectRevert(_unauth(admin, SETTLEMENT_ROLE));
        assetManager.pull(_i20(1), seller, buyer);
    }

    function test_Pull_RevertsWithoutApproval() public {
        vm.expectRevert();
        assetManager.pull(_i20(1e18), seller, buyer);
        vm.expectRevert();
        assetManager.pull(_i721(1), seller, buyer);
        vm.expectRevert();
        assetManager.pull(_i1155(1, 1), seller, buyer);
    }

    function test_Pull_RevertsOnZeroAddressesBadKindsAndAmounts() public {
        _approveTokens();
        vm.expectRevert(AllocXAssetManager.ZeroAddress.selector);
        assetManager.pull(_i20(1), address(0), buyer);
        vm.expectRevert(AllocXAssetManager.ZeroAddress.selector);
        assetManager.pull(_i20(1), seller, address(0));
        vm.expectRevert(AllocXAssetManager.UnsupportedKind.selector);
        assetManager.pull(_iOwn(), seller, buyer);
        vm.expectRevert(AllocXAssetManager.UnsupportedKind.selector);
        assetManager.pull(_iAdapter(), seller, buyer);
        vm.expectRevert(AllocXAssetManager.InvalidAmount.selector);
        assetManager.pull(_i20(0), seller, buyer);
        vm.expectRevert(AllocXAssetManager.InvalidAmount.selector);
        assetManager.pull(_i1155(1, 0), seller, buyer);
        Item memory bad = _i721(1);
        bad.amount = 2;
        vm.expectRevert(AllocXAssetManager.InvalidAmount.selector);
        assetManager.pull(bad, seller, buyer);
    }

    function test_Pull_RejectsFeeOnTransferToken() public {
        FeeOnTransferERC20 taxed = new FeeOnTransferERC20();
        taxed.mint(seller, 1_000e18);
        vm.prank(seller);
        taxed.approve(address(assetManager), type(uint256).max);
        Item memory it = Item(AssetKind.ERC20, address(taxed), 0, 100e18, address(0), bytes32(0));
        vm.expectRevert(AllocXAssetManager.DeliveryShortfall.selector);
        assetManager.pull(it, seller, buyer);
        assertEq(taxed.balanceOf(seller), 1_000e18, "whole pull reverts");
    }

    // ------------------------------------------------- OwnershipManager
    function test_Ownership_SupportsKind() public view {
        assertFalse(ownership.supportsKind(AssetKind.ERC20));
        assertFalse(ownership.supportsKind(AssetKind.ERC721));
        assertFalse(ownership.supportsKind(AssetKind.ERC1155));
        assertTrue(ownership.supportsKind(AssetKind.OWNABLE));
        assertTrue(ownership.supportsKind(AssetKind.OWNABLE_2STEP));
        assertTrue(ownership.supportsKind(AssetKind.ACCESS_ROLE));
        assertTrue(ownership.supportsKind(AssetKind.ADAPTER));
    }

    function test_Ownership_OwnableControlsAndTransfer() public {
        Item memory it = _iOwn();
        assertTrue(ownership.controls(it, seller));
        assertFalse(ownership.controls(it, buyer));
        assertFalse(ownership.isTransferred(it, seller, buyer));
        vm.prank(seller);
        ownable.transferOwnership(buyer);
        assertTrue(ownership.isTransferred(it, seller, buyer));
        assertFalse(ownership.controls(it, seller));
        assertTrue(ownership.controls(it, buyer));
        assertFalse(ownership.isPending(it, buyer), "Ownable has no pending state");
    }

    function test_Ownership_TwoStepRequiresAcceptance() public {
        Item memory it = _iOwn2();
        assertTrue(ownership.controls(it, seller));
        vm.prank(seller);
        ownable2.transferOwnership(buyer);
        assertTrue(ownership.isPending(it, buyer));
        assertFalse(ownership.isPending(it, stranger));
        assertFalse(ownership.isTransferred(it, seller, buyer), "pending is not transferred");
        assertTrue(ownership.controls(it, seller), "seller is still owner until acceptance");
        vm.prank(buyer);
        ownable2.acceptOwnership();
        assertTrue(ownership.isTransferred(it, seller, buyer));
        assertFalse(ownership.isPending(it, buyer));
        assertTrue(ownership.controls(it, buyer));
    }

    function test_Ownership_OwnableKindAcceptsOwnable2StepTargetImmediately() public {
        // OWNABLE semantics on a 2-step contract: owner() == to is not reachable until accepted anyway.
        Item memory it = _iOwn2();
        it.kind = AssetKind.OWNABLE;
        vm.prank(seller);
        ownable2.transferOwnership(buyer);
        assertFalse(ownership.isTransferred(it, seller, buyer));
        vm.prank(buyer);
        ownable2.acceptOwnership();
        assertTrue(ownership.isTransferred(it, seller, buyer));
    }

    function test_Ownership_AccessRoleHandover() public {
        Item memory it = _iRole();
        assertTrue(ownership.controls(it, seller));
        assertFalse(ownership.controls(it, buyer));
        bytes32 role = acl.OPERATOR_ROLE();
        vm.prank(seller);
        acl.grantRole(role, buyer);
        assertFalse(ownership.isTransferred(it, seller, buyer), "seller still holds the role");
        vm.prank(seller);
        acl.renounceRole(role, seller);
        assertTrue(ownership.isTransferred(it, seller, buyer));
        assertFalse(ownership.controls(it, seller));
        assertFalse(ownership.isPending(it, buyer));
    }

    function test_Ownership_AccessRoleRevokedButNotGranted() public {
        Item memory it = _iRole();
        bytes32 role = acl.OPERATOR_ROLE();
        vm.prank(seller);
        acl.revokeRole(role, seller);
        assertFalse(ownership.isTransferred(it, seller, buyer), "buyer must actually hold the role");
    }

    function test_Ownership_DefaultAdminRoleId() public {
        Item memory it = Item(AssetKind.ACCESS_ROLE, address(acl), 0, 0, address(0), bytes32(0));
        assertTrue(ownership.controls(it, seller));
        vm.startPrank(seller);
        acl.grantRole(DEFAULT_ADMIN, buyer);
        acl.renounceRole(DEFAULT_ADMIN, seller);
        vm.stopPrank();
        assertTrue(ownership.isTransferred(it, seller, buyer));
    }

    function test_Ownership_AdapterRequiresApprovalAndController() public {
        Item memory it = _iAdapter();
        assertTrue(ownership.controls(it, seller));
        assertFalse(ownership.controls(it, buyer));
        adapter.setPending(address(adapterTarget), 7, bytes32("x"), buyer);
        assertTrue(ownership.isPending(it, buyer));
        assertFalse(ownership.isTransferred(it, seller, buyer));
        adapter.setController(address(adapterTarget), 7, bytes32("x"), buyer);
        assertTrue(ownership.isTransferred(it, seller, buyer));
        assertTrue(ownership.controls(it, buyer));
        assertFalse(ownership.controls(it, seller));
    }

    function test_Ownership_UnapprovedAdapterIsNeverTrusted() public {
        Item memory it = _iAdapter();
        vm.prank(admin);
        adapterRegistry.revokeAdapter(address(adapter), address(adapterTarget));
        assertFalse(ownership.controls(it, seller));
        adapter.setController(address(adapterTarget), 7, bytes32("x"), buyer);
        assertFalse(ownership.isTransferred(it, seller, buyer));
        adapter.setPending(address(adapterTarget), 7, bytes32("x"), buyer);
        assertFalse(ownership.isPending(it, buyer));

        // approved only for a different target is still not enough
        vm.prank(admin);
        adapterRegistry.approveAdapter(address(adapter), address(nft), "other target");
        assertFalse(ownership.controls(it, buyer));

        // adapter address without code
        vm.prank(admin);
        adapterRegistry.approveAdapter(address(adapter), address(adapterTarget), "back");
        it.adapter = stranger;
        assertFalse(ownership.controls(it, seller));
    }

    function test_Ownership_NoTransferWhenFromEqualsToOrZero() public view {
        assertFalse(ownership.isTransferred(_iOwn(), seller, seller));
        assertFalse(ownership.isTransferred(_iOwn(), seller, address(0)));
        assertFalse(ownership.controls(_iOwn(), address(0)));
        assertFalse(ownership.isPending(_iOwn2(), address(0)));
    }

    function test_Ownership_TokenKindsAreNotHandled() public view {
        assertFalse(ownership.controls(_i20(1), seller));
        assertFalse(ownership.controls(_i721(1), seller));
        assertFalse(ownership.isTransferred(_i20(1), seller, buyer));
        assertFalse(ownership.isPending(_i20(1), buyer));
    }
}
