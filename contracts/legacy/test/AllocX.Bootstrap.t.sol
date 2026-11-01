// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./AllocX.Base.t.sol";

/// @dev Bootstrappers: role hand-off, wiring, constructor validation, module constructor validation.
contract AllocXBootstrapTest is AllocXTestBase {
    function _has(address module, bytes32 role, address who) internal view returns (bool) {
        return IAccessControl(module).hasRole(role, who);
    }

    // ------------------------------------------------------------------ core
    function test_Core_FinalAdminHoldsAdminAndOperationalRoles() public view {
        assertTrue(_has(address(registry), DEFAULT_ADMIN, admin));
        assertTrue(_has(address(adapterRegistry), DEFAULT_ADMIN, admin));
        assertTrue(_has(address(verification), DEFAULT_ADMIN, admin));
        assertTrue(_has(address(ownership), DEFAULT_ADMIN, admin));
        assertTrue(_has(address(registry), registry.CURATOR_ROLE(), admin));
        assertTrue(_has(address(adapterRegistry), adapterRegistry.ADAPTER_ADMIN_ROLE(), admin));
        assertTrue(_has(address(verification), verification.ATTESTOR_ROLE(), admin));
    }

    function test_Core_BootstrapperLeavesNoRolesOnItself() public view {
        address c = address(core);
        assertFalse(_has(address(registry), DEFAULT_ADMIN, c));
        assertFalse(_has(address(adapterRegistry), DEFAULT_ADMIN, c));
        assertFalse(_has(address(verification), DEFAULT_ADMIN, c));
        assertFalse(_has(address(ownership), DEFAULT_ADMIN, c));
        assertFalse(_has(address(registry), registry.CURATOR_ROLE(), c));
        assertFalse(_has(address(adapterRegistry), adapterRegistry.ADAPTER_ADMIN_ROLE(), c));
        assertFalse(_has(address(verification), verification.ATTESTOR_ROLE(), c));
        // Enumerable verification: exactly one admin and one attestor, both finalAdmin.
        assertEq(verification.getRoleMemberCount(DEFAULT_ADMIN), 1);
        assertEq(verification.getRoleMemberCount(verification.ATTESTOR_ROLE()), 1);
    }

    function test_Core_WiresModulesTogether() public view {
        assertEq(address(verification.registry()), address(registry));
        assertEq(address(ownership.adapterRegistry()), address(adapterRegistry));
    }

    function test_Core_EmitsCoreDeployed() public {
        address self = address(this);
        address predicted = vm.computeCreateAddress(self, vm.getNonce(self));
        vm.expectEmit(false, false, false, true, predicted);
        emit AllocXCoreDeployer.CoreDeployed(
            vm.computeCreateAddress(predicted, 1),
            vm.computeCreateAddress(predicted, 2),
            vm.computeCreateAddress(predicted, 3),
            vm.computeCreateAddress(predicted, 4)
        );
        AllocXCoreDeployer c = new AllocXCoreDeployer(admin);
        assertEq(address(c), predicted);
        assertEq(address(c.registry()), vm.computeCreateAddress(predicted, 1));
    }

    function test_Core_RevertsOnZeroFinalAdmin() public {
        vm.expectRevert(AllocXCoreDeployer.InvalidFinalAdmin.selector);
        new AllocXCoreDeployer(address(0));
    }

    function test_Core_RevertsWhenFinalAdminIsBootstrapper() public {
        address self = address(this);
        address predicted = vm.computeCreateAddress(self, vm.getNonce(self));
        vm.expectRevert(AllocXCoreDeployer.InvalidFinalAdmin.selector);
        new AllocXCoreDeployer(predicted);
    }

    function test_Core_StrangerHasNoOperationalRoles() public view {
        assertFalse(_has(address(registry), registry.CURATOR_ROLE(), stranger));
        assertFalse(_has(address(verification), verification.ATTESTOR_ROLE(), stranger));
    }

    // ---------------------------------------------------------------- market
    function test_Market_FinalAdminHoldsAdminAndOperationalRoles() public view {
        assertTrue(_has(address(feeManager), DEFAULT_ADMIN, admin));
        assertTrue(_has(address(assetManager), DEFAULT_ADMIN, admin));
        assertTrue(_has(address(escrow), DEFAULT_ADMIN, admin));
        assertTrue(_has(address(marketplace), DEFAULT_ADMIN, admin));
        assertTrue(_has(address(settlement), DEFAULT_ADMIN, admin));
        assertTrue(_has(address(disputes), DEFAULT_ADMIN, admin));
        assertTrue(_has(address(feeManager), feeManager.FEE_ADMIN_ROLE(), admin));
        assertTrue(_has(address(marketplace), marketplace.PAUSER_ROLE(), admin));
        assertTrue(_has(address(marketplace), marketplace.MODERATOR_ROLE(), admin));
        assertTrue(_has(address(settlement), settlement.PAUSER_ROLE(), admin));
        assertTrue(_has(address(disputes), disputes.ARBITRATOR_ROLE(), admin));
    }

    function test_Market_FinalAdminDoesNotGetServiceRoles() public view {
        assertFalse(_has(address(feeManager), feeManager.ESCROW_ROLE(), admin));
        assertFalse(_has(address(assetManager), assetManager.SETTLEMENT_ROLE(), admin));
        assertFalse(_has(address(escrow), escrow.SETTLEMENT_ROLE(), admin));
        assertFalse(_has(address(marketplace), marketplace.SETTLEMENT_ROLE(), admin));
        assertFalse(_has(address(settlement), settlement.DISPUTE_ROLE(), admin));
    }

    function test_Market_BootstrapperLeavesNoRolesOnItself() public view {
        address m = address(mkt);
        address[6] memory mods = [
            address(feeManager), address(assetManager), address(escrow),
            address(marketplace), address(settlement), address(disputes)
        ];
        for (uint256 i; i < mods.length; ++i) {
            assertFalse(_has(mods[i], DEFAULT_ADMIN, m));
        }
        assertFalse(_has(address(feeManager), feeManager.FEE_ADMIN_ROLE(), m));
        assertFalse(_has(address(feeManager), feeManager.ESCROW_ROLE(), m));
        assertFalse(_has(address(assetManager), assetManager.SETTLEMENT_ROLE(), m));
        assertFalse(_has(address(escrow), escrow.SETTLEMENT_ROLE(), m));
        assertFalse(_has(address(marketplace), marketplace.PAUSER_ROLE(), m));
        assertFalse(_has(address(marketplace), marketplace.MODERATOR_ROLE(), m));
        assertFalse(_has(address(marketplace), marketplace.SETTLEMENT_ROLE(), m));
        assertFalse(_has(address(settlement), settlement.PAUSER_ROLE(), m));
        assertFalse(_has(address(settlement), settlement.DISPUTE_ROLE(), m));
        assertFalse(_has(address(disputes), disputes.ARBITRATOR_ROLE(), m));
    }

    function test_Market_ServiceRolesWiredToTheRightModules() public view {
        assertTrue(_has(address(escrow), escrow.SETTLEMENT_ROLE(), address(settlement)));
        assertTrue(_has(address(feeManager), feeManager.ESCROW_ROLE(), address(escrow)));
        assertTrue(_has(address(assetManager), assetManager.SETTLEMENT_ROLE(), address(settlement)));
        assertTrue(_has(address(marketplace), marketplace.SETTLEMENT_ROLE(), address(settlement)));
        assertTrue(_has(address(settlement), settlement.DISPUTE_ROLE(), address(disputes)));
        assertEq(address(marketplace.settlement()), address(settlement));
    }

    function test_Market_ParametersAndDependencies() public view {
        assertEq(address(feeManager.usdc()), address(usdc));
        assertEq(feeManager.treasury(), treasury);
        assertEq(feeManager.defaultFeeBps(), 200);
        assertEq(address(escrow.usdc()), address(usdc));
        assertEq(address(escrow.feeManager()), address(feeManager));
        assertEq(address(marketplace.registry()), address(registry));
        assertEq(address(marketplace.assetManager()), address(assetManager));
        assertEq(address(marketplace.ownershipManager()), address(ownership));
        assertEq(address(settlement.marketplace()), address(marketplace));
        assertEq(address(settlement.escrow()), address(escrow));
        assertEq(address(settlement.assetManager()), address(assetManager));
        assertEq(address(settlement.ownershipManager()), address(ownership));
        assertEq(address(settlement.verification()), address(verification));
        assertEq(address(disputes.settlement()), address(settlement));
    }

    function test_Market_SetSettlementCannotBeCalledAgain() public {
        vm.prank(admin);
        vm.expectRevert(AllocXMarketplace.SettlementAlreadySet.selector);
        marketplace.setSettlement(address(settlement));
    }

    function test_Market_SetSettlementRequiresAdmin() public {
        vm.prank(stranger);
        vm.expectRevert(
            abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, stranger, DEFAULT_ADMIN)
        );
        marketplace.setSettlement(address(settlement));
    }

    function test_Market_EmitsMarketDeployed() public {
        address self = address(this);
        address predicted = vm.computeCreateAddress(self, vm.getNonce(self));
        vm.expectEmit(false, false, false, true, predicted);
        emit AllocXMarketDeployer.MarketDeployed(
            vm.computeCreateAddress(predicted, 1),
            vm.computeCreateAddress(predicted, 2),
            vm.computeCreateAddress(predicted, 3),
            vm.computeCreateAddress(predicted, 4),
            vm.computeCreateAddress(predicted, 5),
            vm.computeCreateAddress(predicted, 6)
        );
        new AllocXMarketDeployer(
            admin, address(usdc), treasury, 200, address(registry), address(verification), address(ownership)
        );
    }

    function test_Market_RevertsOnZeroFinalAdmin() public {
        vm.expectRevert(AllocXMarketDeployer.InvalidFinalAdmin.selector);
        new AllocXMarketDeployer(
            address(0), address(usdc), treasury, 200, address(registry), address(verification), address(ownership)
        );
    }

    function test_Market_RevertsWhenFinalAdminIsBootstrapper() public {
        address self = address(this);
        address predicted = vm.computeCreateAddress(self, vm.getNonce(self));
        vm.expectRevert(AllocXMarketDeployer.InvalidFinalAdmin.selector);
        new AllocXMarketDeployer(
            predicted, address(usdc), treasury, 200, address(registry), address(verification), address(ownership)
        );
    }

    function test_Market_RevertsOnZeroDependencies() public {
        vm.expectRevert(AllocXMarketDeployer.ZeroAddress.selector);
        new AllocXMarketDeployer(
            admin, address(0), treasury, 200, address(registry), address(verification), address(ownership)
        );
        vm.expectRevert(AllocXMarketDeployer.ZeroAddress.selector);
        new AllocXMarketDeployer(
            admin, address(usdc), address(0), 200, address(registry), address(verification), address(ownership)
        );
        vm.expectRevert(AllocXMarketDeployer.ZeroAddress.selector);
        new AllocXMarketDeployer(
            admin, address(usdc), treasury, 200, address(0), address(verification), address(ownership)
        );
        vm.expectRevert(AllocXMarketDeployer.ZeroAddress.selector);
        new AllocXMarketDeployer(
            admin, address(usdc), treasury, 200, address(registry), address(0), address(ownership)
        );
        vm.expectRevert(AllocXMarketDeployer.ZeroAddress.selector);
        new AllocXMarketDeployer(
            admin, address(usdc), treasury, 200, address(registry), address(verification), address(0)
        );
    }

    function test_Market_RevertsOnDependenciesWithoutCode() public {
        vm.expectRevert(AllocXMarketDeployer.InvalidContract.selector);
        new AllocXMarketDeployer(
            admin, address(usdc), treasury, 200, stranger, address(verification), address(ownership)
        );
        vm.expectRevert(AllocXMarketDeployer.InvalidContract.selector);
        new AllocXMarketDeployer(
            admin, address(usdc), treasury, 200, address(registry), stranger, address(ownership)
        );
        vm.expectRevert(AllocXMarketDeployer.InvalidContract.selector);
        new AllocXMarketDeployer(
            admin, address(usdc), treasury, 200, address(registry), address(verification), stranger
        );
    }

    function test_Market_RevertsOnUsdcWithoutCodeOrFeeTooHigh() public {
        vm.expectRevert(abi.encodeWithSelector(AllocXFeeManager.NotAContract.selector, stranger));
        new AllocXMarketDeployer(
            admin, stranger, treasury, 200, address(registry), address(verification), address(ownership)
        );
        vm.expectRevert(abi.encodeWithSelector(AllocXFeeManager.FeeTooHigh.selector, uint16(1001)));
        new AllocXMarketDeployer(
            admin, address(usdc), treasury, 1001, address(registry), address(verification), address(ownership)
        );
    }

    // ------------------------------------------------- module constructors
    function test_ModuleConstructors_RejectZeroAdmin() public {
        vm.expectRevert(AllocXProjectRegistry.ZeroAddress.selector);
        new AllocXProjectRegistry(address(0));
        vm.expectRevert(AllocXAdapterRegistry.ZeroAddress.selector);
        new AllocXAdapterRegistry(address(0));
        vm.expectRevert(AllocXAssetManager.ZeroAddress.selector);
        new AllocXAssetManager(address(0));
        vm.expectRevert(AllocXVerification.ZeroAddress.selector);
        new AllocXVerification(address(0), address(registry));
        vm.expectRevert(AllocXOwnershipManager.ZeroAddress.selector);
        new AllocXOwnershipManager(address(0), address(adapterRegistry));
    }

    function test_ModuleConstructors_RejectBadDependencies() public {
        vm.expectRevert(AllocXVerification.ZeroAddress.selector);
        new AllocXVerification(admin, address(0));
        vm.expectRevert(abi.encodeWithSelector(AllocXVerification.NotAContract.selector, stranger));
        new AllocXVerification(admin, stranger);
        vm.expectRevert(AllocXOwnershipManager.ZeroAddress.selector);
        new AllocXOwnershipManager(admin, address(0));
        vm.expectRevert(AllocXOwnershipManager.InvalidRegistry.selector);
        new AllocXOwnershipManager(admin, stranger);
    }

    function test_FeeManagerConstructor_Validation() public {
        vm.expectRevert(AllocXFeeManager.ZeroAddress.selector);
        new AllocXFeeManager(address(0), address(usdc), treasury, 200);
        vm.expectRevert(AllocXFeeManager.ZeroAddress.selector);
        new AllocXFeeManager(admin, address(0), treasury, 200);
        vm.expectRevert(AllocXFeeManager.ZeroAddress.selector);
        new AllocXFeeManager(admin, address(usdc), address(0), 200);
        vm.expectRevert(abi.encodeWithSelector(AllocXFeeManager.NotAContract.selector, stranger));
        new AllocXFeeManager(admin, stranger, treasury, 200);
        vm.expectRevert(abi.encodeWithSelector(AllocXFeeManager.FeeTooHigh.selector, uint16(1001)));
        new AllocXFeeManager(admin, address(usdc), treasury, 1001);
        AllocXFeeManager ok = new AllocXFeeManager(admin, address(usdc), treasury, 1000);
        assertEq(ok.defaultFeeBps(), 1000);
    }

    function test_EscrowConstructor_Validation() public {
        vm.expectRevert(AllocXEscrow.ZeroAddress.selector);
        new AllocXEscrow(address(0), address(usdc), address(feeManager));
        vm.expectRevert(AllocXEscrow.ZeroAddress.selector);
        new AllocXEscrow(admin, address(0), address(feeManager));
        vm.expectRevert(AllocXEscrow.ZeroAddress.selector);
        new AllocXEscrow(admin, address(usdc), address(0));
        vm.expectRevert(AllocXEscrow.InvalidContract.selector);
        new AllocXEscrow(admin, stranger, address(feeManager));
        vm.expectRevert(AllocXEscrow.InvalidContract.selector);
        new AllocXEscrow(admin, address(usdc), stranger);
    }

    function test_MarketplaceConstructor_Validation() public {
        vm.expectRevert(AllocXMarketplace.ZeroAddress.selector);
        new AllocXMarketplace(address(0), address(registry), address(assetManager), address(ownership));
        vm.expectRevert(AllocXMarketplace.ZeroAddress.selector);
        new AllocXMarketplace(admin, address(0), address(assetManager), address(ownership));
        vm.expectRevert(AllocXMarketplace.ZeroAddress.selector);
        new AllocXMarketplace(admin, address(registry), address(0), address(ownership));
        vm.expectRevert(AllocXMarketplace.ZeroAddress.selector);
        new AllocXMarketplace(admin, address(registry), address(assetManager), address(0));
        vm.expectRevert(AllocXMarketplace.InvalidContract.selector);
        new AllocXMarketplace(admin, stranger, address(assetManager), address(ownership));
        vm.expectRevert(AllocXMarketplace.InvalidContract.selector);
        new AllocXMarketplace(admin, address(registry), stranger, address(ownership));
        vm.expectRevert(AllocXMarketplace.InvalidContract.selector);
        new AllocXMarketplace(admin, address(registry), address(assetManager), stranger);
    }

    function test_SettlementConstructor_Validation() public {
        address m = address(marketplace);
        address e = address(escrow);
        address a = address(assetManager);
        address o = address(ownership);
        address v = address(verification);
        vm.expectRevert(AllocXSettlement.ZeroAddress.selector);
        new AllocXSettlement(address(0), m, e, a, o, v);
        vm.expectRevert(AllocXSettlement.ZeroAddress.selector);
        new AllocXSettlement(admin, address(0), e, a, o, v);
        vm.expectRevert(AllocXSettlement.ZeroAddress.selector);
        new AllocXSettlement(admin, m, address(0), a, o, v);
        vm.expectRevert(AllocXSettlement.ZeroAddress.selector);
        new AllocXSettlement(admin, m, e, address(0), o, v);
        vm.expectRevert(AllocXSettlement.ZeroAddress.selector);
        new AllocXSettlement(admin, m, e, a, address(0), v);
        vm.expectRevert(AllocXSettlement.ZeroAddress.selector);
        new AllocXSettlement(admin, m, e, a, o, address(0));
        vm.expectRevert(AllocXSettlement.InvalidContract.selector);
        new AllocXSettlement(admin, stranger, e, a, o, v);
        vm.expectRevert(AllocXSettlement.InvalidContract.selector);
        new AllocXSettlement(admin, m, stranger, a, o, v);
        vm.expectRevert(AllocXSettlement.InvalidContract.selector);
        new AllocXSettlement(admin, m, e, stranger, o, v);
        vm.expectRevert(AllocXSettlement.InvalidContract.selector);
        new AllocXSettlement(admin, m, e, a, stranger, v);
        vm.expectRevert(AllocXSettlement.InvalidContract.selector);
        new AllocXSettlement(admin, m, e, a, o, stranger);
    }

    function test_DisputeManagerConstructor_Validation() public {
        vm.expectRevert(AllocXDisputeManager.ZeroAddress.selector);
        new AllocXDisputeManager(address(0), address(settlement));
        vm.expectRevert(AllocXDisputeManager.ZeroAddress.selector);
        new AllocXDisputeManager(admin, address(0));
        vm.expectRevert(AllocXDisputeManager.InvalidSettlement.selector);
        new AllocXDisputeManager(admin, stranger);
    }

    function test_NoModuleAcceptsNativeValue() public {
        vm.deal(address(this), 10 ether);
        address[10] memory mods = [
            address(registry), address(adapterRegistry), address(verification), address(ownership),
            address(feeManager), address(assetManager), address(escrow), address(marketplace),
            address(settlement), address(disputes)
        ];
        for (uint256 i; i < mods.length; ++i) {
            (bool ok,) = mods[i].call{value: 1 ether}("");
            assertFalse(ok, "module accepted native value");
            assertEq(mods[i].balance, 0);
        }
    }
}
