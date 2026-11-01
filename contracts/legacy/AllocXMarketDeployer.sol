// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {AllocXFeeManager} from "./AllocXFeeManager.sol";
import {AllocXAssetManager} from "./AllocXAssetManager.sol";
import {AllocXEscrow} from "./AllocXEscrow.sol";
import {AllocXMarketplace} from "./AllocXMarketplace.sol";
import {AllocXSettlement} from "./AllocXSettlement.sol";
import {AllocXDisputeManager} from "./AllocXDisputeManager.sol";

/// @title AllocXMarketDeployer
/// @notice Constructor-only bootstrapper that creates and wires the six AllocX market modules.
/// @dev No privileges are retained. Existing core modules are used without granting cross-group roles.
contract AllocXMarketDeployer is AccessControl {
    AllocXFeeManager public feeManager;
    AllocXAssetManager public assetManager;
    AllocXEscrow public escrow;
    AllocXMarketplace public marketplace;
    AllocXSettlement public settlement;
    AllocXDisputeManager public disputeManager;

    error InvalidFinalAdmin();
    error ZeroAddress();
    error InvalidContract();

    event MarketDeployed(address feeManager, address assetManager, address escrow,
        address marketplace, address settlement, address disputeManager);

    /// @notice Creates market modules, wires service roles, and hands all administration to finalAdmin.
    /// @param finalAdmin Final administrator, normally a multisig; never this bootstrapper.
    /// @param usdc USDC ERC-20 contract (all prices use its six-decimal ERC-20 amounts).
    /// @param treasury Seller-fee recipient.
    /// @param defaultFeeBps Default seller fee in basis points.
    /// @param registry Existing core project registry.
    /// @param verification Existing core signature-verification module.
    /// @param ownershipManager Existing core control-right verification module.
    constructor(address finalAdmin, address usdc, address treasury, uint16 defaultFeeBps,
        address registry, address verification, address ownershipManager)
    {
        if (finalAdmin == address(0) || finalAdmin == address(this)) revert InvalidFinalAdmin();
        if (usdc == address(0) || treasury == address(0) || registry == address(0)
            || verification == address(0) || ownershipManager == address(0)) revert ZeroAddress();
        if (registry.code.length == 0 || verification.code.length == 0
            || ownershipManager.code.length == 0) revert InvalidContract();

        feeManager = new AllocXFeeManager(address(this), usdc, treasury, defaultFeeBps);
        assetManager = new AllocXAssetManager(address(this));
        escrow = new AllocXEscrow(address(this), usdc, address(feeManager));
        marketplace = new AllocXMarketplace(address(this), registry, address(assetManager), ownershipManager);
        settlement = new AllocXSettlement(
            address(this), address(marketplace), address(escrow), address(assetManager),
            ownershipManager, verification
        );
        disputeManager = new AllocXDisputeManager(address(this), address(settlement));

        escrow.grantRole(escrow.SETTLEMENT_ROLE(), address(settlement));
        feeManager.grantRole(feeManager.ESCROW_ROLE(), address(escrow));
        assetManager.grantRole(assetManager.SETTLEMENT_ROLE(), address(settlement));
        marketplace.grantRole(marketplace.SETTLEMENT_ROLE(), address(settlement));
        marketplace.setSettlement(address(settlement));
        settlement.grantRole(settlement.DISPUTE_ROLE(), address(disputeManager));

        _operational(feeManager, feeManager.FEE_ADMIN_ROLE(), finalAdmin);
        _operational(marketplace, marketplace.PAUSER_ROLE(), finalAdmin);
        _operational(marketplace, marketplace.MODERATOR_ROLE(), finalAdmin);
        _operational(settlement, settlement.PAUSER_ROLE(), finalAdmin);
        _operational(disputeManager, disputeManager.ARBITRATOR_ROLE(), finalAdmin);

        // Remove any service roles constructors granted to the bootstrapper.
        _renounceIfHeld(feeManager, feeManager.ESCROW_ROLE());
        _renounceIfHeld(assetManager, assetManager.SETTLEMENT_ROLE());
        _renounceIfHeld(escrow, escrow.SETTLEMENT_ROLE());
        _renounceIfHeld(marketplace, marketplace.SETTLEMENT_ROLE());
        _renounceIfHeld(settlement, settlement.DISPUTE_ROLE());

        _handoff(feeManager, finalAdmin);
        _handoff(assetManager, finalAdmin);
        _handoff(escrow, finalAdmin);
        _handoff(marketplace, finalAdmin);
        _handoff(settlement, finalAdmin);
        _handoff(disputeManager, finalAdmin);

        emit MarketDeployed(address(feeManager), address(assetManager), address(escrow),
            address(marketplace), address(settlement), address(disputeManager));
    }

    function _operational(AccessControl module, bytes32 role, address finalAdmin) private {
        module.grantRole(role, finalAdmin);
        _renounceIfHeld(module, role);
    }

    function _renounceIfHeld(AccessControl module, bytes32 role) private {
        if (module.hasRole(role, address(this))) module.renounceRole(role, address(this));
    }

    function _handoff(AccessControl module, address finalAdmin) private {
        module.grantRole(DEFAULT_ADMIN_ROLE, finalAdmin);
        module.renounceRole(DEFAULT_ADMIN_ROLE, address(this));
    }
}
