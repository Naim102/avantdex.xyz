// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

// ---------------------------------------------------------------------------
// AllocX shared types and module interfaces. Every module imports this file.
// ---------------------------------------------------------------------------

/// Kinds of transferable asset or right. The first three are token kinds that are
/// delivered by the AssetManager (seller approval + pull). The rest are control
/// rights that the SELLER hands over directly on the target contract; the
/// OwnershipManager then verifies the resulting state onchain.
enum AssetKind {
    ERC20, // 0  amount > 0
    ERC721, // 1  id = tokenId, amount = 1
    ERC1155, // 2  id = tokenId, amount > 0
    OWNABLE, // 3  target.owner() must become the buyer (single step transferOwnership)
    OWNABLE_2STEP, // 4  Ownable2Step: buyer must acceptOwnership() before settlement
    ACCESS_ROLE, // 5  id = uint256(bytes32 role); hasRole(role, buyer) && !hasRole(role, seller)
    ADAPTER // 6  project specific; `adapter` must be approved for `target` in the AdapterRegistry
}

enum ProjectStatus {
    None,
    Pending,
    Active,
    Suspended,
    Rejected
}

enum ProjectCategory {
    FullProject,
    SmartContract,
    AdminRole,
    Token,
    NFT,
    MultiToken,
    Airdrop,
    OtherRight,
    Bundle
}

enum ListingStatus {
    None,
    Active,
    Reserved,
    Sold,
    Cancelled
}

enum OrderStatus {
    None,
    Funded,
    Settled,
    Refunded,
    Disputed
}

enum VerificationMethod {
    None,
    Ownable,
    AccessControl,
    Attestation
}

struct Item {
    AssetKind kind;
    address target; // token contract or governed contract
    uint256 id; // tokenId, or uint256(role) for ACCESS_ROLE, or adapter key
    uint256 amount; // ERC20 / ERC1155 quantity, 1 for ERC721, 0 for control rights
    address adapter; // only for ADAPTER, otherwise address(0)
    bytes32 extra; // adapter specific, otherwise 0
}

struct Project {
    address submitter;
    address mainContract;
    address claimedOwner; // CLAIMED at submission, never trusted
    address verifiedOwner; // LIVE value: the current owner() of mainContract if it is Ownable, else 0. Not proof of an AllocX sale.
    ProjectCategory category;
    ProjectStatus status;
    bytes32 metadataHash;
    uint64 createdAt;
}

struct Listing {
    uint256 projectId;
    address seller;
    uint256 price; // USDC, 6 decimals (ERC-20 view)
    uint64 createdAt;
    uint64 expiry;
    uint32 settlementWindow; // seconds the seller has to deliver after a buyer funds escrow
    bool autoSettle; // seller consents to atomic pull of token items at purchase time
    ListingStatus status;
    bytes32 itemsHash; // keccak256(abi.encode(items))
    bytes32 metadataHash;
    uint256 orderId; // current / last order, 0 if none
}

struct Order {
    uint256 listingId;
    uint256 projectId;
    address buyer;
    address seller;
    uint256 price;
    uint64 createdAt;
    uint64 deadline; // seller delivery deadline
    OrderStatus status;
    bytes32 itemsHash;
}

/// EIP-712 typed data signed by the seller to authorise Settlement to pull the
/// token items of one specific order. Bound to order, buyer, items, nonce, deadline.
struct SaleAuthorization {
    uint256 orderId;
    address seller;
    address buyer;
    bytes32 itemsHash;
    uint256 price; // agreed order price in USDC (6 decimals)
    address settlement; // the Settlement contract this authorisation is valid for
    uint256 nonce;
    uint64 deadline;
}

/// EIP-712 typed data signed by an ATTESTOR_ROLE holder.
struct OwnershipAttestation {
    uint256 projectId;
    address subject;
    bytes32 claimHash;
    uint64 expiry;
    uint256 nonce;
}

interface IAllocXAdapter {
    /// Read-only. Adapters never custody anything and never execute transfers.
    function isController(address target, uint256 id, bytes32 extra, address account) external view returns (bool);
    function isPendingController(address target, uint256 id, bytes32 extra, address account) external view returns (bool);
    function describe() external view returns (string memory);
}

interface IAllocXAdapterRegistry {
    function isApproved(address adapter, address target) external view returns (bool);
}

interface IAllocXProjectRegistry {
    function projectCount() external view returns (uint256);
    function getProject(uint256 projectId) external view returns (Project memory);
    function projectOfContract(address c) external view returns (uint256);
    function projectAdmin(uint256 projectId) external view returns (address);
    function isActive(uint256 projectId) external view returns (bool);
}

interface IAllocXVerification {
    /// Pure validation, no state: reverts on bad signature (EOA or ERC-1271) or expired deadline.
    /// Nonce replay protection is enforced by Settlement.
    function verifySaleAuthorization(SaleAuthorization calldata auth, bytes calldata signature) external view;
}

interface IAllocXFeeManager {
    function feeBps(uint256 projectId) external view returns (uint16);
    function quote(uint256 projectId, uint256 amount) external view returns (uint256 fee, uint256 net);
    /// onlyRole(ESCROW_ROLE). USDC `gross` must already have been transferred to this contract.
    /// `feeBpsSnapshot` is the fee captured when the order was funded (must be <= MAX_FEE_BPS).
    function distribute(address seller, uint256 gross, uint256 projectId, uint16 feeBpsSnapshot)
        external
        returns (uint256 fee, uint256 net);
}

interface IAllocXAssetManager {
    function controls(Item calldata item, address account, bool requireApproval) external view returns (bool);
    /// onlyRole(SETTLEMENT_ROLE). Pulls the token item from `from` to `to`; reverts if less than the item amount arrived.
    function pull(Item calldata item, address from, address to) external;
}

interface IAllocXOwnershipManager {
    function controls(Item calldata item, address account) external view returns (bool);
    function isTransferred(Item calldata item, address from, address to) external view returns (bool);
    function isPending(Item calldata item, address to) external view returns (bool);
}

interface IAllocXEscrow {
    /// onlyRole(SETTLEMENT_ROLE)
    /// Snapshots feeManager.feeBps(projectId) at deposit time.
    function deposit(uint256 orderId, address payer, uint256 amount, uint256 projectId) external;
    function release(uint256 orderId, address seller) external returns (uint256 fee, uint256 net);
    function refund(uint256 orderId) external returns (uint256 amount);
    function heldAmount(uint256 orderId) external view returns (uint256);
}

interface IAllocXMarketplace {
    function getListing(uint256 listingId) external view returns (Listing memory);
    function getItems(uint256 listingId) external view returns (Item[] memory);
    /// onlyRole(SETTLEMENT_ROLE)
    function onOrderSettled(uint256 listingId) external;
    function onOrderReopened(uint256 listingId) external;
}

interface IAllocXSettlement {
    function getOrder(uint256 orderId) external view returns (Order memory);
    /// Durable evidence: true if the seller claimed delivery (every control item was verified transferred at claim
    /// time) and the bundle has no token items. Later ownership changes do NOT invalidate it.
    /// Used by DisputeManager to decide the timeout outcome.
    function deliveryVerified(uint256 orderId) external view returns (bool);
    /// True if delivery was claimed on a bundle that also contains token items. Such disputes can only be settled
    /// by an arbitrator ruling, never by the automatic timeout.
    function requiresManualRuling(uint256 orderId) external view returns (bool);
    /// onlyMarketplace
    function openOrder(uint256 listingId, address buyer) external returns (uint256 orderId);
    /// onlyRole(DISPUTE_ROLE)
    function markDisputed(uint256 orderId) external;
    function resolveDispute(uint256 orderId, bool releaseToSeller) external;
}
