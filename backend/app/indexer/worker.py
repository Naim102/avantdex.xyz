"""Event indexer: mirrors AvantdexExchange events into PostgreSQL.

Design
 * Events are recorded idempotently in `chain_events` (unique tx_hash + log_index) and decide WHICH rows changed.
 * The exact state of every touched market/order/trade/claimable is then read from the contract itself, so the
   database always equals chain state (the chain is canonical) and replaying from the deploy block rebuilds it.
 * Arc has deterministic finality, so there is no re-org handling.
"""

from __future__ import annotations

import logging
import time

from sqlalchemy import delete, select
from sqlalchemy.orm import Session
from web3 import Web3
from web3._utils.events import get_event_data

from ..chain import ABI, decode_market, decode_order, decode_trade, get_exchange, get_web3, to_dt
from ..config import get_settings
from ..db import SessionLocal
from ..models import (
    ChainEvent,
    Claimable,
    Dispute,
    IndexerState,
    Market,
    Notification,
    Order,
    Project,
    ProjectStatusHistory,
    Trade,
    utcnow,
)

log = logging.getLogger("indexer")

EVENT_ABIS = {e["name"]: e for e in ABI if e["type"] == "event"}


def _topic0(abi: dict) -> str:
    sig = f"{abi['name']}({','.join(i['type'] for i in abi['inputs'])})"
    return "0x" + Web3.keccak(text=sig).hex().removeprefix("0x")


TOPICS = {_topic0(a): a for a in EVENT_ABIS.values()}

PROJECT_STATUS_FOR_MARKET = {
    "Setup": "Market Setup",
    "Live": "Live",
    "Suspended": "Suspended",
    "SettlementOpen": "Live",
    "Completed": "Completed",
    "Cancelled": "Delisted",
}


def _hex(value) -> str:
    if isinstance(value, (bytes, bytearray)):
        return "0x" + bytes(value).hex()
    return str(value) if str(value).startswith("0x") else "0x" + bytes(value).hex()


def _jsonable(args: dict) -> dict:
    out = {}
    for k, v in args.items():
        if isinstance(v, (bytes, bytearray)):
            out[k] = "0x" + bytes(v).hex()
        elif isinstance(v, bool):
            out[k] = v
        elif isinstance(v, int):
            out[k] = str(v)  # big ints as strings so JSON never loses precision
        else:
            out[k] = v
    return out


class Indexer:
    def __init__(self) -> None:
        self.settings = get_settings()
        self.w3 = get_web3()
        self.contract = get_exchange(self.w3)
        self._block_ts: dict[int, int] = {}

    # ------------------------------------------------------------------ state

    def _state(self, db: Session) -> IndexerState:
        st = db.get(IndexerState, 1)
        addr = self.settings.exchange_address.lower()
        if st is None:
            st = IndexerState(
                id=1,
                chain_id=self.settings.chain_id,
                contract=addr,
                last_block=max(self.settings.exchange_deploy_block - 1, 0),
            )
            db.add(st)
            db.commit()
        elif st.chain_id != self.settings.chain_id:
            raise RuntimeError("indexer_state belongs to a different chain; use a fresh database")
        elif st.contract != addr:
            # a new contract was deployed on the same chain: drop what was indexed from the old one (off-chain data stays)
            st = self._reset_for_new_contract(db, st, addr)
        return st

    def _reset_for_new_contract(self, db: Session, st: IndexerState, addr: str) -> IndexerState:
        """Forget everything derived from the previous contract and start again from the new deploy block.

        Kept: projects (and their badges and history), listing requests, users, admins, audit logs, settings.
        Removed: chain events, orders, trades, claimable balances, markets that exist on the old contract, disputes
        and trade notifications (they point at old trade ids). Projects that were tied to an old market return to Approved.
        """
        log.warning("contract changed from %s to %s: resetting indexed chain data", st.contract, addr)
        for model in (ChainEvent, Order, Trade, Claimable, Dispute):
            db.execute(delete(model))
        db.execute(delete(Notification).where(Notification.kind.like("trade%")))
        old = list(db.scalars(select(Market).where(Market.onchain_id.is_not(None))))
        for m in old:
            if m.project_id is not None:
                p = db.get(Project, m.project_id)
                if p is not None and p.status in ("Market Setup", "Live", "Suspended", "Completed"):
                    db.add(ProjectStatusHistory(project_id=p.id, from_status=p.status, to_status="Approved", actor="indexer", reason="contract replaced"))
                    p.status = "Approved"
            db.delete(m)
        st.contract = addr
        st.last_block = max(self.settings.exchange_deploy_block - 1, 0)
        st.chain_head = 0
        db.commit()
        return st

    def _ts(self, block: int) -> int:
        if block not in self._block_ts:
            self._block_ts[block] = self.w3.eth.get_block(block)["timestamp"]
            if len(self._block_ts) > 5000:
                self._block_ts.clear()
        return self._block_ts[block]

    # ------------------------------------------------------------------ main loop

    def run_once(self) -> int:
        """Index at most one batch. Returns the number of blocks processed."""
        with SessionLocal() as db:
            st = self._state(db)
            head = self.w3.eth.block_number
            st.chain_head = head
            if st.last_block >= head:
                st.updated_at = utcnow()
                db.commit()
                return 0
            start = st.last_block + 1
            end = min(head, start + self.settings.indexer_batch_blocks - 1)
            try:
                logs = self.w3.eth.get_logs({"address": self.contract.address, "fromBlock": start, "toBlock": end})
            except Exception:
                if end > start:  # provider range limit: retry a smaller range
                    end = start + max((end - start) // 4, 0)
                    logs = self.w3.eth.get_logs({"address": self.contract.address, "fromBlock": start, "toBlock": end})
                else:
                    raise
            self._process(db, logs, end)
            st.last_block = end
            st.updated_at = utcnow()
            db.commit()
            return end - start + 1

    def catch_up(self) -> None:
        while self.run_once():
            pass

    def run_forever(self) -> None:
        log.info("indexer started for %s on chain %s", self.contract.address, self.settings.chain_id)
        while True:
            try:
                self.catch_up()
            except Exception as exc:  # keep the worker alive; the next loop retries from last_block
                log.error("indexer iteration failed (%s); retrying in 10s", type(exc).__name__)
                time.sleep(10)
                continue
            time.sleep(self.settings.indexer_poll_seconds)

    # ------------------------------------------------------------------ processing

    def _process(self, db: Session, logs: list, end_block: int) -> None:
        touched: dict[str, set] = {"markets": set(), "orders": set(), "trades": set(), "claim": set()}
        for raw in sorted(logs, key=lambda x: (x["blockNumber"], x["logIndex"])):
            topic = _hex(raw["topics"][0])
            abi = TOPICS.get(topic)
            if abi is None:
                continue
            tx = _hex(raw["transactionHash"])
            if db.scalar(select(ChainEvent.id).where(ChainEvent.tx_hash == tx, ChainEvent.log_index == raw["logIndex"])):
                continue
            ev = get_event_data(self.w3.codec, abi, raw)
            args = dict(ev["args"])
            ts = to_dt(self._ts(raw["blockNumber"]))
            db.add(
                ChainEvent(
                    tx_hash=tx,
                    log_index=raw["logIndex"],
                    block_number=raw["blockNumber"],
                    name=abi["name"],
                    args=_jsonable(args),
                    created_at=ts,
                )
            )
            getattr(self, f"_on_{abi['name']}", self._on_ignored)(db, args, tx, raw, ts, touched)
        db.flush()
        self._sync(db, touched, end_block)

    def _on_ignored(self, *a) -> None:
        return None

    def _on_MarketCreated(self, db, a, tx, raw, ts, touched) -> None:
        ref = _hex(a["metadataRef"])
        m = db.scalar(select(Market).where(Market.metadata_ref == ref))
        if m is not None and m.onchain_id is not None and m.onchain_id != a["marketId"]:
            # the same draft was sent to the chain more than once: the first market keeps the record, the copy is ignored
            log.warning("market %s repeats the metadata of market %s; ignored", a["marketId"], m.onchain_id)
            return
        if m is None:  # market created on-chain without an off-chain record
            m = Market(
                metadata_ref=ref,
                slug=None,
                status="Setup",
                lot_size=a["lotSize"],
                tick_size=a["tickSize"],
                min_lots=a["minLots"],
                max_lots=a["maxLots"],
                trading_start=to_dt(a["tradingStart"]),
                trading_end=to_dt(a["tradingEnd"]),
            )
            db.add(m)
        m.onchain_id = a["marketId"]
        m.token_address = a["token"].lower()
        m.status = "Setup"
        db.flush()
        touched["markets"].add(a["marketId"])

    def _on_MarketStatusChanged(self, db, a, tx, raw, ts, touched) -> None:
        touched["markets"].add(a["marketId"])

    _on_SettlementOpened = _on_MarketStatusChanged
    _on_SettlementExtended = _on_MarketStatusChanged

    def _on_OrderPlaced(self, db, a, tx, raw, ts, touched) -> None:
        if db.get(Order, a["orderId"]) is None:
            db.add(
                Order(
                    id=a["orderId"],
                    market_onchain_id=a["marketId"],
                    owner=a["owner"].lower(),
                    side="buy" if a["side"] == 0 else "sell",
                    price=a["price"],
                    lots=a["lots"],
                    filled=0,
                    locked=0,
                    status="Open",
                    ioc=a["ioc"],
                    expiry=to_dt(a["expiry"]),
                    tx_hash=tx,
                    block_number=raw["blockNumber"],
                    created_at=ts,
                )
            )
            db.flush()
        touched["orders"].add(a["orderId"])

    def _on_OrderCancelled(self, db, a, tx, raw, ts, touched) -> None:
        o = db.get(Order, a["orderId"])
        if o is not None:
            o.closed_tx_hash = tx
            reason = a["reason"]
            if reason != 2:  # 2 = IOC remainder, not interesting to the user
                expired = reason == 1
                self._notify(
                    db,
                    o.owner,
                    "order_expired" if expired else "order_cancelled",
                    f"Order #{o.id} {'expired' if expired else 'cancelled'}",
                    f"Your remaining lock of {a['refunded'] / 1e6:.2f} USDC was returned.",
                    "/portfolio",
                    f"oc:{tx}:{raw['logIndex']}",
                )
        touched["orders"].add(a["orderId"])

    def _on_TradeExecuted(self, db, a, tx, raw, ts, touched) -> None:
        if db.get(Trade, a["tradeId"]) is None:
            db.add(
                Trade(
                    id=a["tradeId"],
                    market_onchain_id=a["marketId"],
                    buy_order_id=a["buyOrderId"],
                    sell_order_id=a["sellOrderId"],
                    buyer=a["buyer"].lower(),
                    seller=a["seller"].lower(),
                    lots=a["lots"],
                    price=a["price"],
                    value=a["value"],
                    buyer_fee=a["buyerFee"],
                    seller_fee=a["sellerFee"],
                    status="Open",
                    tx_hash=tx,
                    block_number=raw["blockNumber"],
                    created_at=ts,
                )
            )
            db.flush()
        for who, role in ((a["buyer"], "buyer"), (a["seller"], "seller")):
            self._notify(
                db,
                who.lower(),
                "trade_created",
                f"Order matched: trade #{a['tradeId']}",
                f"{a['lots']} lots at {a['price'] / 1e6:.4f} USDC per lot. You are the {role}.",
                "/portfolio",
                f"te:{a['tradeId']}:{who.lower()}",
            )
        touched["orders"].update((a["buyOrderId"], a["sellOrderId"]))
        touched["trades"].add(a["tradeId"])
        touched["markets"].add(a["marketId"])

    def _close_trade(self, kind, title, db, a, tx, raw, ts, touched) -> None:
        t = db.get(Trade, a["tradeId"])
        if t is not None:
            t.closed_tx_hash = tx
            t.closed_at = ts
            for who in {t.buyer, t.seller}:
                self._notify(db, who, kind, f"Trade #{t.id} {title}", "", "/portfolio", f"{kind}:{t.id}:{who}")
            touched["markets"].add(t.market_onchain_id)
        touched["trades"].add(a["tradeId"])

    def _on_TradeSettled(self, db, a, tx, raw, ts, touched) -> None:
        self._close_trade("trade_settled", "settled", db, a, tx, raw, ts, touched)

    def _on_TradeDefaulted(self, db, a, tx, raw, ts, touched) -> None:
        self._close_trade("trade_defaulted", "defaulted: buyer claimed payment and collateral", db, a, tx, raw, ts, touched)

    def _on_TradeRefunded(self, db, a, tx, raw, ts, touched) -> None:
        self._close_trade("trade_refunded", "refunded", db, a, tx, raw, ts, touched)

    def _on_ClaimableCredited(self, db, a, tx, raw, ts, touched) -> None:
        touched["claim"].add(a["account"].lower())
        self._notify(
            db,
            a["account"].lower(),
            "claimable_credited",
            "USDC is waiting for you to claim",
            f"{a['amount'] / 1e6:.2f} USDC could not be sent automatically. Withdraw it from your portfolio.",
            "/portfolio",
            f"cc:{tx}:{raw['logIndex']}",
        )

    def _on_ClaimableWithdrawn(self, db, a, tx, raw, ts, touched) -> None:
        touched["claim"].add(a["account"].lower())

    # ------------------------------------------------------------------ state sync from the chain

    def _sync(self, db: Session, touched: dict, block: int) -> None:
        c = self.contract.functions
        for mid in touched["markets"]:
            self._sync_market(db, mid, decode_market(c.getMarket(mid).call(block_identifier=block)))
        for oid in touched["orders"]:
            d = decode_order(c.getOrder(oid).call(block_identifier=block))
            o = db.get(Order, oid)
            if o is not None:
                for k in ("filled", "locked", "status", "expiry"):
                    setattr(o, k, d[k])
        for tid in touched["trades"]:
            d = decode_trade(c.getTrade(tid).call(block_identifier=block))
            t = db.get(Trade, tid)
            if t is not None:
                t.status = d["status"]
        for addr in touched["claim"]:
            amount = c.claimable(Web3.to_checksum_address(addr)).call(block_identifier=block)
            row = db.get(Claimable, addr)
            if row is None:
                db.add(Claimable(address=addr, amount=amount))
            else:
                row.amount, row.updated_at = amount, utcnow()

    def _sync_market(self, db: Session, onchain_id: int, d: dict) -> None:
        m = db.scalar(select(Market).where(Market.onchain_id == onchain_id))
        if m is None:
            return
        prev = m.status
        m.status = d["status"]
        m.token_address = d["token"]
        m.settlement_opened_at = d["settlement_opened_at"]
        m.settlement_deadline = d["settlement_deadline"]
        m.open_trades = d["open_trades"]
        if d["status"] == "Live" and m.activated_at is None:
            m.activated_at = utcnow()
        if m.project is not None and prev != d["status"]:
            new = PROJECT_STATUS_FOR_MARKET.get(d["status"])
            p: Project = m.project
            if new and p.status != new:
                db.add(
                    ProjectStatusHistory(
                        project_id=p.id, from_status=p.status, to_status=new, actor="chain", reason=f"market {d['status']}"
                    )
                )
                p.status = new

    def _notify(self, db, address, kind, title, body, link, key) -> None:
        if db.scalar(select(Notification.id).where(Notification.dedupe_key == key)):
            return
        db.add(Notification(address=address, kind=kind, title=title, body=body, link=link, dedupe_key=key))
        db.flush()
