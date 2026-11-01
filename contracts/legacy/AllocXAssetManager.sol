// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {IERC1155} from "@openzeppelin/contracts/token/ERC1155/IERC1155.sol";
import {AssetKind, Item, IAllocXAssetManager} from "./interfaces/IAllocX.sol";

/// @notice Checks token control and delivers seller-approved assets for Settlement.
contract AllocXAssetManager is AccessControl, ReentrancyGuard, IAllocXAssetManager {
    using SafeERC20 for IERC20;

    bytes32 public constant SETTLEMENT_ROLE = keccak256("SETTLEMENT_ROLE");

    error ZeroAddress();
    error UnsupportedKind();
    error InvalidAmount();
    error DeliveryShortfall();
    error OwnershipNotTransferred();

    event AssetPulled(
        address indexed target, address indexed from, address indexed to,
        AssetKind kind, uint256 id, uint256 amount
    );

    constructor(address admin) {
        if (admin == address(0)) revert ZeroAddress();
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
    }

    /// @inheritdoc IAllocXAssetManager
    function controls(Item calldata item, address account, bool requireApproval)
        external view override returns (bool)
    {
        if (account == address(0) || item.target.code.length == 0) return false;
        if (item.kind == AssetKind.ERC20) {
            if (item.amount == 0) return false;
            try IERC20(item.target).balanceOf(account) returns (uint256 balance) {
                if (balance < item.amount) return false;
            } catch { return false; }
            if (!requireApproval) return true;
            try IERC20(item.target).allowance(account, address(this)) returns (uint256 allowance) {
                return allowance >= item.amount;
            } catch { return false; }
        }
        if (item.kind == AssetKind.ERC721) {
            if (item.amount != 1) return false;
            try IERC721(item.target).ownerOf(item.id) returns (address owner) {
                if (owner != account) return false;
            } catch { return false; }
            if (!requireApproval) return true;
            try IERC721(item.target).getApproved(item.id) returns (address approved) {
                if (approved == address(this)) return true;
            } catch { return false; }
            try IERC721(item.target).isApprovedForAll(account, address(this)) returns (bool approved) {
                return approved;
            } catch { return false; }
        }
        if (item.kind == AssetKind.ERC1155) {
            if (item.amount == 0) return false;
            try IERC1155(item.target).balanceOf(account, item.id) returns (uint256 balance) {
                if (balance < item.amount) return false;
            } catch { return false; }
            if (!requireApproval) return true;
            try IERC1155(item.target).isApprovedForAll(account, address(this)) returns (bool approved) {
                return approved;
            } catch { return false; }
        }
        return false;
    }

    /// @inheritdoc IAllocXAssetManager
    function pull(Item calldata item, address from, address to)
        external override onlyRole(SETTLEMENT_ROLE) nonReentrant
    {
        if (from == address(0) || to == address(0)) revert ZeroAddress();
        if (item.kind == AssetKind.ERC20) {
            if (item.amount == 0) revert InvalidAmount();
            IERC20 token = IERC20(item.target);
            uint256 beforeBalance = token.balanceOf(to);
            token.safeTransferFrom(from, to, item.amount);
            uint256 afterBalance = token.balanceOf(to);
            if (afterBalance < beforeBalance || afterBalance - beforeBalance < item.amount) {
                revert DeliveryShortfall();
            }
        } else if (item.kind == AssetKind.ERC721) {
            if (item.amount != 1) revert InvalidAmount();
            IERC721 token = IERC721(item.target);
            token.safeTransferFrom(from, to, item.id);
            if (token.ownerOf(item.id) != to) revert OwnershipNotTransferred();
        } else if (item.kind == AssetKind.ERC1155) {
            if (item.amount == 0) revert InvalidAmount();
            IERC1155 token = IERC1155(item.target);
            uint256 beforeBalance = token.balanceOf(to, item.id);
            token.safeTransferFrom(from, to, item.id, item.amount, "");
            uint256 afterBalance = token.balanceOf(to, item.id);
            if (afterBalance < beforeBalance || afterBalance - beforeBalance < item.amount) {
                revert DeliveryShortfall();
            }
        } else {
            revert UnsupportedKind();
        }
        emit AssetPulled(item.target, from, to, item.kind, item.id, item.amount);
    }
}
