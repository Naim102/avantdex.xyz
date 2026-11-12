// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @dev WARNING: Tokens and onchain admin/ownership rights are NOT legal company ownership.
 * The marketplace cannot force a project to support transfers.
 */
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {IERC1155} from "@openzeppelin/contracts/token/ERC1155/IERC1155.sol";
import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";

enum AssetType { ERC20, ERC721, ERC1155, OWNABLE, ACCESS_CONTROL_ADMIN }
enum Support { Ok, UnsupportedContract, NotHolder, NotAuthorized, InsufficientBalance, BadParams }

/// @notice Assesses assets and atomically verifies token delivery for one marketplace.
contract AllocXTransfer {
    using SafeERC20 for IERC20;

    address public immutable marketplace;
    bytes4 private constant OWNER = bytes4(keccak256("owner()"));
    bytes4 private constant HAS_ROLE = bytes4(keccak256("hasRole(bytes32,address)"));

    error Unauthorized();
    error ZeroAddress();
    error DirectAsset();
    error DeliveryFailed();

    modifier onlyMarketplace() {
        if (msg.sender != marketplace) revert Unauthorized();
        _;
    }

    /// @notice Binds this module permanently to its marketplace.
    constructor(address marketplace_) {
        if (marketplace_ == address(0)) revert ZeroAddress();
        marketplace = marketplace_;
    }

    /// @notice Checks holdings, reservations and approvals without decoding untrusted ABI data.
    /// @dev Each probe has a 100,000 gas budget and copies at most one return word.
    function assess(
        AssetType t, address asset, address seller, uint256 tokenId,
        uint256 amount, uint256 committedByOthers
    ) external view returns (Support) {
        if (amount == 0) return Support.BadParams;
        if (t != AssetType.ERC20 && t != AssetType.ERC1155 && amount != 1) return Support.BadParams;
        if (t != AssetType.ERC721 && t != AssetType.ERC1155 && tokenId != 0) return Support.BadParams;
        if (asset.code.length == 0) return Support.UnsupportedContract;
        if (committedByOthers > type(uint256).max - amount) return Support.InsufficientBalance;
        uint256 needed = committedByOthers + amount;

        if (t == AssetType.ERC20) return _assessERC20(asset, seller, needed);
        if (t == AssetType.ERC721) return _assessERC721(asset, seller, tokenId, committedByOthers);
        if (t == AssetType.ERC1155) return _assessERC1155(asset, seller, tokenId, needed);

        // Two-step handoffs (pendingOwner / pendingDefaultAdmin) cannot be settled safely
        // without custody, so contracts exposing them are reported as unsupported.
        if (t == AssetType.OWNABLE) {
            (bool pending, ) = _word(asset, abi.encodeWithSelector(bytes4(keccak256("pendingOwner()"))));
            if (pending) return Support.UnsupportedContract;
            (bool ok, address holder) = _address(asset, abi.encodeWithSelector(OWNER));
            if (!ok) return Support.UnsupportedContract;
            if (holder != seller) return Support.NotHolder;
        } else {
            (bool pending, ) = _word(asset, abi.encodeWithSelector(bytes4(keccak256("pendingDefaultAdmin()"))));
            if (pending) return Support.UnsupportedContract;
            (bool ok, bool holder) = _bool(asset, abi.encodeWithSelector(HAS_ROLE, bytes32(0), seller));
            if (!ok) return Support.UnsupportedContract;
            if (!holder) return Support.NotHolder;
        }
        return committedByOthers == 0 ? Support.Ok : Support.InsufficientBalance;
    }

    /// @notice Returns whether the seller must transfer rights directly on the asset contract.
    function isDirect(AssetType t) public pure returns (bool) {
        return t == AssetType.OWNABLE || t == AssetType.ACCESS_CONTROL_ADMIN;
    }

    /// @notice Verifies direct ownership delivery or exclusive seller-to-buyer admin handoff.
    /// @dev Ownable2Step delivery is recognized only after the buyer accepts ownership.
    function isDelivered(
        AssetType t, address asset, address seller, address buyer, uint256, uint256
    ) external view returns (bool) {
        if (asset.code.length == 0 || buyer == address(0)) return false;
        if (t == AssetType.OWNABLE) {
            (bool ok, address holder) = _address(asset, abi.encodeWithSelector(OWNER));
            return ok && holder == buyer;
        }
        if (t == AssetType.ACCESS_CONTROL_ADMIN) {
            (bool okBuyer, bool buyerHas) = _bool(asset, abi.encodeWithSelector(HAS_ROLE, bytes32(0), buyer));
            (bool okSeller, bool sellerHas) = _bool(asset, abi.encodeWithSelector(HAS_ROLE, bytes32(0), seller));
            return okBuyer && okSeller && buyerHas && !sellerHas;
        }
        return false;
    }

    /// @notice Detects an ownership or default-admin nomination awaiting buyer acceptance.
    /// @dev Probes use the same bounded gas and one-word return buffer as delivery checks.
    /// Unsupported getters, failed calls and token types return false.
    function isDeliveryInFlight(AssetType t, address asset, address buyer) external view returns (bool) {
        if (asset.code.length == 0 || buyer == address(0)) return false;
        bytes4 selector;
        if (t == AssetType.OWNABLE) selector = bytes4(keccak256("pendingOwner()"));
        else if (t == AssetType.ACCESS_CONTROL_ADMIN) selector = bytes4(keccak256("pendingDefaultAdmin()"));
        else return false;
        (bool ok, address nominee) = _address(asset, abi.encodeWithSelector(selector));
        return ok && nominee == buyer;
    }

    /// @notice Pulls approved tokens and reverts atomically unless exact delivery is verified.
    function executeDelivery(
        AssetType t, address asset, address seller, address buyer, uint256 tokenId, uint256 amount
    ) external onlyMarketplace {
        if (buyer == address(0)) revert ZeroAddress();
        if (isDirect(t)) revert DirectAsset();
        if (t == AssetType.ERC20) {
            IERC20 token = IERC20(asset);
            uint256 buyerBefore = token.balanceOf(buyer);
            uint256 sellerBefore = token.balanceOf(seller);
            token.safeTransferFrom(seller, buyer, amount);
            uint256 buyerAfter = token.balanceOf(buyer);
            uint256 sellerAfter = token.balanceOf(seller);
            if (buyerAfter < buyerBefore || buyerAfter - buyerBefore != amount
                || sellerAfter > sellerBefore || sellerBefore - sellerAfter != amount) revert DeliveryFailed();
        } else if (t == AssetType.ERC721) {
            IERC721(asset).safeTransferFrom(seller, buyer, tokenId);
            if (IERC721(asset).ownerOf(tokenId) != buyer) revert DeliveryFailed();
        } else {
            IERC1155 token = IERC1155(asset);
            uint256 beforeBalance = token.balanceOf(buyer, tokenId);
            token.safeTransferFrom(seller, buyer, tokenId, amount, "");
            uint256 afterBalance = token.balanceOf(buyer, tokenId);
            if (afterBalance < beforeBalance || afterBalance - beforeBalance != amount) revert DeliveryFailed();
        }
    }

    function _assessERC20(address asset, address seller, uint256 needed) private view returns (Support) {
        (bool okBalance, uint256 balance) = _word(asset, abi.encodeCall(IERC20.balanceOf, (seller)));
        (bool okAllowance, uint256 allowance) = _word(asset, abi.encodeCall(IERC20.allowance, (seller, address(this))));
        if (!okBalance || !okAllowance) return Support.UnsupportedContract;
        if (balance < needed) return Support.InsufficientBalance;
        return allowance >= needed ? Support.Ok : Support.NotAuthorized;
    }

    function _assessERC721(address asset, address seller, uint256 id, uint256 reserved)
        private view returns (Support)
    {
        if (!_supports(asset, 0x80ac58cd)) return Support.UnsupportedContract;
        (bool okOwner, address holder) = _address(asset, abi.encodeCall(IERC721.ownerOf, (id)));
        if (!okOwner) return Support.UnsupportedContract;
        if (holder != seller) return Support.NotHolder;
        (bool okApproval, address approved) = _address(asset, abi.encodeCall(IERC721.getApproved, (id)));
        if (!okApproval) return Support.UnsupportedContract;
        if (approved != address(this)) {
            (bool okAll, bool approvedAll) = _bool(asset, abi.encodeCall(IERC721.isApprovedForAll, (seller, address(this))));
            if (!okAll) return Support.UnsupportedContract;
            if (!approvedAll) return Support.NotAuthorized;
        }
        return reserved == 0 ? Support.Ok : Support.InsufficientBalance;
    }

    function _assessERC1155(address asset, address seller, uint256 id, uint256 needed)
        private view returns (Support)
    {
        if (!_supports(asset, 0xd9b67a26)) return Support.UnsupportedContract;
        (bool okBalance, uint256 balance) = _word(asset, abi.encodeCall(IERC1155.balanceOf, (seller, id)));
        if (!okBalance) return Support.UnsupportedContract;
        if (balance < needed) return Support.InsufficientBalance;
        (bool okAll, bool approvedAll) = _bool(asset, abi.encodeCall(IERC1155.isApprovedForAll, (seller, address(this))));
        if (!okAll) return Support.UnsupportedContract;
        return approvedAll ? Support.Ok : Support.NotAuthorized;
    }

    function _supports(address asset, bytes4 interfaceId) private view returns (bool) {
        (bool ok, bool supported) = _bool(asset, abi.encodeCall(IERC165.supportsInterface, (interfaceId)));
        return ok && supported;
    }

    function _bool(address asset, bytes memory data) private view returns (bool ok, bool value) {
        uint256 word;
        (ok, word) = _word(asset, data);
        return (ok && word <= 1, word == 1);
    }

    function _address(address asset, bytes memory data) private view returns (bool ok, address value) {
        uint256 word;
        (ok, word) = _word(asset, data);
        return (ok && word <= type(uint160).max, address(uint160(word)));
    }

    function _word(address asset, bytes memory data) private view returns (bool ok, uint256 value) {
        // A bounded output buffer also rejects return-data bombs without allocating their payload.
        assembly ("memory-safe") {
            let output := mload(0x40)
            ok := staticcall(100000, asset, add(data, 0x20), mload(data), output, 0x20)
            ok := and(ok, iszero(lt(returndatasize(), 0x20)))
            value := mload(output)
        }
    }
}
