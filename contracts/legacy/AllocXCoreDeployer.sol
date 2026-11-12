// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {AllocXProjectRegistry} from "./AllocXProjectRegistry.sol";
import {AllocXAdapterRegistry} from "./AllocXAdapterRegistry.sol";
import {AllocXVerification} from "./AllocXVerification.sol";
import {AllocXOwnershipManager} from "./AllocXOwnershipManager.sol";

/// @title AllocXCoreDeployer
/// @notice Constructor-only bootstrapper that creates the four AllocX core modules.
/// @dev No privileges are retained and no market-group service roles are required on core modules.
contract AllocXCoreDeployer is AccessControl {
    AllocXProjectRegistry public registry;
    AllocXAdapterRegistry public adapterRegistry;
    AllocXVerification public verification;
    AllocXOwnershipManager public ownershipManager;

    error InvalidFinalAdmin();

    event CoreDeployed(address registry, address adapterRegistry, address verification, address ownershipManager);

    /// @notice Creates core modules and hands all administration to finalAdmin.
    /// @param finalAdmin Final administrator, normally a multisig; never this bootstrapper.
    constructor(address finalAdmin) {
        if (finalAdmin == address(0) || finalAdmin == address(this)) revert InvalidFinalAdmin();

        registry = new AllocXProjectRegistry(address(this));
        adapterRegistry = new AllocXAdapterRegistry(address(this));
        verification = new AllocXVerification(address(this), address(registry));
        ownershipManager = new AllocXOwnershipManager(address(this), address(adapterRegistry));

        _operational(registry, registry.CURATOR_ROLE(), finalAdmin);
        _operational(adapterRegistry, adapterRegistry.ADAPTER_ADMIN_ROLE(), finalAdmin);
        _operational(verification, verification.ATTESTOR_ROLE(), finalAdmin);

        _handoff(registry, finalAdmin);
        _handoff(adapterRegistry, finalAdmin);
        _handoff(verification, finalAdmin);
        _handoff(ownershipManager, finalAdmin);

        emit CoreDeployed(address(registry), address(adapterRegistry), address(verification), address(ownershipManager));
    }

    function _operational(AccessControl module, bytes32 role, address finalAdmin) private {
        module.grantRole(role, finalAdmin);
        if (module.hasRole(role, address(this))) module.renounceRole(role, address(this));
    }

    function _handoff(AccessControl module, address finalAdmin) private {
        module.grantRole(DEFAULT_ADMIN_ROLE, finalAdmin);
        module.renounceRole(DEFAULT_ADMIN_ROLE, address(this));
    }
}
