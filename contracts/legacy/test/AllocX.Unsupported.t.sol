// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./AllocX.Base.t.sol";

/// @dev Design rule: "Unknown contracts are unsupported: control checks use staticcall/try-catch and return
///      false (never revert) for non-conforming targets." Each (target kind x module) is probed separately.
///      RevertingTarget: reverts on any call. PermissiveTarget: accepts any call, returns no data.
///      GarbageTarget: returns one junk byte. EOAs have no code.
contract AllocXUnsupportedTest is AllocXTestBase {
    function _reverting() internal returns (address) {
        return address(new RevertingTarget());
    }

    function _permissive() internal returns (address) {
        return address(new PermissiveTarget());
    }

    function _garbage() internal returns (address) {
        return address(new GarbageTarget());
    }

    function _item(AssetKind k, address t) internal pure returns (Item memory) {
        return Item(k, t, 1, k == AssetKind.ERC721 ? 1 : (uint8(k) >= 3 ? 0 : 1), address(0), bytes32(0));
    }

    function _probeAssetManager(address t) internal view {
        assertFalse(assetManager.controls(_item(AssetKind.ERC20, t), seller, false));
        assertFalse(assetManager.controls(_item(AssetKind.ERC20, t), seller, true));
        assertFalse(assetManager.controls(_item(AssetKind.ERC721, t), seller, false));
        assertFalse(assetManager.controls(_item(AssetKind.ERC721, t), seller, true));
        assertFalse(assetManager.controls(_item(AssetKind.ERC1155, t), seller, false));
        assertFalse(assetManager.controls(_item(AssetKind.ERC1155, t), seller, true));
    }

    function _probeOwnership(address t) internal view {
        AssetKind[4] memory kinds =
            [AssetKind.OWNABLE, AssetKind.OWNABLE_2STEP, AssetKind.ACCESS_ROLE, AssetKind.ADAPTER];
        for (uint256 i; i < kinds.length; ++i) {
            Item memory it = _item(kinds[i], t);
            if (kinds[i] == AssetKind.ADAPTER) it.adapter = address(adapter);
            assertFalse(ownership.controls(it, seller));
            assertFalse(ownership.isTransferred(it, seller, buyer));
            assertFalse(ownership.isPending(it, buyer));
        }
    }

    function _submitWithMain(address t) internal returns (uint256 id) {
        vm.prank(stranger);
        id = registry.submitProject(ProjectCategory.OtherRight, t, stranger, new address[](0), 0, "");
    }

    function _probeVerification(address t) internal {
        uint256 id = _submitWithMain(t);
        assertFalse(verification.currentControl(id, seller));
        assertFalse(verification.isVerified(id, seller));
        vm.expectRevert(AllocXVerification.NotController.selector);
        verification.verifyProjectControl(id, seller);
    }

    function _probeRegistry(address t) internal {
        uint256 id = _submitWithMain(t);
        Project memory p = registry.getProject(id);
        assertEq(p.verifiedOwner, address(0));
        assertEq(registry.projectAdmin(id), stranger, "falls back to submitter");
        vm.prank(stranger);
        registry.updateMetadata(id, bytes32("m"), "m");
    }

    function _probeMarketplace(address t) internal {
        uint256 id = _submitWithMain(t);
        vm.prank(admin);
        registry.activateProject(id);
        Item[] memory items = new Item[](1);
        items[0] = Item(AssetKind.ERC20, t, 0, 1, address(0), bytes32(0));
        vm.prank(seller);
        vm.expectRevert(abi.encodeWithSelector(AllocXMarketplace.NotController.selector, 0));
        marketplace.createListing(id, items, PRICE, uint64(block.timestamp + 1 days), WINDOW, false, 0);
        items[0] = Item(AssetKind.OWNABLE, t, 0, 0, address(0), bytes32(0));
        vm.prank(seller);
        vm.expectRevert(abi.encodeWithSelector(AllocXMarketplace.NotController.selector, 0));
        marketplace.createListing(id, items, PRICE, uint64(block.timestamp + 1 days), WINDOW, false, 0);
    }

    // --------------------------------------------------- reverting target
    function test_Reverting_AssetManager() public {
        _probeAssetManager(_reverting());
    }

    function test_Reverting_Ownership() public {
        _probeOwnership(_reverting());
    }

    function test_Reverting_Verification() public {
        _probeVerification(_reverting());
    }

    function test_Reverting_Registry() public {
        _probeRegistry(_reverting());
    }

    function test_Reverting_Marketplace() public {
        _probeMarketplace(_reverting());
    }

    // ------------------------------------------------------- EOA target
    function test_Eoa_AssetManagerAndOwnership() public view {
        _probeAssetManager(stranger);
        _probeOwnership(stranger);
    }

    // ------------------------------------------- permissive-fallback target
    function test_Permissive_AssetManager() public {
        _probeAssetManager(_permissive());
    }

    function test_Permissive_Ownership() public {
        _probeOwnership(_permissive());
    }

    function test_Permissive_Verification() public {
        _probeVerification(_permissive());
    }

    function test_Permissive_Registry() public {
        _probeRegistry(_permissive());
    }

    function test_Permissive_Marketplace() public {
        _probeMarketplace(_permissive());
    }

    // ------------------------------------------------ garbage-return target
    function test_Garbage_AssetManager() public {
        _probeAssetManager(_garbage());
    }

    function test_Garbage_Ownership() public {
        _probeOwnership(_garbage());
    }

    function test_Garbage_Verification() public {
        _probeVerification(_garbage());
    }

    function test_Garbage_Registry() public {
        _probeRegistry(_garbage());
    }

    function test_Garbage_Marketplace() public {
        _probeMarketplace(_garbage());
    }
}
