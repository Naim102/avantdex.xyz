// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {
    AssetKind, Item, Listing, ListingStatus, Order, OrderStatus, SaleAuthorization,
    IAllocXMarketplace, IAllocXSettlement, IAllocXEscrow, IAllocXAssetManager,
    IAllocXOwnershipManager, IAllocXVerification
} from "./interfaces/IAllocX.sol";

/// @dev Namespaces the refund error separately from the DeliveryClaimed event.
library AllocXDeliveryErrors {
    error DeliveryClaimed();
}

/// @title AllocXSettlement
/// @notice Funds purchases, verifies delivery onchain, and settles or refunds escrow.
contract AllocXSettlement is AccessControl, Pausable, ReentrancyGuard, IAllocXSettlement {
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");
    bytes32 public constant DISPUTE_ROLE = keccak256("DISPUTE_ROLE");

    IAllocXMarketplace public immutable marketplace;
    IAllocXEscrow public immutable escrow;
    IAllocXAssetManager public immutable assetManager;
    IAllocXOwnershipManager public immutable ownershipManager;
    IAllocXVerification public immutable verification;
    uint256 public orderCount;
    mapping(uint256 => Order) private _orders;
    mapping(uint256 => uint256) public currentOrderForListing;
    /// @notice Seller-authorization nonces consumed by this Settlement instance.
    mapping(address seller => mapping(uint256 nonce => bool)) public usedNonces;
    /// @notice Whether the seller has claimed verified delivery of this order's control rights.
    mapping(uint256 => bool) public deliveryClaimed;

    error ZeroAddress();
    error InvalidContract();
    error OnlyMarketplace();
    error InvalidReservation();
    error InvalidOrder();
    error InvalidStatus();
    error NotSeller();
    error AuthorizationMismatch();
    error NonceAlreadyUsed(address signer, uint256 nonce);
    error SellerAuthorizationRequired();
    error OwnershipNotTransferred(uint256 index);
    error RefundNotAvailable();
    error AlreadyDelivered();
    error DeliveryNotVerified();
    error ItemsHashMismatch();

    event OrderOpened(uint256 indexed orderId, uint256 indexed listingId, uint256 indexed projectId,
        address buyer, address seller, uint256 price, uint64 deadline, bytes32 itemsHash);
    /// @notice Settlement ownership history, including the project and committed bundle hash.
    event OrderSettled(uint256 indexed orderId, uint256 indexed listingId, uint256 indexed projectId,
        address buyer, address seller, bytes32 itemsHash, uint256 fee, uint256 net, bool controlTransferred);
    event SaleAuthorizationConsumed(uint256 indexed orderId, address indexed seller, address indexed buyer,
        bytes32 itemsHash, uint256 nonce, uint64 deadline);
    event OrderRefunded(uint256 indexed orderId, uint256 indexed listingId, address indexed buyer,
        uint256 amount, bytes32 reason);
    event DeliveryClaimed(uint256 indexed orderId);
    event OrderDisputed(uint256 indexed orderId);
    event DisputeResolved(uint256 indexed orderId, bool releaseToSeller);

    constructor(address admin, address marketplace_, address escrow_, address assetManager_,
        address ownershipManager_, address verification_)
    {
        if (admin == address(0) || marketplace_ == address(0) || escrow_ == address(0)
            || assetManager_ == address(0) || ownershipManager_ == address(0)
            || verification_ == address(0)) revert ZeroAddress();
        if (marketplace_.code.length == 0 || escrow_.code.length == 0 || assetManager_.code.length == 0
            || ownershipManager_.code.length == 0 || verification_.code.length == 0) revert InvalidContract();
        marketplace = IAllocXMarketplace(marketplace_);
        escrow = IAllocXEscrow(escrow_);
        assetManager = IAllocXAssetManager(assetManager_);
        ownershipManager = IAllocXOwnershipManager(ownershipManager_);
        verification = IAllocXVerification(verification_);
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
    }

    /// @notice Opens a reserved listing's purchase. Only Marketplace may choose the buyer.
    function openOrder(uint256 listingId, address buyer)
        external override whenNotPaused nonReentrant returns (uint256 orderId)
    {
        if (msg.sender != address(marketplace)) revert OnlyMarketplace();
        Listing memory listing = marketplace.getListing(listingId);
        if (listing.status != ListingStatus.Reserved || buyer == address(0) || buyer == listing.seller) revert InvalidReservation();
        uint256 previous = currentOrderForListing[listingId];
        if (previous != 0 && _orders[previous].status != OrderStatus.Refunded) revert InvalidReservation();
        if (listing.orderId != 0 && (listing.orderId != previous || _orders[listing.orderId].status != OrderStatus.Refunded)) {
            revert InvalidReservation();
        }
        orderId = ++orderCount;
        uint64 deadline = uint64(block.timestamp + listing.settlementWindow);
        _orders[orderId] = Order({
            listingId: listingId, projectId: listing.projectId, buyer: buyer, seller: listing.seller,
            price: listing.price, createdAt: uint64(block.timestamp), deadline: deadline,
            status: OrderStatus.Funded, itemsHash: listing.itemsHash
        });
        currentOrderForListing[listingId] = orderId;
        escrow.deposit(orderId, buyer, listing.price, listing.projectId);
        emit OrderOpened(orderId, listingId, listing.projectId, buyer, listing.seller,
            listing.price, deadline, listing.itemsHash);
        if (listing.autoSettle) _complete(orderId, true);
    }

    /// @notice Seller authorizes delivery of this order's token items by calling directly.
    function settleBySeller(uint256 orderId) external whenNotPaused nonReentrant {
        Order storage order = _order(orderId);
        if (msg.sender != order.seller) revert NotSeller();
        _complete(orderId, true);
    }

    /// @notice Relays a seller's order-, price- and Settlement-bound EIP-712 authorization to pull tokens once per nonce.
    function settleWithAuthorization(uint256 orderId, SaleAuthorization calldata auth, bytes calldata sig)
        external whenNotPaused nonReentrant
    {
        Order storage order = _order(orderId);
        if (order.status != OrderStatus.Funded) revert InvalidStatus();
        if (auth.orderId != orderId || auth.seller != order.seller || auth.buyer != order.buyer
            || auth.itemsHash != order.itemsHash || auth.price != order.price
            || auth.settlement != address(this)) revert AuthorizationMismatch();
        verification.verifySaleAuthorization(auth, sig);
        if (usedNonces[auth.seller][auth.nonce]) revert NonceAlreadyUsed(auth.seller, auth.nonce);
        usedNonces[auth.seller][auth.nonce] = true;
        emit SaleAuthorizationConsumed(auth.orderId, auth.seller, auth.buyer, auth.itemsHash,
            auth.nonce, auth.deadline);
        _complete(orderId, true);
    }

    /// @notice Permissionlessly confirms a fully transferred, control-only bundle.
    function confirm(uint256 orderId) external whenNotPaused nonReentrant { _complete(orderId, false); }

    /// @notice Seller claims delivery after every control right in a funded or disputed order is verified transferred.
    /// @dev Mixed bundles may be claimed, but claims alone do not verify token delivery.
    function claimDelivery(uint256 orderId) external nonReentrant {
        Order storage order = _order(orderId);
        if (msg.sender != order.seller) revert NotSeller();
        if (order.status != OrderStatus.Funded && order.status != OrderStatus.Disputed) revert InvalidStatus();
        (, bool hasControl, bool allTransferred) = _deliveryState(_orderItems(order), order.seller, order.buyer);
        if (!hasControl || !allTransferred) revert DeliveryNotVerified();
        deliveryClaimed[orderId] = true;
        emit DeliveryClaimed(orderId);
    }

    /// @notice Returns durable delivery evidence when the seller claimed delivery and the bundle has no token items.
    /// @dev Control transfers are verified at claim time, not rechecked against later ownership changes.
    function deliveryVerified(uint256 orderId) public view override returns (bool) {
        if (!deliveryClaimed[orderId]) return false;
        Item[] memory items = _orderItems(_order(orderId));
        for (uint256 i; i < items.length; ++i) {
            if (_isToken(items[i])) return false;
        }
        return true;
    }

    /// @notice Requires an arbitrator ruling when delivery was claimed and the bundle contains token items.
    function requiresManualRuling(uint256 orderId) external view override returns (bool) {
        return deliveryClaimed[orderId] && !deliveryVerified(orderId);
    }

    /// @notice Seller may refund anytime; others may refund after the deadline only if delivery is unclaimed.
    /// @dev Non-sellers must confirm fully delivered control-only bundles instead. Never pause-gated.
    function refund(uint256 orderId) external nonReentrant {
        Order storage order = _order(orderId);
        if (order.status != OrderStatus.Funded) revert InvalidStatus();
        if (msg.sender != order.seller) {
            if (deliveryClaimed[orderId]) revert AllocXDeliveryErrors.DeliveryClaimed();
            if (block.timestamp <= order.deadline) revert RefundNotAvailable();
            Item[] memory items = _orderItems(order);
            (bool hasTokens, bool hasControl, bool allTransferred) = _deliveryState(items, order.seller, order.buyer);
            if (!hasTokens && hasControl && allTransferred) revert AlreadyDelivered();
        }
        bytes32 reason = msg.sender == order.seller ? keccak256("SELLER_REFUND") : keccak256("DEADLINE_EXPIRED");
        _refund(orderId, order, reason);
    }

    /// @notice Locks a funded order until the authorized dispute module resolves it.
    function markDisputed(uint256 orderId) external override onlyRole(DISPUTE_ROLE) nonReentrant {
        Order storage order = _order(orderId);
        if (order.status != OrderStatus.Funded) revert InvalidStatus();
        order.status = OrderStatus.Disputed;
        emit OrderDisputed(orderId);
    }

    /// @notice Applies an arbitration ruling. A ruling may release funds without proving delivery.
    /// @dev The settlement event reports control transfer only if all control rights are actually transferred.
    function resolveDispute(uint256 orderId, bool releaseToSeller)
        external override onlyRole(DISPUTE_ROLE) nonReentrant
    {
        Order storage order = _order(orderId);
        if (order.status != OrderStatus.Disputed) revert InvalidStatus();
        if (releaseToSeller) {
            Item[] memory items = _orderItems(order);
            (, bool hasControl, bool allTransferred) = _deliveryState(items, order.seller, order.buyer);
            order.status = OrderStatus.Settled;
            _release(orderId, order, hasControl && allTransferred);
        } else {
            _refund(orderId, order, keccak256("DISPUTE_REFUND"));
        }
        emit DisputeResolved(orderId, releaseToSeller);
    }

    /// @notice Returns an existing order's recorded terms and status.
    function getOrder(uint256 orderId) external view override returns (Order memory) { return _order(orderId); }

    /// @notice Returns this order's immutable listing bundle, checked against its committed hash.
    function orderItemsFor(uint256 orderId) external view returns (Item[] memory) { return _orderItems(_order(orderId)); }

    /// @notice Pauses order opening and normal settlement, but never refunds or dispute resolution.
    function pause() external onlyRole(PAUSER_ROLE) { _pause(); }
    /// @notice Resumes order opening and normal settlement.
    function unpause() external onlyRole(PAUSER_ROLE) { _unpause(); }

    function _complete(uint256 orderId, bool allowPull) private {
        Order storage order = _order(orderId);
        if (order.status != OrderStatus.Funded) revert InvalidStatus();
        Item[] memory items = _orderItems(order);
        // Funded is the only time restriction: after the deadline, settle and refund race.
        // Set the terminal state before any token delivery or external state-changing call.
        order.status = OrderStatus.Settled;
        bool hasControl;
        for (uint256 i; i < items.length; ++i) {
            if (_isToken(items[i])) {
                if (!allowPull) revert SellerAuthorizationRequired();
                assetManager.pull(items[i], order.seller, order.buyer);
            } else {
                hasControl = true;
                if (!ownershipManager.isTransferred(items[i], order.seller, order.buyer)) revert OwnershipNotTransferred(i);
            }
        }
        // Token receiver hooks can change control state checked earlier in the bundle.
        // Recheck every control item after all token transfers have finished.
        if (hasControl) {
            for (uint256 i; i < items.length; ++i) {
                if (!_isToken(items[i]) && !ownershipManager.isTransferred(items[i], order.seller, order.buyer)) {
                    revert OwnershipNotTransferred(i);
                }
            }
        }
        _release(orderId, order, hasControl);
    }

    function _release(uint256 orderId, Order storage order, bool controlTransferred) private {
        (uint256 fee, uint256 net) = escrow.release(orderId, order.seller);
        marketplace.onOrderSettled(order.listingId);
        emit OrderSettled(orderId, order.listingId, order.projectId, order.buyer, order.seller,
            order.itemsHash, fee, net, controlTransferred);
    }

    function _refund(uint256 orderId, Order storage order, bytes32 reason) private {
        order.status = OrderStatus.Refunded;
        uint256 amount = escrow.refund(orderId);
        marketplace.onOrderReopened(order.listingId);
        emit OrderRefunded(orderId, order.listingId, order.buyer, amount, reason);
    }

    function _order(uint256 orderId) private view returns (Order storage order) {
        order = _orders[orderId];
        if (order.status == OrderStatus.None) revert InvalidOrder();
    }

    function _orderItems(Order storage order) private view returns (Item[] memory items) {
        items = marketplace.getItems(order.listingId);
        if (items.length == 0 || keccak256(abi.encode(items)) != order.itemsHash) revert ItemsHashMismatch();
    }

    function _isToken(Item memory item) private pure returns (bool) {
        return uint8(item.kind) <= uint8(AssetKind.ERC1155);
    }

    function _deliveryState(Item[] memory items, address seller, address buyer)
        private view returns (bool hasTokens, bool hasControl, bool allTransferred)
    {
        allTransferred = true;
        for (uint256 i; i < items.length; ++i) {
            if (_isToken(items[i])) hasTokens = true;
            else {
                hasControl = true;
                if (!ownershipManager.isTransferred(items[i], seller, buyer)) allTransferred = false;
            }
        }
    }
}
