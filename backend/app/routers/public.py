"""Public, read-only market data: config, markets, order book, trades, stats, portfolio."""

from __future__ import annotations

import datetime as dt

from fastapi import APIRouter, Depends, Query
from sqlalchemy import and_, func, or_, select
from sqlalchemy.orm import Session, joinedload

from ..chain import live_fee_collector
from ..config import get_settings
from .. import runtime
from ..db import SessionLocal, get_db
from ..models import Claimable, IndexerState, Market, Order, Project, Setting, Trade, utcnow
from ..security import ApiError, normalize_address
from ..utils import CATEGORIES, active_badges, iso, project_public

router = APIRouter()

PUBLIC_STATUSES = ("Live", "Suspended", "SettlementOpen", "Completed", "Cancelled")


# --------------------------------------------------------------------------- config & health


@router.get("/config")
def config(db: Session = Depends(get_db)) -> dict:
    s = get_settings()
    notice = db.get(Setting, "notice")
    return {
        "chain_id": s.chain_id,
        "explorer_url": s.explorer_url,
        "usdc_address": s.usdc_address,
        "usdc_decimals": 6,
        "exchange_address": s.exchange_address,
        "fee_collector": live_fee_collector(),
        "buyer_fee_bps": s.buyer_fee_bps,
        "seller_fee_bps": s.seller_fee_bps,
        "categories": CATEGORIES,
        "notice": notice.value if notice else "",
        "network": "Arc Testnet" if s.chain_id == 5042002 else f"chain {s.chain_id}",
        "audited": False,
    }


@router.get("/health")
def health() -> dict:
    """Always answers (so the container counts as started) and says what is wrong when something is."""
    st = None
    db_state = "ok"
    try:
        with SessionLocal() as db:
            db.execute(select(1))
            st = db.get(IndexerState, 1) if runtime.state["migrated"] else None
    except Exception as exc:
        db_state = runtime.mask(f"error: {type(exc).__name__}")
    lag = None if st is None else max(st.chain_head - st.last_block, 0)
    ready = db_state == "ok" and bool(runtime.state["migrated"])
    return {
        "status": "ok" if ready else "degraded",
        "database": db_state,
        "migrated": bool(runtime.state["migrated"]),
        "error": runtime.state["error"],
        "indexer": {
            "last_block": st.last_block if st else None,
            "chain_head": st.chain_head if st else None,
            "lag_blocks": lag,
            "updated_at": iso(st.updated_at) if st else None,
        },
    }


# --------------------------------------------------------------------------- stats helpers


def _live_orders_filter(now: dt.datetime):
    return and_(Order.status == "Open", Order.expiry > now, Order.filled < Order.lots)


def bulk_stats(db: Session, onchain_ids: list[int]) -> dict[int, dict]:
    now = utcnow()
    day_ago = now - dt.timedelta(hours=24)
    stats = {
        i: {"last_price": None, "best_bid": None, "best_ask": None, "volume_24h": 0, "volume_total": 0, "open_interest": 0,
            "bid_depth": 0, "ask_depth": 0, "open_orders": 0, "trades": 0}
        for i in onchain_ids
    }
    if not onchain_ids:
        return stats
    for mid, v in db.execute(
        select(Trade.market_onchain_id, func.coalesce(func.sum(Trade.value), 0))
        .where(Trade.market_onchain_id.in_(onchain_ids), Trade.created_at >= day_ago)
        .group_by(Trade.market_onchain_id)
    ):
        stats[mid]["volume_24h"] = int(v)
    for mid, v in db.execute(
        select(Trade.market_onchain_id, func.coalesce(func.sum(Trade.value), 0))
        .where(Trade.market_onchain_id.in_(onchain_ids))
        .group_by(Trade.market_onchain_id)
    ):
        stats[mid]["volume_total"] = int(v)
    for mid, v in db.execute(
        select(Trade.market_onchain_id, func.coalesce(func.sum(Trade.value), 0))
        .where(Trade.market_onchain_id.in_(onchain_ids), Trade.status == "Open")
        .group_by(Trade.market_onchain_id)
    ):
        stats[mid]["open_interest"] = int(v)
    for mid in onchain_ids:
        last = db.scalar(
            select(Trade.price).where(Trade.market_onchain_id == mid).order_by(Trade.id.desc()).limit(1)
        )
        stats[mid]["last_price"] = None if last is None else int(last)
    for mid, side, price in db.execute(
        select(Order.market_onchain_id, Order.side, func.max(Order.price))
        .where(Order.market_onchain_id.in_(onchain_ids), Order.side == "buy", _live_orders_filter(now))
        .group_by(Order.market_onchain_id, Order.side)
    ):
        stats[mid]["best_bid"] = int(price)
    for mid, side, price in db.execute(
        select(Order.market_onchain_id, Order.side, func.min(Order.price))
        .where(Order.market_onchain_id.in_(onchain_ids), Order.side == "sell", _live_orders_filter(now))
        .group_by(Order.market_onchain_id, Order.side)
    ):
        stats[mid]["best_ask"] = int(price)
    # resting liquidity per side: USDC value of the unfilled part of every live order
    for mid, side, value, n in db.execute(
        select(Order.market_onchain_id, Order.side, func.coalesce(func.sum((Order.lots - Order.filled) * Order.price), 0), func.count(Order.id))
        .where(Order.market_onchain_id.in_(onchain_ids), _live_orders_filter(now))
        .group_by(Order.market_onchain_id, Order.side)
    ):
        stats[mid]["bid_depth" if side == "buy" else "ask_depth"] = int(value)
        stats[mid]["open_orders"] += n
    for mid, n in db.execute(select(Trade.market_onchain_id, func.count(Trade.id)).where(Trade.market_onchain_id.in_(onchain_ids)).group_by(Trade.market_onchain_id)):
        stats[mid]["trades"] = n
    for s in stats.values():  # amounts as strings to avoid precision loss in JSON
        for k in ("last_price", "best_bid", "best_ask", "volume_24h", "volume_total", "open_interest", "bid_depth", "ask_depth"):
            if s[k] is not None:
                s[k] = str(s[k])
    return stats


def market_json(m: Market, stats: dict | None = None) -> dict:
    p: Project | None = m.project
    d = {
        "id": m.id,
        "onchain_id": m.onchain_id,
        "slug": m.slug,
        "status": m.status,
        "delisted": m.delisted,
        "token_address": m.token_address,
        "token_decimals": m.token_decimals,
        "lot_size": str(m.lot_size),
        "tick_size": str(m.tick_size),
        "min_lots": str(m.min_lots),
        "max_lots": str(m.max_lots),
        "trading_start": iso(m.trading_start),
        "trading_end": iso(m.trading_end),
        "tge_date": iso(m.tge_date or (p.tge_date if p else None)),
        "settlement_opened_at": iso(m.settlement_opened_at),
        "settlement_deadline": iso(m.settlement_deadline),
        "open_trades": m.open_trades,
        "activated_at": iso(m.activated_at),
        "project": project_public(p) if p else None,
        "stats": stats or {},
    }
    return d


def find_market(db: Session, key: str, public_only: bool = True) -> Market:
    q = select(Market).options(joinedload(Market.project).joinedload(Project.badges))
    if key.isdigit():
        q = q.where(Market.onchain_id == int(key))
    else:
        q = q.where(Market.slug == key)
    m = db.scalar(q)
    if m is None or (public_only and (m.onchain_id is None or m.status not in PUBLIC_STATUSES)):
        raise ApiError(404, "market_not_found", "Market not found")
    return m


# --------------------------------------------------------------------------- markets


@router.get("/markets")
def list_markets(
    tab: str = Query("all", pattern="^(all|trending|new|upcoming_tge|closing_soon|settled)$"),
    q: str = Query("", max_length=60),
    category: str = Query("", max_length=40),
    status: str = Query("", max_length=20),
    badge: str = Query("", max_length=24),
    sort: str = Query("", pattern="^(|volume|newest|tge|best_bid|best_ask)$"),
    db: Session = Depends(get_db),
) -> dict:
    now = utcnow()
    query = (
        select(Market)
        .options(joinedload(Market.project).joinedload(Project.badges))
        .where(Market.onchain_id.is_not(None), Market.status.in_(PUBLIC_STATUSES), Market.delisted.is_(False))
        .join(Project, Market.project_id == Project.id, isouter=True)
    )
    if q:
        like = f"%{q.strip().lower()}%"
        query = query.where(or_(func.lower(Project.name).like(like), func.lower(Project.token_symbol).like(like)))
    if category:
        query = query.where(Project.category == category)
    if status:
        query = query.where(Market.status == status)
    if tab == "settled":
        query = query.where(Market.status == "Completed")
    elif tab == "upcoming_tge":
        query = query.where(Market.status.in_(("Live", "Suspended")), func.coalesce(Market.tge_date, Project.tge_date) > now)
    elif tab == "closing_soon":
        query = query.where(Market.status == "Live", Market.trading_end > now, Market.trading_end <= now + dt.timedelta(days=7))
    elif tab in ("all", "trending", "new"):
        pass
    rows = list(db.scalars(query).unique())
    if badge:
        rows = [m for m in rows if m.project and any(b["badge"] == badge for b in active_badges(m.project))]
    stats = bulk_stats(db, [m.onchain_id for m in rows])
    items = [market_json(m, stats[m.onchain_id]) for m in rows]

    def vol(i: dict) -> int:
        return int(i["stats"]["volume_24h"])

    order = sort or {"trending": "volume", "new": "newest", "upcoming_tge": "tge", "closing_soon": "tge"}.get(tab, "newest")
    if order == "volume":
        items.sort(key=vol, reverse=True)
    elif order == "newest":
        items.sort(key=lambda i: i["activated_at"] or "", reverse=True)
    elif order == "tge":
        items.sort(key=lambda i: (i["tge_date"] is None, i["tge_date"] or ""))
    elif order == "best_bid":
        items.sort(key=lambda i: int(i["stats"]["best_bid"] or 0), reverse=True)
    elif order == "best_ask":
        items.sort(key=lambda i: (i["stats"]["best_ask"] is None, int(i["stats"]["best_ask"] or 0)))
    return {"items": items, "count": len(items)}


@router.get("/stats")
def platform_stats(db: Session = Depends(get_db)) -> dict:
    """Platform-wide totals computed from indexed chain data (nothing here is estimated or invented)."""
    now = utcnow()
    day_ago = now - dt.timedelta(hours=24)
    live = ("Live", "Suspended", "SettlementOpen")
    settled = list(db.scalars(select(Trade).where(Trade.status == "Settled")))
    return {
        "markets_live": db.scalar(select(func.count(Market.id)).where(Market.onchain_id.is_not(None), Market.status.in_(live), Market.delisted.is_(False))) or 0,
        "markets_total": db.scalar(select(func.count(Market.id)).where(Market.onchain_id.is_not(None), Market.status.in_(PUBLIC_STATUSES), Market.delisted.is_(False))) or 0,
        "projects_upcoming": db.scalar(select(func.count(Project.id)).where(Project.status.in_(("Approved", "Market Setup")))) or 0,
        "open_orders": db.scalar(select(func.count(Order.id)).where(_live_orders_filter(now))) or 0,
        "bid_depth": str(db.scalar(select(func.coalesce(func.sum((Order.lots - Order.filled) * Order.price), 0)).where(Order.side == "buy", _live_orders_filter(now))) or 0),
        "ask_depth": str(db.scalar(select(func.coalesce(func.sum((Order.lots - Order.filled) * Order.price), 0)).where(Order.side == "sell", _live_orders_filter(now))) or 0),
        "volume_24h": str(db.scalar(select(func.coalesce(func.sum(Trade.value), 0)).where(Trade.created_at >= day_ago)) or 0),
        "volume_total": str(db.scalar(select(func.coalesce(func.sum(Trade.value), 0))) or 0),
        "open_interest": str(db.scalar(select(func.coalesce(func.sum(Trade.value), 0)).where(Trade.status == "Open")) or 0),
        "trades_total": db.scalar(select(func.count(Trade.id))) or 0,
        "trades_settled": len(settled),
        "fees_paid": str(sum(t.buyer_fee + t.seller_fee for t in settled)),
    }


@router.get("/trades/recent")
def recent_trades(limit: int = Query(12, ge=1, le=50), db: Session = Depends(get_db)) -> dict:
    """Latest matched trades across public markets (public chain data)."""
    markets = {m.onchain_id: m for m in db.scalars(select(Market).options(joinedload(Market.project)).where(Market.onchain_id.is_not(None), Market.delisted.is_(False)))}
    items = []
    for t in db.scalars(select(Trade).order_by(Trade.id.desc()).limit(limit * 3)):
        m = markets.get(t.market_onchain_id)
        if m is None:
            continue
        d = trade_json(t)
        d["market"] = {
            "slug": m.slug, "onchain_id": m.onchain_id, "name": m.project.name if m.project else None,
            "symbol": m.project.token_symbol if m.project else None, "lot_size": str(m.lot_size), "token_decimals": m.token_decimals,
        }
        items.append(d)
        if len(items) >= limit:
            break
    return {"items": items}


@router.get("/projects/upcoming")
def upcoming_projects(db: Session = Depends(get_db)) -> dict:
    """Approved projects whose market is not trading yet (shown as 'Coming soon'; nothing can be traded on them)."""
    rows = db.scalars(
        select(Project).options(joinedload(Project.badges)).where(Project.status.in_(("Approved", "Market Setup"))).order_by(Project.updated_at.desc()).limit(100)
    ).unique()
    items = []
    for p in rows:
        d = project_public(p)
        d["status"] = p.status
        items.append(d)
    return {"items": items}


@router.get("/markets/{key}")
def get_market(key: str, db: Session = Depends(get_db)) -> dict:
    m = find_market(db, key)
    return market_json(m, bulk_stats(db, [m.onchain_id])[m.onchain_id])


@router.get("/markets/{key}/orderbook")
def orderbook(key: str, db: Session = Depends(get_db)) -> dict:
    m = find_market(db, key)
    now = utcnow()
    lots = func.sum(Order.lots - Order.filled)
    rows = db.execute(
        select(Order.side, Order.price, lots, func.count(Order.id))
        .where(Order.market_onchain_id == m.onchain_id, _live_orders_filter(now))
        .group_by(Order.side, Order.price)
    ).all()
    bids = sorted([(int(p), int(l), int(c)) for s, p, l, c in rows if s == "buy"], reverse=True)
    asks = sorted([(int(p), int(l), int(c)) for s, p, l, c in rows if s == "sell"])

    def levels(items):
        total, out = 0, []
        for price, l, c in items:
            total += l
            out.append({"price": str(price), "lots": str(l), "orders": c, "cumulative_lots": str(total)})
        return out

    best_bid = bids[0][0] if bids else None
    best_ask = asks[0][0] if asks else None
    st = db.get(IndexerState, 1)
    return {
        "market": m.onchain_id,
        "bids": levels(bids),
        "asks": levels(asks),
        "best_bid": None if best_bid is None else str(best_bid),
        "best_ask": None if best_ask is None else str(best_ask),
        "spread": None if best_bid is None or best_ask is None else str(best_ask - best_bid),
        "last_indexed_block": st.last_block if st else None,
    }


@router.get("/markets/{key}/match-plan")
def match_plan(
    key: str,
    side: str = Query(..., pattern="^(buy|sell)$"),
    price: int = Query(..., gt=0),
    lots: int = Query(..., gt=0),
    address: str = Query(""),
    db: Session = Depends(get_db),
) -> dict:
    """Best-first list of resting maker orders a taker should supply to `placeOrder`.

    Advisory only: the contract validates every maker and executes at the maker's price.
    """
    m = find_market(db, key)
    now = utcnow()
    owner = normalize_address(address) if address else None
    opposite = "sell" if side == "buy" else "buy"
    q = select(Order).where(Order.market_onchain_id == m.onchain_id, Order.side == opposite, _live_orders_filter(now))
    if owner:
        q = q.where(Order.owner != owner)
    if side == "buy":
        q = q.where(Order.price <= price).order_by(Order.price.asc(), Order.created_at.asc(), Order.id.asc())
    else:
        q = q.where(Order.price >= price).order_by(Order.price.desc(), Order.created_at.asc(), Order.id.asc())
    makers, remaining, total_value, filled = [], lots, 0, 0
    for o in db.scalars(q.limit(200)):
        if remaining <= 0 or len(makers) >= 50:
            break
        take = min(remaining, o.lots - o.filled)
        makers.append({"order_id": o.id, "price": str(o.price), "lots": str(take)})
        total_value += take * o.price
        remaining -= take
        filled += take
    fee = total_value * get_settings().buyer_fee_bps // 10_000 if side == "buy" else total_value * get_settings().seller_fee_bps // 10_000
    return {
        "maker_ids": [x["order_id"] for x in makers],
        "makers": makers,
        "expected_fill_lots": str(filled),
        "expected_value": str(total_value),
        "expected_fee": str(fee),
        "remaining_lots": str(remaining),
    }


@router.get("/markets/{key}/trades")
def market_trades(key: str, limit: int = Query(50, ge=1, le=200), db: Session = Depends(get_db)) -> dict:
    m = find_market(db, key)
    rows = db.scalars(select(Trade).where(Trade.market_onchain_id == m.onchain_id).order_by(Trade.id.desc()).limit(limit))
    return {"items": [trade_json(t) for t in rows]}


@router.get("/markets/{key}/stats")
def market_stats(key: str, db: Session = Depends(get_db)) -> dict:
    m = find_market(db, key)
    return bulk_stats(db, [m.onchain_id])[m.onchain_id]


# --------------------------------------------------------------------------- portfolio (public chain data by wallet)


def order_status(o: Order) -> str:
    """Display status: Open orders past their expiry are shown as Expired (cleanup pending)."""
    if o.status == "Open":
        exp = o.expiry if o.expiry.tzinfo else o.expiry.replace(tzinfo=dt.timezone.utc)
        if exp <= utcnow():
            return "Expired"
        if o.filled > 0:
            return "Partially Filled"
    return o.status


def order_json(o: Order) -> dict:
    return {
        "id": o.id,
        "market_onchain_id": o.market_onchain_id,
        "owner": o.owner,
        "side": o.side,
        "price": str(o.price),
        "lots": str(o.lots),
        "filled": str(o.filled),
        "locked": str(o.locked),
        "status": order_status(o),
        "chain_status": o.status,
        "ioc": o.ioc,
        "expiry": iso(o.expiry),
        "tx_hash": o.tx_hash,
        "closed_tx_hash": o.closed_tx_hash,
        "created_at": iso(o.created_at),
    }


def trade_json(t: Trade) -> dict:
    return {
        "id": t.id,
        "market_onchain_id": t.market_onchain_id,
        "buy_order_id": t.buy_order_id,
        "sell_order_id": t.sell_order_id,
        "buyer": t.buyer,
        "seller": t.seller,
        "lots": str(t.lots),
        "price": str(t.price),
        "value": str(t.value),
        "buyer_fee": str(t.buyer_fee),
        "seller_fee": str(t.seller_fee),
        "status": t.status,
        "tx_hash": t.tx_hash,
        "closed_tx_hash": t.closed_tx_hash,
        "created_at": iso(t.created_at),
        "closed_at": iso(t.closed_at),
    }


@router.get("/portfolio/{address}/orders")
def portfolio_orders(
    address: str,
    side: str = Query("", pattern="^(|buy|sell)$"),
    status: str = Query("", pattern="^(|Open|Partially Filled|Filled|Cancelled|Expired)$"),
    limit: int = Query(200, ge=1, le=500),
    db: Session = Depends(get_db),
) -> dict:
    addr = normalize_address(address)
    q = select(Order).where(Order.owner == addr)
    if side:
        q = q.where(Order.side == side)
    rows = list(db.scalars(q.order_by(Order.id.desc()).limit(limit)))
    items = [order_json(o) for o in rows]
    if status:
        items = [i for i in items if i["status"] == status]
    return {"items": items}


@router.get("/portfolio/{address}/trades")
def portfolio_trades(
    address: str,
    role: str = Query("", pattern="^(|buyer|seller)$"),
    status: str = Query("", pattern="^(|Open|Settled|Defaulted|Refunded)$"),
    limit: int = Query(200, ge=1, le=500),
    db: Session = Depends(get_db),
) -> dict:
    addr = normalize_address(address)
    q = select(Trade).where(or_(Trade.buyer == addr, Trade.seller == addr))
    if role == "buyer":
        q = q.where(Trade.buyer == addr)
    elif role == "seller":
        q = q.where(Trade.seller == addr)
    if status:
        q = q.where(Trade.status == status)
    rows = db.scalars(q.order_by(Trade.id.desc()).limit(limit))
    markets = {m.onchain_id: m for m in db.scalars(select(Market).options(joinedload(Market.project)).where(Market.onchain_id.is_not(None)))}
    items = []
    for t in rows:
        d = trade_json(t)
        d["role"] = "buyer" if t.buyer == addr else "seller"
        m = markets.get(t.market_onchain_id)
        d["market"] = None if m is None else {
            "slug": m.slug,
            "status": m.status,
            "name": m.project.name if m.project else None,
            "symbol": m.project.token_symbol if m.project else None,
            "settlement_deadline": iso(m.settlement_deadline),
            "token_address": m.token_address,
            "lot_size": str(m.lot_size),
            "token_decimals": m.token_decimals,
        }
        items.append(d)
    return {"items": items}


@router.get("/portfolio/{address}/summary")
def portfolio_summary(address: str, db: Session = Depends(get_db)) -> dict:
    addr = normalize_address(address)
    now = utcnow()
    open_orders = list(db.scalars(select(Order).where(Order.owner == addr, _live_orders_filter(now))))
    # expired-but-not-cleaned orders still hold funds until cancelled/expired on-chain
    stale = list(db.scalars(select(Order).where(Order.owner == addr, Order.status == "Open", Order.expiry <= now)))
    locked_orders = sum(o.locked for o in open_orders) + sum(o.locked for o in stale)
    trades = list(db.scalars(select(Trade).where(or_(Trade.buyer == addr, Trade.seller == addr), Trade.status == "Open")))
    locked_trades = 0
    for t in trades:
        if t.buyer == addr:
            locked_trades += t.value + t.buyer_fee
        if t.seller == addr:
            locked_trades += t.value
    claim = db.get(Claimable, addr)
    return {
        "address": addr,
        "open_orders": len(open_orders),
        "open_trades": len(trades),
        "locked_in_orders": str(locked_orders),
        "locked_in_trades": str(locked_trades),
        "claimable": str(claim.amount if claim else 0),
    }


@router.get("/portfolio/{address}/positions")
def portfolio_positions(address: str, db: Session = Depends(get_db)) -> dict:
    """Per market (token): what the wallet will receive or has to deliver, USDC locked, and what is still resting.

    Amounts are lots; the client converts them to tokens with the market's lot size and decimals. `open_*` order
    fields are NOT guaranteed fills, they are resting orders that may or may not match. Trades are guaranteed
    by escrow (they settle, default or refund).
    """
    addr = normalize_address(address)
    now = utcnow()
    rows: dict[int, dict] = {}

    def row(mid: int) -> dict:
        return rows.setdefault(mid, {
            "market_onchain_id": mid, "to_receive_lots": 0, "to_deliver_lots": 0, "pay_locked": 0, "collateral_locked": 0, "sale_net": 0,
            "received_lots": 0, "delivered_lots": 0, "open_trades": 0, "open_buy_lots": 0, "open_sell_lots": 0, "locked_in_orders": 0, "open_orders": 0,
        })

    for t in db.scalars(select(Trade).where(or_(Trade.buyer == addr, Trade.seller == addr))):
        r = row(t.market_onchain_id)
        if t.status == "Open":
            r["open_trades"] += 1
            if t.buyer == addr:
                r["to_receive_lots"] += t.lots
                r["pay_locked"] += t.value + t.buyer_fee
            if t.seller == addr:
                r["to_deliver_lots"] += t.lots
                r["collateral_locked"] += t.value
                r["sale_net"] += t.value - t.seller_fee
        elif t.status == "Settled":
            if t.buyer == addr:
                r["received_lots"] += t.lots
            if t.seller == addr:
                r["delivered_lots"] += t.lots
    for o in db.scalars(select(Order).where(Order.owner == addr, Order.status == "Open")):
        exp = o.expiry if o.expiry.tzinfo else o.expiry.replace(tzinfo=dt.timezone.utc)
        r = row(o.market_onchain_id)
        r["locked_in_orders"] += o.locked  # an expired order still holds funds until it is cleaned up
        if exp > now and o.filled < o.lots:
            r["open_orders"] += 1
            r["open_buy_lots" if o.side == "buy" else "open_sell_lots"] += o.lots - o.filled

    markets = {m.onchain_id: m for m in db.scalars(select(Market).options(joinedload(Market.project)).where(Market.onchain_id.in_(list(rows) or [-1])))}
    items = []
    for mid, r in sorted(rows.items()):
        m = markets.get(mid)
        if m is None:
            continue
        p = m.project
        items.append({
            **{k: str(v) if k in ("pay_locked", "collateral_locked", "sale_net", "locked_in_orders") else v for k, v in r.items()},
            "market": {
                "slug": m.slug, "status": m.status, "name": p.name if p else None, "symbol": p.token_symbol if p else None,
                "logo_url": p.logo_url if p else "", "token_address": m.token_address, "lot_size": str(m.lot_size), "token_decimals": m.token_decimals,
                "tge_date": iso(m.tge_date or (p.tge_date if p else None)), "trading_end": iso(m.trading_end),
                "settlement_deadline": iso(m.settlement_deadline),
            },
        })
    return {"items": items}
