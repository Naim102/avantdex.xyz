// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./AllocX.Base.t.sol";

/// @dev Unit tests for AllocXProjectRegistry and AllocXAdapterRegistry.
contract AllocXRegistriesTest is AllocXTestBase {
    address internal alice = makeAddr("alice");

    function _noRelated() internal pure returns (address[] memory r) {
        r = new address[](0);
    }

    function _submit(address who, address main_) internal returns (uint256 id) {
        vm.prank(who);
        id = registry.submitProject(ProjectCategory.SmartContract, main_, who, _noRelated(), bytes32("h"), "uri");
    }

    // ------------------------------------------------------------ submission
    function test_Submit_StoresPendingProjectWithSequentialIds() public {
        MockOwnable main_ = new MockOwnable(alice);
        uint256 id = _submit(alice, address(main_));
        assertEq(id, projectId + 1);
        assertEq(registry.projectCount(), id);
        Project memory p = registry.getProject(id);
        assertEq(p.submitter, alice);
        assertEq(p.mainContract, address(main_));
        assertEq(p.claimedOwner, alice);
        assertEq(uint8(p.status), uint8(ProjectStatus.Pending));
        assertEq(p.metadataHash, bytes32("h"));
        assertEq(p.createdAt, block.timestamp);
        assertEq(registry.metadataURI(id), "uri");
        assertEq(registry.projectOfContract(address(main_)), id);
        assertFalse(registry.isActive(id));
    }

    function test_Submit_EmitsEvents() public {
        MockOwnable main_ = new MockOwnable(alice);
        MockERC20 rel = new MockERC20();
        address[] memory related = new address[](1);
        related[0] = address(rel);
        uint256 id = registry.projectCount() + 1;
        vm.expectEmit(true, true, true, true, address(registry));
        emit AllocXProjectRegistry.ProjectSubmitted(
            id, alice, address(main_), ProjectCategory.Token, bob(), bytes32("h"), "uri"
        );
        vm.expectEmit(true, true, false, false, address(registry));
        emit AllocXProjectRegistry.ContractLinked(id, address(main_));
        vm.expectEmit(true, true, false, false, address(registry));
        emit AllocXProjectRegistry.ContractLinked(id, address(rel));
        vm.prank(alice);
        registry.submitProject(ProjectCategory.Token, address(main_), bob(), related, bytes32("h"), "uri");
    }

    function bob() internal returns (address) {
        return makeAddr("bob");
    }

    function test_Submit_ClaimedOwnerIsNeverTrustedAsVerifiedOwner() public {
        MockOwnable main_ = new MockOwnable(alice);
        vm.prank(stranger);
        uint256 id = registry.submitProject(
            ProjectCategory.FullProject, address(main_), stranger, _noRelated(), bytes32(0), ""
        );
        Project memory p = registry.getProject(id);
        assertEq(p.claimedOwner, stranger);
        assertEq(p.verifiedOwner, alice, "verifiedOwner is the LIVE owner(), not the claim");
    }

    function test_Submit_RevertsWhenMainIsNotAContract() public {
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(AllocXProjectRegistry.NotAContract.selector, alice));
        registry.submitProject(ProjectCategory.Token, alice, alice, _noRelated(), 0, "");
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(AllocXProjectRegistry.NotAContract.selector, address(0)));
        registry.submitProject(ProjectCategory.Token, address(0), alice, _noRelated(), 0, "");
    }

    function test_Submit_RevertsWhenMainAlreadyLinked() public {
        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(AllocXProjectRegistry.ContractAlreadyLinked.selector, address(ownable), projectId)
        );
        registry.submitProject(ProjectCategory.Token, address(ownable), alice, _noRelated(), 0, "");
    }

    function test_Submit_RevertsWhenRelatedAlreadyLinkedOrNotContract() public {
        MockOwnable main_ = new MockOwnable(alice);
        address[] memory related = new address[](1);
        related[0] = address(token20); // linked to project 1
        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(AllocXProjectRegistry.ContractAlreadyLinked.selector, address(token20), projectId)
        );
        registry.submitProject(ProjectCategory.Token, address(main_), alice, related, 0, "");

        related[0] = alice;
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(AllocXProjectRegistry.NotAContract.selector, alice));
        registry.submitProject(ProjectCategory.Token, address(main_), alice, related, 0, "");
    }

    function test_Submit_RevertsWhenRelatedDuplicatesMainOrItself() public {
        MockOwnable main_ = new MockOwnable(alice);
        MockERC20 rel = new MockERC20();
        address[] memory related = new address[](1);
        related[0] = address(main_);
        vm.prank(alice);
        vm.expectRevert();
        registry.submitProject(ProjectCategory.Token, address(main_), alice, related, 0, "");

        related = new address[](2);
        related[0] = address(rel);
        related[1] = address(rel);
        vm.prank(alice);
        vm.expectRevert();
        registry.submitProject(ProjectCategory.Token, address(main_), alice, related, 0, "");
    }

    function test_Submit_RelatedLimitIsTwenty() public {
        MockOwnable main_ = new MockOwnable(alice);
        address[] memory related = new address[](21);
        for (uint256 i; i < 21; ++i) {
            related[i] = address(new MockERC20());
        }
        vm.prank(alice);
        vm.expectRevert(AllocXProjectRegistry.TooManyRelatedContracts.selector);
        registry.submitProject(ProjectCategory.Token, address(main_), alice, related, 0, "");

        address[] memory twenty = new address[](20);
        for (uint256 i; i < 20; ++i) {
            twenty[i] = related[i];
        }
        vm.prank(alice);
        uint256 id = registry.submitProject(ProjectCategory.Token, address(main_), alice, twenty, 0, "");
        assertEq(registry.relatedContracts(id).length, 20);
    }

    // -------------------------------------------------------------- lifecycle
    function test_Activate_ByCuratorOnly() public {
        uint256 id = _submit(alice, address(new MockOwnable(alice)));
        vm.prank(stranger);
        vm.expectRevert(_unauth(stranger, CURATOR_ROLE));
        registry.activateProject(id);

        vm.expectEmit(true, false, false, false, address(registry));
        emit AllocXProjectRegistry.ProjectActivated(id);
        vm.prank(admin);
        registry.activateProject(id);
        assertTrue(registry.isActive(id));
    }

    function test_Activate_RevertsUnlessPendingOrUnknown() public {
        vm.prank(admin);
        vm.expectRevert(
            abi.encodeWithSelector(AllocXProjectRegistry.InvalidStatus.selector, projectId, ProjectStatus.Active)
        );
        registry.activateProject(projectId);
        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSelector(AllocXProjectRegistry.ProjectNotFound.selector, 999));
        registry.activateProject(999);
    }

    function test_Suspend_Reinstate_RoundTrip() public {
        vm.expectEmit(true, false, false, false, address(registry));
        emit AllocXProjectRegistry.ProjectSuspended(projectId);
        vm.prank(admin);
        registry.suspendProject(projectId);
        assertFalse(registry.isActive(projectId));
        // links retained while suspended
        assertEq(registry.projectOfContract(address(token20)), projectId);

        vm.expectEmit(true, false, false, false, address(registry));
        emit AllocXProjectRegistry.ProjectReinstated(projectId);
        vm.prank(admin);
        registry.reinstate(projectId);
        assertTrue(registry.isActive(projectId));
    }

    function test_Suspend_Reinstate_RevertOnWrongStateOrCaller() public {
        vm.prank(admin);
        vm.expectRevert(
            abi.encodeWithSelector(AllocXProjectRegistry.InvalidStatus.selector, projectId, ProjectStatus.Active)
        );
        registry.reinstate(projectId);

        uint256 pending = _submit(alice, address(new MockOwnable(alice)));
        vm.prank(admin);
        vm.expectRevert(
            abi.encodeWithSelector(AllocXProjectRegistry.InvalidStatus.selector, pending, ProjectStatus.Pending)
        );
        registry.suspendProject(pending);

        vm.prank(stranger);
        vm.expectRevert(_unauth(stranger, CURATOR_ROLE));
        registry.suspendProject(projectId);
        vm.prank(stranger);
        vm.expectRevert(_unauth(stranger, CURATOR_ROLE));
        registry.reinstate(projectId);
        vm.prank(stranger);
        vm.expectRevert(_unauth(stranger, CURATOR_ROLE));
        registry.rejectProject(projectId);
    }

    function test_Reject_FreesContractLinksAndAllowsResubmission() public {
        vm.expectEmit(true, true, false, false, address(registry));
        emit AllocXProjectRegistry.ContractUnlinked(projectId, address(ownable));
        vm.prank(admin);
        registry.rejectProject(projectId);
        assertEq(uint8(registry.getProject(projectId).status), uint8(ProjectStatus.Rejected));
        assertEq(registry.projectOfContract(address(ownable)), 0);
        assertEq(registry.projectOfContract(address(token20)), 0);
        assertEq(registry.projectOfContract(address(adapterTarget)), 0);
        // history retained
        assertEq(registry.relatedContracts(projectId).length, 6);
        // contract can be claimed by a new project
        uint256 id2 = _submit(alice, address(ownable));
        assertEq(registry.projectOfContract(address(ownable)), id2);
    }

    function test_Reject_TwiceRevertsAndWorksFromPendingAndSuspended() public {
        vm.prank(admin);
        registry.suspendProject(projectId);
        vm.prank(admin);
        registry.rejectProject(projectId);
        vm.prank(admin);
        vm.expectRevert(
            abi.encodeWithSelector(AllocXProjectRegistry.InvalidStatus.selector, projectId, ProjectStatus.Rejected)
        );
        registry.rejectProject(projectId);

        uint256 pending = _submit(alice, address(new MockOwnable(alice)));
        vm.prank(admin);
        registry.rejectProject(pending);
        assertEq(uint8(registry.getProject(pending).status), uint8(ProjectStatus.Rejected));
    }

    function test_Reject_RejectedProjectCannotBeReactivatedOrReinstated() public {
        vm.prank(admin);
        registry.rejectProject(projectId);
        vm.startPrank(admin);
        vm.expectRevert();
        registry.activateProject(projectId);
        vm.expectRevert();
        registry.reinstate(projectId);
        vm.expectRevert();
        registry.suspendProject(projectId);
        vm.stopPrank();
    }

    // ---------------------------------------------------- admin and metadata
    function test_ProjectAdmin_IsLiveOwnerElseSubmitter() public {
        assertEq(registry.projectAdmin(projectId), seller);
        vm.prank(seller);
        ownable.transferOwnership(alice);
        assertEq(registry.projectAdmin(projectId), alice, "admin follows live owner()");
        assertEq(registry.getProject(projectId).verifiedOwner, alice);

        // non-Ownable main contract: falls back to submitter
        MockAccessControl nonOwnable = new MockAccessControl(alice);
        uint256 id = _submit(stranger, address(nonOwnable));
        assertEq(registry.projectAdmin(id), stranger);
        assertEq(registry.getProject(id).verifiedOwner, address(0));

        // renounced ownership (owner == 0): falls back to submitter
        vm.prank(alice);
        ownable.renounceOwnership();
        assertEq(registry.projectAdmin(projectId), seller);
    }

    function test_UpdateMetadata_AdminOnlyAndEmits() public {
        vm.expectEmit(true, false, false, true, address(registry));
        emit AllocXProjectRegistry.MetadataUpdated(projectId, bytes32("new"), "ipfs://new");
        vm.prank(seller);
        registry.updateMetadata(projectId, bytes32("new"), "ipfs://new");
        assertEq(registry.getProject(projectId).metadataHash, bytes32("new"));
        assertEq(registry.metadataURI(projectId), "ipfs://new");

        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(AllocXProjectRegistry.NotProjectAdmin.selector, projectId));
        registry.updateMetadata(projectId, bytes32("x"), "x");
    }

    function test_UpdateMetadata_RightFollowsOwnershipTransfer() public {
        vm.prank(seller);
        ownable.transferOwnership(alice);
        vm.prank(seller);
        vm.expectRevert(abi.encodeWithSelector(AllocXProjectRegistry.NotProjectAdmin.selector, projectId));
        registry.updateMetadata(projectId, bytes32("x"), "x");
        vm.prank(alice);
        registry.updateMetadata(projectId, bytes32("y"), "y");
    }

    function test_AddRelatedContract_RulesAndLimit() public {
        MockERC20 extra = new MockERC20();
        vm.expectEmit(true, true, false, false, address(registry));
        emit AllocXProjectRegistry.ContractLinked(projectId, address(extra));
        vm.prank(seller);
        registry.addRelatedContract(projectId, address(extra));
        assertEq(registry.projectOfContract(address(extra)), projectId);
        assertEq(registry.relatedContracts(projectId).length, 7);

        address fresh = address(new MockERC20());
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(AllocXProjectRegistry.NotProjectAdmin.selector, projectId));
        registry.addRelatedContract(projectId, fresh);

        vm.prank(seller);
        vm.expectRevert(
            abi.encodeWithSelector(AllocXProjectRegistry.ContractAlreadyLinked.selector, address(extra), projectId)
        );
        registry.addRelatedContract(projectId, address(extra));

        vm.prank(seller);
        vm.expectRevert(abi.encodeWithSelector(AllocXProjectRegistry.NotAContract.selector, alice));
        registry.addRelatedContract(projectId, alice);

        // fill to exactly 20 total, then the 21st reverts
        for (uint256 i = 7; i < 20; ++i) {
            address c = address(new MockERC20());
            vm.prank(seller);
            registry.addRelatedContract(projectId, c);
        }
        assertEq(registry.relatedContracts(projectId).length, 20);
        address over = address(new MockERC20());
        vm.prank(seller);
        vm.expectRevert(AllocXProjectRegistry.TooManyRelatedContracts.selector);
        registry.addRelatedContract(projectId, over);
    }

    function test_AddRelatedContract_RevertsOnRejectedProject() public {
        vm.prank(admin);
        registry.rejectProject(projectId);
        address extra = address(new MockERC20());
        vm.prank(seller);
        vm.expectRevert(
            abi.encodeWithSelector(AllocXProjectRegistry.InvalidStatus.selector, projectId, ProjectStatus.Rejected)
        );
        registry.addRelatedContract(projectId, extra);
    }

    function test_Views_RevertForUnknownProject() public {
        vm.expectRevert(abi.encodeWithSelector(AllocXProjectRegistry.ProjectNotFound.selector, 999));
        registry.getProject(999);
        vm.expectRevert(abi.encodeWithSelector(AllocXProjectRegistry.ProjectNotFound.selector, 999));
        registry.projectAdmin(999);
        vm.expectRevert(abi.encodeWithSelector(AllocXProjectRegistry.ProjectNotFound.selector, 999));
        registry.relatedContracts(999);
        assertFalse(registry.isActive(999));
        assertFalse(registry.isActive(0));
    }

    // -------------------------------------------------------- AdapterRegistry
    function test_Adapter_ApproveIsScopedToTarget() public {
        MockAdapter a2 = new MockAdapter();
        vm.expectEmit(true, true, false, true, address(adapterRegistry));
        emit AllocXAdapterRegistry.AdapterApproved(address(a2), address(token20), "d2");
        vm.prank(admin);
        adapterRegistry.approveAdapter(address(a2), address(token20), "d2");
        assertTrue(adapterRegistry.isApproved(address(a2), address(token20)));
        assertFalse(adapterRegistry.isApproved(address(a2), address(nft)), "no wildcard targets");
        assertEq(adapterRegistry.adapterDescription(address(a2)), "d2");
        assertTrue(adapterRegistry.isApproved(address(adapter), address(adapterTarget)));
    }

    function test_Adapter_ApproveReverts() public {
        vm.prank(stranger);
        vm.expectRevert(_unauth(stranger, ADAPTER_ADMIN_ROLE));
        adapterRegistry.approveAdapter(address(adapter), address(nft), "d");

        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSelector(AllocXAdapterRegistry.NotAContract.selector, alice));
        adapterRegistry.approveAdapter(alice, address(nft), "d");

        vm.prank(admin);
        vm.expectRevert(AllocXAdapterRegistry.ZeroAddress.selector);
        adapterRegistry.approveAdapter(address(adapter), address(0), "d");
    }

    function test_Adapter_RevokeOnlyAffectsOneTarget() public {
        vm.startPrank(admin);
        adapterRegistry.approveAdapter(address(adapter), address(nft), "n");
        vm.expectEmit(true, true, false, false, address(adapterRegistry));
        emit AllocXAdapterRegistry.AdapterRevoked(address(adapter), address(adapterTarget));
        adapterRegistry.revokeAdapter(address(adapter), address(adapterTarget));
        vm.stopPrank();
        assertFalse(adapterRegistry.isApproved(address(adapter), address(adapterTarget)));
        assertTrue(adapterRegistry.isApproved(address(adapter), address(nft)));

        vm.prank(stranger);
        vm.expectRevert(_unauth(stranger, ADAPTER_ADMIN_ROLE));
        adapterRegistry.revokeAdapter(address(adapter), address(nft));
    }

    function test_Adapter_BatchApprove() public {
        MockAdapter a2 = new MockAdapter();
        address[] memory as_ = new address[](2);
        address[] memory ts = new address[](2);
        string[] memory ds = new string[](2);
        as_[0] = address(a2);
        as_[1] = address(a2);
        ts[0] = address(nft);
        ts[1] = address(multi);
        ds[0] = "a";
        ds[1] = "b";
        vm.prank(admin);
        adapterRegistry.approveAdapterBatch(as_, ts, ds);
        assertTrue(adapterRegistry.isApproved(address(a2), address(nft)));
        assertTrue(adapterRegistry.isApproved(address(a2), address(multi)));
        assertEq(adapterRegistry.adapterDescription(address(a2)), "b");
    }

    function test_Adapter_BatchRevertsOnLengthMismatchAndIsAtomic() public {
        address[] memory as_ = new address[](2);
        address[] memory ts = new address[](1);
        string[] memory ds = new string[](2);
        vm.prank(admin);
        vm.expectRevert(AllocXAdapterRegistry.ArrayLengthMismatch.selector);
        adapterRegistry.approveAdapterBatch(as_, ts, ds);

        // second entry invalid => nothing approved
        MockAdapter a2 = new MockAdapter();
        as_[0] = address(a2);
        as_[1] = alice; // not a contract
        ts = new address[](2);
        ts[0] = address(nft);
        ts[1] = address(nft);
        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSelector(AllocXAdapterRegistry.NotAContract.selector, alice));
        adapterRegistry.approveAdapterBatch(as_, ts, ds);
        assertFalse(adapterRegistry.isApproved(address(a2), address(nft)));

        vm.prank(stranger);
        vm.expectRevert(_unauth(stranger, ADAPTER_ADMIN_ROLE));
        adapterRegistry.approveAdapterBatch(as_, ts, ds);
    }
}
