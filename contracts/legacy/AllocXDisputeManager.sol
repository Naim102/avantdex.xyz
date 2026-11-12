// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Order, OrderStatus, IAllocXSettlement} from "./interfaces/IAllocX.sol";

/// @notice Participant-opened disputes with arbitrator rulings and a delivery-aware timeout default.
contract AllocXDisputeManager is AccessControl, ReentrancyGuard {
    bytes32 public constant ARBITRATOR_ROLE = keccak256("ARBITRATOR_ROLE");
    uint256 public constant RESOLUTION_TIMEOUT = 14 days;

    enum DisputeStatus { Open, ResolvedSeller, ResolvedBuyer, Expired }

    struct Dispute {
        uint256 orderId;
        address opener;
        uint64 openedAt;
        DisputeStatus status;
        bytes32 rulingHash;
    }

    IAllocXSettlement public immutable settlement;
    mapping(uint256 orderId => Dispute) public disputes;

    error ZeroAddress();
    error InvalidSettlement();
    error NotParticipant();
    error OrderNotFunded();
    error DisputeAlreadyExists();
    error DisputeNotOpen();
    error TimeoutNotReached();
    error ManualRulingRequired();

    event DisputeOpened(
        uint256 indexed orderId, address indexed opener, uint64 openedAt,
        bytes32 reasonHash, string reasonURI
    );
    event EvidenceSubmitted(uint256 indexed orderId, address indexed submitter, string uri);
    event DisputeResolved(uint256 indexed orderId, bool releaseToSeller, bytes32 rulingHash);
    event DisputeExpired(uint256 indexed orderId);

    constructor(address admin, address settlement_) {
        if (admin == address(0) || settlement_ == address(0)) revert ZeroAddress();
        if (settlement_.code.length == 0) revert InvalidSettlement();
        settlement = IAllocXSettlement(settlement_);
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
    }

    /// @notice A funded order's buyer or seller can open exactly one dispute.
    function openDispute(uint256 orderId, bytes32 reasonHash, string calldata reasonURI)
        external nonReentrant
    {
        if (disputes[orderId].opener != address(0)) revert DisputeAlreadyExists();
        Order memory order = settlement.getOrder(orderId);
        _requireParticipant(order);
        if (order.status != OrderStatus.Funded) revert OrderNotFunded();
        uint64 openedAt = uint64(block.timestamp);
        disputes[orderId] = Dispute(orderId, msg.sender, openedAt, DisputeStatus.Open, bytes32(0));
        settlement.markDisputed(orderId);
        emit DisputeOpened(orderId, msg.sender, openedAt, reasonHash, reasonURI);
    }

    /// @notice Publishes evidence for the indexer while a dispute remains open.
    function submitEvidence(uint256 orderId, string calldata uri) external nonReentrant {
        _requireOpen(orderId);
        _requireParticipant(settlement.getOrder(orderId));
        emit EvidenceSubmitted(orderId, msg.sender, uri);
    }

    /// @notice An arbitrator resolves an open dispute to either seller release or buyer refund.
    function resolve(uint256 orderId, bool releaseToSeller, bytes32 rulingHash)
        external onlyRole(ARBITRATOR_ROLE) nonReentrant
    {
        _requireOpen(orderId);
        Dispute storage dispute = disputes[orderId];
        dispute.status = releaseToSeller ? DisputeStatus.ResolvedSeller : DisputeStatus.ResolvedBuyer;
        dispute.rulingHash = rulingHash;
        settlement.resolveDispute(orderId, releaseToSeller);
        emit DisputeResolved(orderId, releaseToSeller, rulingHash);
    }

    /// @notice After fourteen unresolved days, release on claimed control-only delivery, refund if unclaimed, or require a ruling for claimed token bundles.
    /// @dev Delivery may be claimed during the dispute; later ownership changes do not erase that evidence.
    /// Claimed token bundles stay in escrow until an ARBITRATOR_ROLE ruling; the admin can grant that role to unblock.
    function expireDispute(uint256 orderId) external nonReentrant {
        _requireOpen(orderId);
        Dispute storage dispute = disputes[orderId];
        if (block.timestamp <= uint256(dispute.openedAt) + RESOLUTION_TIMEOUT) {
            revert TimeoutNotReached();
        }
        if (settlement.requiresManualRuling(orderId)) revert ManualRulingRequired();
        dispute.status = DisputeStatus.Expired;
        settlement.resolveDispute(orderId, settlement.deliveryVerified(orderId));
        emit DisputeExpired(orderId);
    }

    /// @notice Returns the recorded dispute, reverting if none has been opened.
    function getDispute(uint256 orderId) external view returns (Dispute memory) {
        if (disputes[orderId].opener == address(0)) revert DisputeNotOpen();
        return disputes[orderId];
    }

    function _requireOpen(uint256 orderId) private view {
        Dispute storage dispute = disputes[orderId];
        if (dispute.opener == address(0) || dispute.status != DisputeStatus.Open) {
            revert DisputeNotOpen();
        }
    }

    function _requireParticipant(Order memory order) private view {
        if (msg.sender != order.buyer && msg.sender != order.seller) revert NotParticipant();
    }
}
