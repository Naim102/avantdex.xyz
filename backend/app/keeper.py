"""Keeper: a small worker that performs the on-chain chores that need no trust.

What it does, and why each is safe:
  * expireOrders    anyone may call it; every refund goes to the order's owner.
  * refundTrade     anyone may call it for a cancelled or abandoned market; each side gets its own funds back.
  * completeMarket  OPTIONAL (KEEPER_COMPLETE_MARKETS) and only when the keeper wallet holds MARKET_MANAGER; the
                    contract itself refuses it unless every trade is closed.
What it never does: cancel, suspend, open or extend settlement, pause, change the fee collector, or touch a role. The
keeper wallet only needs gas (USDC on Arc). Keep it small; it is a hot key.
"""

from __future__ import annotations

import datetime as dt
import json
import logging
import time

from eth_account import Account
from sqlalchemy import select
from web3 import Web3

from .chain import get_exchange, get_web3
from .config import get_settings
from .db import SessionLocal
from .models import AuditLog, Market, Order, Setting, Trade, utcnow

log = logging.getLogger("keeper")

ABANDON_DELAY = dt.timedelta(days=90)
STATUS_KEY = "keeper_status"


def _aware(d: dt.datetime) -> dt.datetime:
    return d if d.tzinfo else d.replace(tzinfo=dt.timezone.utc)


class Keeper:
    def __init__(self) -> None:
        self.s = get_settings()
        self.w3 = get_web3()
        self.contract = get_exchange(self.w3)
        self.account = Account.from_key(self.s.keeper_private_key) if self.s.keeper_private_key else None
        self.sent = 0

    # ------------------------------------------------------------------ plumbing

    @property
    def address(self) -> str:
        return self.account.address if self.account else ""

    def balance(self) -> float:
        """Native balance in USDC (Arc's gas token has 18 decimals)."""
        return self.w3.eth.get_balance(Web3.to_checksum_address(self.address)) / 1e18

    def _record(self, db, action: str, entity_type: str, entity_id: object, after: dict) -> None:
        db.add(AuditLog(actor=self.address.lower(), role="keeper", action=f"keeper.{action}", entity_type=entity_type, entity_id=str(entity_id), before=None, after=after))
        db.commit()

    def _send(self, db, fn, action: str, entity_type: str, entity_id: object, results: dict, extra: dict | None = None) -> bool:
        """Simulate, then (unless dry run) sign and send. Returns True if a transaction was sent or would be sent."""
        if self.sent >= self.s.keeper_max_tx_per_run:
            return False
        try:
            fn.call({"from": self.address})  # a revert here means the work is no longer needed; skip without paying gas
        except Exception as exc:
            log.info("skip %s %s: simulation reverted (%s)", action, entity_id, type(exc).__name__)
            return False
        if self.s.keeper_dry_run:
            log.info("dry run: would send %s for %s %s", action, entity_type, entity_id)
            results["would_send"] = results.get("would_send", 0) + 1
            self.sent += 1
            return True
        fee = Web3.to_wei(max(self.s.keeper_max_gas_gwei, 20), "gwei")  # Arc guidance: at least 20 gwei
        tx = fn.build_transaction({
            "from": self.address, "chainId": self.s.chain_id, "nonce": self.w3.eth.get_transaction_count(self.address, "pending"),
            "maxFeePerGas": fee, "maxPriorityFeePerGas": Web3.to_wei(1, "gwei"),
        })
        tx["gas"] = int(self.w3.eth.estimate_gas(tx) * 1.25)
        signed = self.account.sign_transaction(tx)
        h = self.w3.eth.send_raw_transaction(signed.raw_transaction)
        rc = self.w3.eth.wait_for_transaction_receipt(h, timeout=120)
        self.sent += 1
        ok = rc.status == 1
        self._record(db, action, entity_type, entity_id, {"tx": "0x" + h.hex().removeprefix("0x"), "ok": ok, **(extra or {})})
        log.info("%s %s %s tx %s", action, entity_type, entity_id, h.hex())
        if ok:
            results[action] = results.get(action, 0) + 1
        return ok

    # ------------------------------------------------------------------ duties

    def expire_orders(self, db, now: dt.datetime, results: dict) -> None:
        ids = [o.id for o in db.scalars(select(Order).where(Order.status == "Open", Order.expiry <= now).order_by(Order.expiry).limit(50))]
        if ids:
            self._send(db, self.contract.functions.expireOrders(ids), "expire_orders", "orders", f"{ids[0]}..{ids[-1]}", results, {"count": len(ids)})

    def refund_trades(self, db, now: dt.datetime, results: dict) -> None:
        markets = {m.onchain_id: m for m in db.scalars(select(Market).where(Market.onchain_id.is_not(None)))}
        refundable: dict[int, bool] = {}
        for t in db.scalars(select(Trade).where(Trade.status == "Open").order_by(Trade.id).limit(500)):
            m = markets.get(t.market_onchain_id)
            if m is None:
                continue
            if t.market_onchain_id not in refundable:
                cancelled = m.status == "Cancelled"
                abandoned = m.status in ("Setup", "Live", "Suspended") and _aware(m.trading_end) + ABANDON_DELAY < now
                refundable[t.market_onchain_id] = (cancelled or abandoned) and bool(self.contract.functions.isRefundable(t.market_onchain_id).call())
            if refundable[t.market_onchain_id]:
                self._send(db, self.contract.functions.refundTrade(t.id), "refund_trade", "trade", t.id, results)

    def complete_markets(self, db, results: dict) -> None:
        if not self.s.keeper_complete_markets:
            return
        role = self.contract.functions.MARKET_MANAGER_ROLE().call()
        if not self.contract.functions.hasRole(role, self.address).call():
            results["note"] = "KEEPER_COMPLETE_MARKETS is on but the keeper wallet does not hold MARKET_MANAGER"
            return
        for m in db.scalars(select(Market).where(Market.status == "SettlementOpen", Market.open_trades == 0, Market.onchain_id.is_not(None))):
            self._send(db, self.contract.functions.completeMarket(m.onchain_id), "complete_market", "market", m.onchain_id, results)

    # ------------------------------------------------------------------ one pass and status

    def run_once(self) -> dict:
        self.sent = 0
        results: dict = {}
        now = dt.datetime.fromtimestamp(self.w3.eth.get_block("latest")["timestamp"], tz=dt.timezone.utc)  # the chain's clock decides what is due
        bal = self.balance()
        status = {"enabled": True, "dry_run": self.s.keeper_dry_run, "complete_markets": self.s.keeper_complete_markets, "address": self.address, "balance": round(bal, 6), "min_balance": self.s.keeper_min_balance, "updated_at": utcnow().isoformat()}
        if bal < self.s.keeper_min_balance:
            status["error"] = f"Low balance: {bal:.4f} USDC. Send a little USDC (gas) to {self.address}."
            log.warning(status["error"])
        else:
            with SessionLocal() as db:
                for duty in (lambda: self.expire_orders(db, now, results), lambda: self.refund_trades(db, now, results), lambda: self.complete_markets(db, results)):
                    try:
                        duty()
                    except Exception as exc:  # one failing duty must not stop the others
                        log.error("keeper duty failed: %s", type(exc).__name__)
                        status["error"] = f"{type(exc).__name__}: {str(exc)[:160]}"
        status["last_results"] = results
        self._save(status)
        return results

    def _save(self, status: dict) -> None:
        with SessionLocal() as db:
            row = db.get(Setting, STATUS_KEY)
            prev = json.loads(row.value) if row and row.value else {}
            totals = prev.get("totals", {})
            for k, v in status.get("last_results", {}).items():
                if isinstance(v, int):
                    totals[k] = totals.get(k, 0) + v
            status["totals"] = totals
            value = json.dumps(status)
            if row is None:
                db.add(Setting(key=STATUS_KEY, value=value))
            else:
                row.value = value
            db.commit()

    def run_forever(self) -> None:
        log.info("keeper started for %s with wallet %s (dry_run=%s, complete_markets=%s)", self.contract.address, self.address, self.s.keeper_dry_run, self.s.keeper_complete_markets)
        while True:
            try:
                self.run_once()
            except Exception as exc:
                log.error("keeper pass failed (%s); retrying", type(exc).__name__)
            time.sleep(self.s.keeper_interval_seconds)
