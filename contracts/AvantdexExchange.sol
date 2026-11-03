// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title AvantdexExchange
 * @notice Pre-market (pre-TGE) order book with USDC escrow and atomic token settlement on Arc.
 *
 * Money model
 *  - Resting orders live on-chain and lock funds when placed (buy: value + buyer fee; sell: value as collateral).
 *  - A taker supplies maker order ids; fills execute at the MAKER's price (partial fills supported).
 *  - A trade escrows buyer payment + buyer fee and the seller's collateral (= trade value).
 *  - After TGE a market manager opens settlement with the token address. The seller settles atomically:
 *    tokens go seller -> buyer (balance-delta verified) and USDC is released. If the seller does not deliver
 *    before the deadline, the buyer claims payment + seller collateral.
 *  - Platform fee: 0.5% buyer + 0.5% seller, charged ONLY when a trade settles, paid in USDC to `feeCollector`.
 *    Cancelled orders, defaults, refunds and reverted transactions never pay a platform fee.
 *
 * Trust model
 *  - No role can withdraw or redirect escrowed funds. Managers can only move markets through their status
 *    machine; every exit (cancel order, settle, default claim, refund) stays open to users.
 *  - USDC on Arc reverts for blocklisted accounts, so every payout is push-with-fallback to `claimable`.
 *  - The contract accepts no native value.
 *
 * NOT AUDITED. Testnet use only.
 */
contract AvantdexExchange is AccessControl, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ------------------------------------------------------------------ constants

    bytes32 public constant MARKET_MANAGER_ROLE = keccak256("MARKET_MANAGER_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");

    uint256 public constant BPS = 10_000;
    /// @notice Buyer fee on a successful (settled) trade: 0.5%.
    uint256 public constant BUYER_FEE_BPS = 50;
    /// @notice Seller fee on a successful (settled) trade: 0.5%.
    uint256 public constant SELLER_FEE_BPS = 50;

    uint64 public constant MIN_TRADING_DURATION = 1 hours;
    uint64 public constant MIN_SETTLEMENT_WINDOW = 1 hours;
    uint64 public constant MAX_SETTLEMENT_WINDOW = 14 days;
    /// @notice Total settlement time (including extensions) can never exceed this after settlement opens.
    uint64 public constant MAX_SETTLEMENT_TOTAL = 30 days;
    /// @notice If a market never reaches settlement, anyone can refund trades this long after trading end.
    uint64 public constant ABANDON_DELAY = 90 days;
    /// @notice Minimum order value in USDC base units (1 USDC, 6 decimals).
    uint256 public constant MIN_ORDER_VALUE = 1_000_000;
    uint256 public constant MAX_BATCH = 50;

    // ------------------------------------------------------------------ types

    enum MarketStatus { None, Setup, Live, Suspended, SettlementOpen, Completed, Cancelled }
    enum Side { Buy, Sell }
    enum OrderStatus { None, Open, Filled, Cancelled, Expired }
    enum TradeStatus { None, Open, Settled, Defaulted, Refunded }
    enum CancelReason { Owner, Expired, IocRemainder }

    struct Market {
        MarketStatus status;
        address token; // zero until known; must be set (or confirmed) when settlement opens
        uint64 tradingStart;
        uint64 tradingEnd;
        uint64 settlementOpenedAt;
        uint64 settlementDeadline;
        uint128 lotSize; // token base units per lot
        uint128 tickSize; // USDC base units; prices must be multiples of this
        uint128 minLots;
        uint128 maxLots;
        uint32 openTrades;
        bytes32 metadataRef; // keccak256(slug) of the off-chain market record
    }

    struct Order {
        address owner;
        Side side;
        OrderStatus status;
        uint256 marketId;
        uint128 price; // USDC base units per lot
        uint128 lots;
        uint128 filled;
        uint128 locked; // USDC still locked for the unfilled part
        uint64 expiry;
    }

    struct Trade {
        uint256 marketId;
        address buyer;
        address seller;
        uint128 lots;
        uint128 price;
        uint128 value; // price * lots
        uint128 buyerFee; // charged only on settlement
        uint128 sellerFee; // charged only on settlement
        TradeStatus status;
    }

    struct Taker {
        address who;
        Side side;
        uint128 price;
        uint128 remaining;
        uint128 filled;
        uint256 pull; // USDC to pull from the taker at the end
    }

    // ------------------------------------------------------------------ storage

    IERC20 public immutable usdc;
    address public feeCollector;

    uint256 public marketCount;
    uint256 public orderCount;
    uint256 public tradeCount;

    mapping(uint256 => Market) private _markets;
    mapping(uint256 => Order) private _orders;
    mapping(uint256 => Trade) private _trades;
    mapping(address => uint256) public claimable;

    // ------------------------------------------------------------------ events

    event MarketCreated(
        uint256 indexed marketId,
        bytes32 indexed metadataRef,
        address token,
        uint128 lotSize,
        uint128 tickSize,
        uint128 minLots,
        uint128 maxLots,
        uint64 tradingStart,
        uint64 tradingEnd
    );
    event MarketStatusChanged(uint256 indexed marketId, MarketStatus status);
    event SettlementOpened(uint256 indexed marketId, address token, uint64 openedAt, uint64 deadline);
    event SettlementExtended(uint256 indexed marketId, uint64 oldDeadline, uint64 newDeadline);
    event OrderPlaced(
        uint256 indexed orderId,
        uint256 indexed marketId,
        address indexed owner,
        Side side,
        uint128 price,
        uint128 lots,
        uint64 expiry,
        bool ioc
    );
    event OrderCancelled(uint256 indexed orderId, CancelReason reason, uint128 refunded);
    event TradeExecuted(
        uint256 indexed tradeId,
        uint256 indexed marketId,
        uint256 buyOrderId,
        uint256 sellOrderId,
        address buyer,
        address seller,
        uint128 lots,
        uint128 price,
        uint128 value,
        uint128 buyerFee,
        uint128 sellerFee
    );
    event TradeSettled(uint256 indexed tradeId, uint256 sellerPayout, uint256 feesPaid);
    event FeeCollected(uint256 indexed tradeId, address indexed collector, uint256 amount);
    event TradeDefaulted(uint256 indexed tradeId, uint256 buyerPayout);
    event TradeRefunded(uint256 indexed tradeId, uint256 buyerAmount, uint256 sellerAmount);
    event ClaimableCredited(address indexed account, uint256 amount);
    event ClaimableWithdrawn(address indexed account, uint256 amount);
    event FeeCollectorUpdated(address indexed previous, address indexed current);

    // ------------------------------------------------------------------ errors

    error ZeroAddress();
    error InvalidMarketParams();
    error InvalidMarketStatus();
    error MarketNotFound();
    error MarketNotTradable();
    error InvalidPrice();
    error InvalidSize();
    error InvalidExpiry();
    error TooManyItems();
    error NotOrderOwner();
    error OrderNotOpen();
    error NothingFilled();
    error TradeNotOpen();
    error NotSeller();
    error NotBuyer();
    error SettlementNotOpen();
    error DeadlineNotReached();
    error InvalidSettlementWindow();
    error InvalidExtension();
    error TokenMismatch();
    error NotAContract();
    error DeliveryNotVerified();
    error TradesStillOpen();
    error NotRefundable();
    error NothingToClaim();
    error PullShortfall();
    error Overflow();

    // ------------------------------------------------------------------ constructor

    /**
     * @param usdc_ Arc USDC ERC-20 (testnet: 0x3600000000000000000000000000000000000000, 6 decimals).
     * @param feeCollector_ Address that receives every platform fee.
     * @param admin_ Receives DEFAULT_ADMIN_ROLE, MARKET_MANAGER_ROLE and PAUSER_ROLE.
     */
    constructor(address usdc_, address feeCollector_, address admin_) {
        if (usdc_ == address(0) || feeCollector_ == address(0) || admin_ == address(0)) revert ZeroAddress();
        usdc = IERC20(usdc_);
        feeCollector = feeCollector_;
        _grantRole(DEFAULT_ADMIN_ROLE, admin_);
        _grantRole(MARKET_MANAGER_ROLE, admin_);
        _grantRole(PAUSER_ROLE, admin_);
        emit FeeCollectorUpdated(address(0), feeCollector_);
    }

    // ------------------------------------------------------------------ admin

    /// @notice Changes where platform fees are paid. Cannot touch escrowed funds.
    function setFeeCollector(address newCollector) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (newCollector == address(0)) revert ZeroAddress();
        emit FeeCollectorUpdated(feeCollector, newCollector);
        feeCollector = newCollector;
    }

    /// @notice Blocks NEW orders only. Cancels, settlement, default claims and refunds stay open.
    function pause() external onlyRole(PAUSER_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(PAUSER_ROLE) {
        _unpause();
    }

    // ------------------------------------------------------------------ market management

    function createMarket(
        address token,
        uint128 lotSize,
        uint128 tickSize,
        uint128 minLots,
        uint128 maxLots,
        uint64 tradingStart,
        uint64 tradingEnd,
        bytes32 metadataRef
    ) external onlyRole(MARKET_MANAGER_ROLE) returns (uint256 marketId) {
        if (lotSize == 0 || tickSize == 0 || minLots == 0 || maxLots < minLots) revert InvalidMarketParams();
        if (tradingEnd <= block.timestamp || tradingEnd < tradingStart + MIN_TRADING_DURATION) {
            revert InvalidMarketParams();
        }
        if (token != address(0) && token.code.length == 0) revert NotAContract();

        marketId = ++marketCount;
        Market storage m = _markets[marketId];
        m.status = MarketStatus.Setup;
        m.token = token;
        m.lotSize = lotSize;
        m.tickSize = tickSize;
        m.minLots = minLots;
        m.maxLots = maxLots;
        m.tradingStart = tradingStart;
        m.tradingEnd = tradingEnd;
        m.metadataRef = metadataRef;

        emit MarketCreated(marketId, metadataRef, token, lotSize, tickSize, minLots, maxLots, tradingStart, tradingEnd);
        emit MarketStatusChanged(marketId, MarketStatus.Setup);
    }

    function activateMarket(uint256 marketId) external onlyRole(MARKET_MANAGER_ROLE) {
        Market storage m = _market(marketId);
        if (m.status != MarketStatus.Setup) revert InvalidMarketStatus();
        m.status = MarketStatus.Live;
        emit MarketStatusChanged(marketId, MarketStatus.Live);
    }

    function suspendMarket(uint256 marketId) external onlyRole(MARKET_MANAGER_ROLE) {
        Market storage m = _market(marketId);
        if (m.status != MarketStatus.Live) revert InvalidMarketStatus();
        m.status = MarketStatus.Suspended;
        emit MarketStatusChanged(marketId, MarketStatus.Suspended);
    }

    function resumeMarket(uint256 marketId) external onlyRole(MARKET_MANAGER_ROLE) {
        Market storage m = _market(marketId);
        if (m.status != MarketStatus.Suspended) revert InvalidMarketStatus();
        m.status = MarketStatus.Live;
        emit MarketStatusChanged(marketId, MarketStatus.Live);
    }

    /// @notice TGE cancelled: every open trade becomes refundable with no fee and no penalty.
    function cancelMarket(uint256 marketId) external onlyRole(MARKET_MANAGER_ROLE) {
        Market storage m = _market(marketId);
        MarketStatus s = m.status;
        if (s == MarketStatus.Completed || s == MarketStatus.Cancelled) revert InvalidMarketStatus();
        m.status = MarketStatus.Cancelled;
        emit MarketStatusChanged(marketId, MarketStatus.Cancelled);
    }

    /**
     * @notice Opens settlement after TGE. Stops trading. If the market already has a token address, the same
     * address must be supplied (it cannot be swapped after trading started).
     */
    function openSettlement(uint256 marketId, address token, uint64 windowSeconds)
        external
        onlyRole(MARKET_MANAGER_ROLE)
    {
        Market storage m = _market(marketId);
        if (m.status != MarketStatus.Live && m.status != MarketStatus.Suspended) revert InvalidMarketStatus();
        if (windowSeconds < MIN_SETTLEMENT_WINDOW || windowSeconds > MAX_SETTLEMENT_WINDOW) {
            revert InvalidSettlementWindow();
        }
        if (token == address(0) || token.code.length == 0) revert NotAContract();
        if (m.token != address(0) && m.token != token) revert TokenMismatch();

        m.token = token;
        m.status = MarketStatus.SettlementOpen;
        m.settlementOpenedAt = uint64(block.timestamp);
        m.settlementDeadline = uint64(block.timestamp) + windowSeconds;

        emit SettlementOpened(marketId, token, m.settlementOpenedAt, m.settlementDeadline);
        emit MarketStatusChanged(marketId, MarketStatus.SettlementOpen);
    }

    /// @notice Delayed delivery: extends the deadline, bounded by MAX_SETTLEMENT_TOTAL after settlement opened.
    function extendSettlement(uint256 marketId, uint64 newDeadline) external onlyRole(MARKET_MANAGER_ROLE) {
        Market storage m = _market(marketId);
        if (m.status != MarketStatus.SettlementOpen) revert InvalidMarketStatus();
        if (newDeadline <= m.settlementDeadline || newDeadline > m.settlementOpenedAt + MAX_SETTLEMENT_TOTAL) {
            revert InvalidExtension();
        }
        emit SettlementExtended(marketId, m.settlementDeadline, newDeadline);
        m.settlementDeadline = newDeadline;
    }

    function completeMarket(uint256 marketId) external onlyRole(MARKET_MANAGER_ROLE) {
        Market storage m = _market(marketId);
        if (m.status != MarketStatus.SettlementOpen) revert InvalidMarketStatus();
        if (m.openTrades != 0) revert TradesStillOpen();
        m.status = MarketStatus.Completed;
        emit MarketStatusChanged(marketId, MarketStatus.Completed);
    }

    // ------------------------------------------------------------------ trading

    /**
     * @notice Places a limit or immediate-or-cancel (market-style) order.
     * @param makerIds Resting opposite-side orders to match against, best price first (supplied by the caller).
     *        Ineligible entries (filled, expired, own, non-crossing, other market) are skipped.
     * @param ioc If true the unfilled remainder is discarded (never rests). `price` then acts as the worst
     *        acceptable price (price cap / floor) and `minFillLots` as the slippage guard.
     * @param minFillLots Reverts unless at least this many lots fill (must be >= 1 for IOC orders).
     * @return orderId The new order id.
     * @return filledLots Lots filled during this call.
     */
    function placeOrder(
        uint256 marketId,
        Side side,
        uint128 price,
        uint128 lots,
        uint64 expiry,
        bool ioc,
        uint128 minFillLots,
        uint256[] calldata makerIds
    ) external whenNotPaused nonReentrant returns (uint256 orderId, uint128 filledLots) {
        Market storage m = _market(marketId);
        if (m.status != MarketStatus.Live || block.timestamp < m.tradingStart || block.timestamp >= m.tradingEnd) {
            revert MarketNotTradable();
        }
        if (price == 0 || price % m.tickSize != 0) revert InvalidPrice();
        if (lots < m.minLots || lots > m.maxLots) revert InvalidSize();
        if (uint256(price) * lots < MIN_ORDER_VALUE) revert InvalidSize();
        if (expiry <= block.timestamp || expiry > m.tradingEnd) revert InvalidExpiry();
        if (makerIds.length > MAX_BATCH) revert TooManyItems();
        if (ioc && minFillLots == 0) revert NothingFilled();

        orderId = ++orderCount;
        Order storage o = _orders[orderId];
        o.owner = msg.sender;
        o.side = side;
        o.status = OrderStatus.Open;
        o.marketId = marketId;
        o.price = price;
        o.lots = lots;
        o.expiry = expiry;
        emit OrderPlaced(orderId, marketId, msg.sender, side, price, lots, expiry, ioc);

        Taker memory t = Taker({who: msg.sender, side: side, price: price, remaining: lots, filled: 0, pull: 0});
        for (uint256 i; i < makerIds.length && t.remaining > 0; ++i) {
            _match(marketId, orderId, t, makerIds[i], m);
        }

        if (t.filled < minFillLots) revert NothingFilled();
        o.filled = t.filled;

        if (t.remaining == 0) {
            o.status = OrderStatus.Filled;
        } else if (ioc) {
            o.status = OrderStatus.Cancelled;
            emit OrderCancelled(orderId, CancelReason.IocRemainder, 0);
        } else {
            uint256 value = uint256(price) * t.remaining;
            uint256 lockAmount = side == Side.Buy ? value + _fee(value) : value;
            if (lockAmount > type(uint128).max) revert Overflow();
            o.locked = uint128(lockAmount);
            t.pull += lockAmount;
        }

        if (t.pull > 0) _pullUsdc(msg.sender, t.pull);
        filledLots = t.filled;
    }

    /// @notice Owner cancels an open order and gets the full remaining lock back (fee 0). Always allowed.
    function cancelOrder(uint256 orderId) external nonReentrant {
        Order storage o = _orders[orderId];
        if (o.status != OrderStatus.Open) revert OrderNotOpen();
        if (o.owner != msg.sender) revert NotOrderOwner();
        _closeOrder(orderId, o, OrderStatus.Cancelled, CancelReason.Owner);
    }

    /// @notice Anyone can clean up expired orders; funds always return to the order owner.
    function expireOrders(uint256[] calldata orderIds) external nonReentrant {
        if (orderIds.length > MAX_BATCH) revert TooManyItems();
        for (uint256 i; i < orderIds.length; ++i) {
            Order storage o = _orders[orderIds[i]];
            if (o.status == OrderStatus.Open && block.timestamp >= o.expiry) {
                _closeOrder(orderIds[i], o, OrderStatus.Expired, CancelReason.Expired);
            }
        }
    }

    // ------------------------------------------------------------------ settlement

    /**
     * @notice Seller delivers the token atomically and is paid. Allowed after settlement opened, also after the
     * deadline, until the buyer claims the default.
     */
    function settleTrade(uint256 tradeId) external nonReentrant {
        Trade storage t = _trades[tradeId];
        if (t.status != TradeStatus.Open) revert TradeNotOpen();
        if (msg.sender != t.seller) revert NotSeller();
        Market storage m = _markets[t.marketId];
        if (m.status != MarketStatus.SettlementOpen) revert SettlementNotOpen();

        // effects
        t.status = TradeStatus.Settled;
        m.openTrades -= 1;

        // atomic delivery, verified by the buyer's balance delta
        IERC20 token = IERC20(m.token);
        uint256 amount = uint256(t.lots) * m.lotSize;
        uint256 beforeBal = token.balanceOf(t.buyer);
        token.safeTransferFrom(t.seller, t.buyer, amount);
        uint256 afterBal = token.balanceOf(t.buyer);
        if (afterBal < beforeBal || afterBal - beforeBal != amount) revert DeliveryNotVerified();

        // payouts: seller gets payment + collateral - seller fee; collector gets both fees
        uint256 fees = uint256(t.buyerFee) + t.sellerFee;
        uint256 sellerPayout = 2 * uint256(t.value) - t.sellerFee;
        _pay(t.seller, sellerPayout);
        _pay(feeCollector, fees);

        emit TradeSettled(tradeId, sellerPayout, fees);
        emit FeeCollected(tradeId, feeCollector, fees);
    }

    /// @notice Buyer claims payment + seller collateral after the settlement deadline. No platform fee.
    function claimDefault(uint256 tradeId) external nonReentrant {
        Trade storage t = _trades[tradeId];
        if (t.status != TradeStatus.Open) revert TradeNotOpen();
        if (msg.sender != t.buyer) revert NotBuyer();
        Market storage m = _markets[t.marketId];
        if (m.status != MarketStatus.SettlementOpen) revert SettlementNotOpen();
        if (block.timestamp <= m.settlementDeadline) revert DeadlineNotReached();

        t.status = TradeStatus.Defaulted;
        m.openTrades -= 1;

        uint256 payout = 2 * uint256(t.value) + t.buyerFee; // payment + fee reserve + collateral
        _pay(t.buyer, payout);
        emit TradeDefaulted(tradeId, payout);
    }

    /// @notice Cancelled or abandoned market: both sides get their own funds back. No fee, no penalty.
    function refundTrade(uint256 tradeId) external nonReentrant {
        Trade storage t = _trades[tradeId];
        if (t.status != TradeStatus.Open) revert TradeNotOpen();
        Market storage m = _markets[t.marketId];
        if (!_isRefundable(m)) revert NotRefundable();

        t.status = TradeStatus.Refunded;
        m.openTrades -= 1;

        uint256 buyerAmount = uint256(t.value) + t.buyerFee;
        uint256 sellerAmount = t.value;
        _pay(t.buyer, buyerAmount);
        _pay(t.seller, sellerAmount);
        emit TradeRefunded(tradeId, buyerAmount, sellerAmount);
    }

    /// @notice Withdraws USDC that could not be pushed earlier (for example because the account was blocklisted).
    function withdrawClaimable() external nonReentrant {
        uint256 amount = claimable[msg.sender];
        if (amount == 0) revert NothingToClaim();
        claimable[msg.sender] = 0;
        usdc.safeTransfer(msg.sender, amount);
        emit ClaimableWithdrawn(msg.sender, amount);
    }

    // ------------------------------------------------------------------ views

    function getMarket(uint256 marketId) external view returns (Market memory) {
        if (_markets[marketId].status == MarketStatus.None) revert MarketNotFound();
        return _markets[marketId];
    }

    function getOrder(uint256 orderId) external view returns (Order memory) {
        return _orders[orderId];
    }

    function getTrade(uint256 tradeId) external view returns (Trade memory) {
        return _trades[tradeId];
    }

    function feeOf(uint256 value) external pure returns (uint256) {
        return _fee(value);
    }

    function isRefundable(uint256 marketId) external view returns (bool) {
        return _isRefundable(_markets[marketId]);
    }

    // ------------------------------------------------------------------ internals

    function _market(uint256 marketId) private view returns (Market storage m) {
        m = _markets[marketId];
        if (m.status == MarketStatus.None) revert MarketNotFound();
    }

    /// @dev Both sides use the same 0.5% rate; floor rounding keeps per-fill sums within the locked reserve.
    function _fee(uint256 value) private pure returns (uint256) {
        return (value * BUYER_FEE_BPS) / BPS;
    }

    function _isRefundable(Market storage m) private view returns (bool) {
        MarketStatus s = m.status;
        if (s == MarketStatus.Cancelled) return true;
        if (s == MarketStatus.None || s == MarketStatus.SettlementOpen || s == MarketStatus.Completed) return false;
        return block.timestamp > uint256(m.tradingEnd) + ABANDON_DELAY;
    }

    function _match(uint256 marketId, uint256 takerOrderId, Taker memory t, uint256 makerId, Market storage m)
        private
    {
        Order storage mk = _orders[makerId];
        if (
            mk.status != OrderStatus.Open || mk.marketId != marketId || mk.side == t.side || mk.owner == t.who
                || block.timestamp >= mk.expiry
        ) return;
        // crossing: buyer's price >= seller's price
        if (t.side == Side.Buy ? mk.price > t.price : mk.price < t.price) return;

        uint128 fillLots = mk.lots - mk.filled;
        if (fillLots > t.remaining) fillLots = t.remaining;
        uint256 value256 = uint256(mk.price) * fillLots; // execution at the maker's price
        if (value256 > type(uint128).max) revert Overflow();
        uint128 value = uint128(value256);
        uint128 fee = uint128(_fee(value));

        // maker pays from its lock, taker's share is pulled at the end
        if (mk.side == Side.Buy) mk.locked -= value + fee;
        else mk.locked -= value;
        if (t.side == Side.Buy) t.pull += uint256(value) + fee;
        else t.pull += value;

        mk.filled += fillLots;
        t.remaining -= fillLots;
        t.filled += fillLots;

        if (mk.filled == mk.lots) {
            mk.status = OrderStatus.Filled;
            uint128 dust = mk.locked;
            if (dust > 0) {
                mk.locked = 0;
                _pay(mk.owner, dust);
            }
        }

        uint256 tradeId = ++tradeCount;
        bool takerBuys = t.side == Side.Buy;
        _trades[tradeId] = Trade({
            marketId: marketId,
            buyer: takerBuys ? t.who : mk.owner,
            seller: takerBuys ? mk.owner : t.who,
            lots: fillLots,
            price: mk.price,
            value: value,
            buyerFee: fee,
            sellerFee: fee,
            status: TradeStatus.Open
        });
        m.openTrades += 1;

        emit TradeExecuted(
            tradeId,
            marketId,
            takerBuys ? takerOrderId : makerId,
            takerBuys ? makerId : takerOrderId,
            takerBuys ? t.who : mk.owner,
            takerBuys ? mk.owner : t.who,
            fillLots,
            mk.price,
            value,
            fee,
            fee
        );
    }

    function _closeOrder(uint256 orderId, Order storage o, OrderStatus newStatus, CancelReason reason) private {
        uint128 refund = o.locked;
        o.status = newStatus;
        o.locked = 0;
        if (refund > 0) _pay(o.owner, refund);
        emit OrderCancelled(orderId, reason, refund);
    }

    /// @dev Pulls exactly `amount` of USDC from `from`, rejecting short deliveries.
    function _pullUsdc(address from, uint256 amount) private {
        uint256 beforeBal = usdc.balanceOf(address(this));
        usdc.safeTransferFrom(from, address(this), amount);
        uint256 afterBal = usdc.balanceOf(address(this));
        if (afterBal < beforeBal || afterBal - beforeBal != amount) revert PullShortfall();
    }

    /// @dev Push payment; if USDC refuses (for example a blocklisted recipient) credit `claimable` instead.
    function _pay(address to, uint256 amount) private {
        if (amount == 0) return;
        (bool ok, bytes memory result) = address(usdc).call(abi.encodeCall(IERC20.transfer, (to, amount)));
        uint256 returned;
        if (result.length >= 32) {
            assembly ("memory-safe") {
                returned := mload(add(result, 0x20))
            }
        }
        if (ok && (result.length == 0 || (result.length >= 32 && returned == 1))) return;
        claimable[to] += amount;
        emit ClaimableCredited(to, amount);
    }
}
