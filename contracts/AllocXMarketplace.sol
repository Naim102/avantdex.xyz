// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @dev WARNING: Tokens and onchain admin/ownership rights are NOT legal company ownership.
 * The marketplace cannot force a project to support transfers.
 * Direct ownership/admin handoffs are not atomic: sellers must hand over rights only
 * while the order is Funded and before its deadline.
 */
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {AllocXTransfer, AssetType, Support} from "./AllocXTransfer.sol";
import {AllocXEscrow} from "./AllocXEscrow.sol";

/// @notice Fee-free asset marketplace with USDC escrow and onchain delivery verification.
/// @dev Arc Testnet USDC is 0x3600000000000000000000000000000000000000 (6 decimals).
contract AllocXMarketplace is Ownable2Step, Pausable, ReentrancyGuard {
    enum ListingStatus { None, Active, Pending, Sold, Cancelled }
    enum OrderStatus { None, Funded, Completed, Refunded }

    struct Listing {
        uint256 id;
        address seller;
        AssetType assetType;
        address assetContract;
        uint256 tokenId;
        uint256 amount;
        uint256 price;
        ListingStatus status;
        uint64 createdAt;
        uint256 activeOrderId;
        string name;
        string description;
        string imageUri;
    }

    struct Order {
        uint256 id;
        uint256 listingId;
        address buyer;
        address seller;
        uint256 price;
        OrderStatus status;
        uint64 createdAt;
        uint64 deadline;
        uint64 settledAt;
    }

    AllocXEscrow public immutable escrow;
    AllocXTransfer public immutable transferModule;
    address public immutable usdc;
    uint64 public deliveryWindow = 3 days;
    uint256 public listingCount;
    uint256 public orderCount;

    mapping(uint256 => Listing) private _listings;
    mapping(uint256 => Order) private _orders;
    mapping(address => mapping(bytes32 => uint256)) private committed;

    error ZeroAddress();
    error InvalidName();
    error InvalidDescription();
    error InvalidImageUri();
    error InvalidPrice();
    error InvalidListing();
    error InvalidOrder();
    error InvalidListingStatus();
    error InvalidOrderStatus();
    error Unauthorized();
    error SelfPurchase();
    error Unsupported(Support support);
    error NotDelivered();
    error AlreadyDelivered();
    error DeliveryInFlight();
    error RefundUnavailable();
    error InvalidDeliveryWindow();
    error RenounceDisabled();

    event ListingCreated(
        uint256 indexed id, address indexed seller, AssetType assetType,
        address assetContract, uint256 tokenId, uint256 amount, uint256 price
    );
    event ListingCancelled(uint256 indexed id);
    event OrderFunded(
        uint256 indexed orderId, uint256 indexed listingId, address indexed buyer,
        address seller, uint256 price, uint64 deadline
    );
    event OrderCompleted(uint256 indexed orderId, uint256 indexed listingId, address indexed buyer);
    event OrderRefunded(
        uint256 indexed orderId, uint256 indexed listingId, address indexed buyer, uint8 reason
    );
    event DeliveryWindowUpdated(uint64 w);

    /// @notice Deploys the immutable escrow and transfer module for the selected payment token.
    /// @param usdc_ Arc Testnet USDC: 0x3600000000000000000000000000000000000000.
    /// @param initialOwner Initial two-step administrative owner; cannot withdraw escrowed funds.
    constructor(address usdc_, address initialOwner) Ownable(initialOwner) {
        if (usdc_ == address(0) || initialOwner == address(0)) revert ZeroAddress();
        usdc = usdc_;
        escrow = new AllocXEscrow(usdc_, address(this));
        transferModule = new AllocXTransfer(address(this));
    }

    /// @notice Lists supported assets and reserves the seller's committed balance or rights.
    /// @dev Price is in USDC base units (6 decimals); token approval is granted to transferModule.
    function createListing(
        AssetType assetType, address assetContract, uint256 tokenId, uint256 amount, uint256 price,
        string memory name, string memory description, string memory imageUri
    ) external whenNotPaused returns (uint256 id) {
        if (bytes(name).length == 0 || bytes(name).length > 80) revert InvalidName();
        if (bytes(description).length > 500) revert InvalidDescription();
        if (bytes(imageUri).length > 256) revert InvalidImageUri();
        if (price == 0) revert InvalidPrice();

        id = ++listingCount;
        Listing storage l = _listings[id];
        l.id = id;
        l.seller = msg.sender;
        l.assetType = assetType;
        l.assetContract = assetContract;
        l.tokenId = tokenId;
        l.amount = amount;
        l.price = price;
        l.status = ListingStatus.Active;
        l.createdAt = uint64(block.timestamp);
        l.name = name;
        l.description = description;
        l.imageUri = imageUri;
        _reserve(l);
    }

    /// @notice Cancels only the caller's Active listing, including while paused.
    function cancelListing(uint256 id) external {
        Listing storage l = _listing(id);
        if (msg.sender != l.seller) revert Unauthorized();
        if (l.status != ListingStatus.Active) revert InvalidListingStatus();
        l.status = ListingStatus.Cancelled;
        committed[l.seller][_key(l.assetType, l.assetContract, l.tokenId)] -= l.amount;
        emit ListingCancelled(id);
    }

    /// @notice Funds exactly one order; the buyer must first approve escrow for the listing price.
    function buy(uint256 listingId) external whenNotPaused nonReentrant returns (uint256 orderId) {
        Listing storage l = _listing(listingId);
        if (l.status != ListingStatus.Active) revert InvalidListingStatus();
        if (msg.sender == l.seller) revert SelfPurchase();
        bytes32 key = _key(l.assetType, l.assetContract, l.tokenId);
        _requireSupported(l, committed[l.seller][key] - l.amount);

        orderId = ++orderCount;
        uint64 now_ = uint64(block.timestamp);
        uint64 deadline = now_ + deliveryWindow;
        _orders[orderId] = Order(
            orderId, listingId, msg.sender, l.seller, l.price, OrderStatus.Funded, now_, deadline, 0
        );
        l.status = ListingStatus.Pending;
        l.activeOrderId = orderId;
        escrow.deposit(orderId, msg.sender, l.price);
        emit OrderFunded(orderId, listingId, msg.sender, l.seller, l.price, deadline);
    }

    /// @notice Settles verified delivery, even after the deadline, while the order remains Funded.
    /// @dev Only sellers authorize token pulls. Anyone may verify direct delivery, even while paused.
    /// Failed pulls refund. Direct ownership/admin handoffs are not atomic: sellers must hand over
    /// rights only while the order is Funded and before its deadline.
    function completeOrder(uint256 orderId) external nonReentrant {
        Order storage o = _fundedOrder(orderId);
        Listing storage l = _listings[o.listingId];
        if (transferModule.isDirect(l.assetType)) {
            if (!_delivered(l, o)) revert NotDelivered();
            _complete(l, o);
        } else {
            if (paused()) revert EnforcedPause();
            if (msg.sender != o.seller) revert Unauthorized();
            // Effects precede token callbacks; a reverting subcall rolls back every asset-side effect.
            o.status = OrderStatus.Completed;
            o.settledAt = uint64(block.timestamp);
            try transferModule.executeDelivery(
                l.assetType, l.assetContract, o.seller, o.buyer, l.tokenId, l.amount
            ) {
                _complete(l, o);
            } catch {
                _refund(l, o, 1);
            }
        }
    }

    /// @notice Refunds on seller decline, expiry, or pause; funds always return to the original buyer.
    /// @dev Delivered direct rights must instead settle, including while paused. Pending buyer
    /// nominations block refunds until accepted or cancelled by the seller. Direct ownership/admin
    /// handoffs are not atomic: sellers must hand over rights only while the order is Funded
    /// and before its deadline.
    function refundOrder(uint256 orderId) external nonReentrant {
        Order storage o = _fundedOrder(orderId);
        uint8 reason;
        if (msg.sender == o.seller) reason = 0;
        else if (paused()) reason = 3;
        else if (block.timestamp > o.deadline) reason = 2;
        else revert RefundUnavailable();
        Listing storage l = _listings[o.listingId];
        if (transferModule.isDirect(l.assetType)) {
            if (_delivered(l, o)) revert AlreadyDelivered();
            if (transferModule.isDeliveryInFlight(l.assetType, l.assetContract, o.buyer)) revert DeliveryInFlight();
        }
        _refund(l, o, reason);
    }

    /// @notice Returns a listing or reverts for an invalid ID.
    function getListing(uint256 id) external view returns (Listing memory) {
        return _listing(id);
    }

    /// @notice Returns consecutive listings, clamped to the latest ID; invalid starts return empty.
    function getListings(uint256 fromId, uint256 count) external view returns (Listing[] memory result) {
        uint256 size = _pageSize(fromId, count, listingCount);
        result = new Listing[](size);
        for (uint256 i; i < size; ++i) result[i] = _listings[fromId + i];
    }

    /// @notice Returns an order or reverts for an invalid ID.
    function getOrder(uint256 id) external view returns (Order memory) {
        return _order(id);
    }

    /// @notice Returns consecutive orders, clamped to the latest ID; invalid starts return empty.
    function getOrders(uint256 fromId, uint256 count) external view returns (Order[] memory result) {
        uint256 size = _pageSize(fromId, count, orderCount);
        result = new Order[](size);
        for (uint256 i; i < size; ++i) result[i] = _orders[fromId + i];
    }

    /// @notice Assesses a prospective listing against all current reservations of this asset.
    function previewListing(
        AssetType assetType, address assetContract, uint256 tokenId, uint256 amount, address seller
    ) external view returns (Support) {
        return transferModule.assess(
            assetType, assetContract, seller, tokenId, amount,
            committed[seller][_key(assetType, assetContract, tokenId)]
        );
    }

    /// @notice Assesses deliverability, excluding this listing's reservation only if it is live.
    /// @dev Sold/Cancelled listings are assessed as prospective listings, not treated as still reserved.
    function checkListing(uint256 listingId) external view returns (Support) {
        Listing storage l = _listing(listingId);
        uint256 others = committed[l.seller][_key(l.assetType, l.assetContract, l.tokenId)];
        if (l.status == ListingStatus.Active || l.status == ListingStatus.Pending) others -= l.amount;
        return transferModule.assess(l.assetType, l.assetContract, l.seller, l.tokenId, l.amount, others);
    }

    /// @notice Returns the seller's reserved amount across Active and Pending listings.
    function committedAmount(address seller, AssetType assetType, address assetContract, uint256 tokenId)
        external view returns (uint256)
    {
        return committed[seller][_key(assetType, assetContract, tokenId)];
    }

    /// @notice Pauses creation, purchase, and token completion; direct settlement and eligible refunds remain available.
    function pause() external onlyOwner { _pause(); }

    /// @notice Restores creation, purchase, and completion.
    function unpause() external onlyOwner { _unpause(); }

    /// @notice Sets the delivery period for future orders only, between one hour and thirty days.
    function setDeliveryWindow(uint64 w) external onlyOwner {
        if (w < 1 hours || w > 30 days) revert InvalidDeliveryWindow();
        deliveryWindow = w;
        emit DeliveryWindowUpdated(w);
    }

    /// @notice Ownership renunciation is disabled to preserve pause recovery.
    function renounceOwnership() public override onlyOwner { revert RenounceDisabled(); }

    function _reserve(Listing storage l) private {
        bytes32 key = _key(l.assetType, l.assetContract, l.tokenId);
        uint256 others = committed[l.seller][key];
        _requireSupported(l, others);
        committed[l.seller][key] = others + l.amount;
        emit ListingCreated(l.id, l.seller, l.assetType, l.assetContract, l.tokenId, l.amount, l.price);
    }

    function _requireSupported(Listing storage l, uint256 others) private view {
        Support support = transferModule.assess(
            l.assetType, l.assetContract, l.seller, l.tokenId, l.amount, others
        );
        if (support != Support.Ok) revert Unsupported(support);
    }

    function _delivered(Listing storage l, Order storage o) private view returns (bool) {
        return transferModule.isDelivered(
            l.assetType, l.assetContract, o.seller, o.buyer, l.tokenId, l.amount
        );
    }

    function _complete(Listing storage l, Order storage o) private {
        o.status = OrderStatus.Completed;
        o.settledAt = uint64(block.timestamp);
        l.status = ListingStatus.Sold;
        l.activeOrderId = 0;
        committed[l.seller][_key(l.assetType, l.assetContract, l.tokenId)] -= l.amount;
        escrow.release(o.id, o.seller);
        emit OrderCompleted(o.id, o.listingId, o.buyer);
    }

    function _refund(Listing storage l, Order storage o, uint8 reason) private {
        o.status = OrderStatus.Refunded;
        o.settledAt = uint64(block.timestamp);
        if (l.status == ListingStatus.Pending) l.status = ListingStatus.Active;
        l.activeOrderId = 0;
        escrow.refund(o.id);
        emit OrderRefunded(o.id, o.listingId, o.buyer, reason);
    }

    function _listing(uint256 id) private view returns (Listing storage l) {
        if (id == 0 || id > listingCount) revert InvalidListing();
        return _listings[id];
    }

    function _order(uint256 id) private view returns (Order storage o) {
        if (id == 0 || id > orderCount) revert InvalidOrder();
        return _orders[id];
    }

    function _fundedOrder(uint256 id) private view returns (Order storage o) {
        o = _order(id);
        if (o.status != OrderStatus.Funded) revert InvalidOrderStatus();
    }

    function _key(AssetType t, address asset, uint256 tokenId) private pure returns (bytes32) {
        return keccak256(abi.encode(t, asset, tokenId));
    }

    function _pageSize(uint256 fromId, uint256 count, uint256 last) private pure returns (uint256) {
        if (fromId == 0 || fromId > last) return 0;
        uint256 remaining = last - fromId + 1;
        return count < remaining ? count : remaining;
    }
}
