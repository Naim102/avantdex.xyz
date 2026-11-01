// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {
    AssetKind, Item, IAllocXAdapter, IAllocXAdapterRegistry, IAllocXOwnershipManager
} from "./interfaces/IAllocX.sol";

/// @notice Read-only checks of project control rights; never executes a handover.
contract AllocXOwnershipManager is AccessControl, IAllocXOwnershipManager {
    IAllocXAdapterRegistry public immutable adapterRegistry;

    error ZeroAddress();
    error InvalidRegistry();

    constructor(address admin, address adapterRegistry_) {
        if (admin == address(0) || adapterRegistry_ == address(0)) revert ZeroAddress();
        if (adapterRegistry_.code.length == 0) revert InvalidRegistry();
        adapterRegistry = IAllocXAdapterRegistry(adapterRegistry_);
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
    }

    /// @notice Returns whether this module handles the supplied control-right kind.
    function supportsKind(AssetKind kind) public pure returns (bool) {
        return kind == AssetKind.OWNABLE || kind == AssetKind.OWNABLE_2STEP
            || kind == AssetKind.ACCESS_ROLE || kind == AssetKind.ADAPTER;
    }

    /// @inheritdoc IAllocXOwnershipManager
    function controls(Item calldata item, address account) external view override returns (bool) {
        if (account == address(0) || item.target.code.length == 0) return false;
        if (item.kind == AssetKind.OWNABLE || item.kind == AssetKind.OWNABLE_2STEP) {
            return _isOwner(item.target, account);
        }
        if (item.kind == AssetKind.ACCESS_ROLE) return _hasRole(item, account);
        if (item.kind == AssetKind.ADAPTER) {
            return _approved(item) && _isController(item, account);
        }
        return false;
    }

    /// @inheritdoc IAllocXOwnershipManager
    function isTransferred(Item calldata item, address from, address to)
        external view override returns (bool)
    {
        if (to == address(0) || from == to || item.target.code.length == 0) return false;
        if (item.kind == AssetKind.OWNABLE) return _isOwner(item.target, to);
        if (item.kind == AssetKind.OWNABLE_2STEP) {
            if (!_isOwner(item.target, to)) return false;
            try Ownable2Step(item.target).pendingOwner() returns (address pending) {
                return pending != to;
            } catch { return false; }
        }
        if (item.kind == AssetKind.ACCESS_ROLE) {
            // Both calls must succeed: a failed old-controller query is not proof of revocation.
            try IAccessControl(item.target).hasRole(bytes32(item.id), to) returns (bool hasTo) {
                if (!hasTo) return false;
            } catch { return false; }
            try IAccessControl(item.target).hasRole(bytes32(item.id), from) returns (bool hasFrom) {
                return !hasFrom;
            } catch { return false; }
        }
        if (item.kind == AssetKind.ADAPTER) {
            if (!_approved(item) || !_isController(item, to)) return false;
            try IAllocXAdapter(item.adapter).isController(item.target, item.id, item.extra, from)
                returns (bool hasFrom)
            {
                return !hasFrom;
            } catch { return false; }
        }
        return false;
    }

    /// @inheritdoc IAllocXOwnershipManager
    function isPending(Item calldata item, address to) external view override returns (bool) {
        if (to == address(0) || item.target.code.length == 0) return false;
        if (item.kind == AssetKind.OWNABLE_2STEP) {
            try Ownable2Step(item.target).pendingOwner() returns (address pending) {
                return pending == to;
            } catch { return false; }
        }
        if (item.kind == AssetKind.ADAPTER && _approved(item)) {
            try IAllocXAdapter(item.adapter).isPendingController(item.target, item.id, item.extra, to)
                returns (bool pending)
            {
                return pending;
            } catch { return false; }
        }
        return false;
    }

    function _isOwner(address target, address account) private view returns (bool) {
        try Ownable(target).owner() returns (address owner) {
            return owner == account;
        } catch { return false; }
    }

    function _hasRole(Item calldata item, address account) private view returns (bool) {
        try IAccessControl(item.target).hasRole(bytes32(item.id), account) returns (bool has) {
            return has;
        } catch { return false; }
    }

    function _approved(Item calldata item) private view returns (bool) {
        if (item.adapter.code.length == 0) return false;
        try adapterRegistry.isApproved(item.adapter, item.target) returns (bool approved) {
            return approved;
        } catch { return false; }
    }

    function _isController(Item calldata item, address account) private view returns (bool) {
        try IAllocXAdapter(item.adapter).isController(item.target, item.id, item.extra, account)
            returns (bool controlled)
        {
            return controlled;
        } catch { return false; }
    }
}
