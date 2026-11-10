"""Operations helpers for admins: token pre-flight, the "needs attention" list, deadline reminders and the admin webhook.

Nothing here sends a transaction. Reminders only write notification rows; the webhook only POSTs a JSON summary.
"""

from __future__ import annotations

import datetime as dt
import json
import logging
import re
import urllib.request

from sqlalchemy import func, select
from sqlalchemy.orm import Session, joinedload

from .chain import get_web3
from .config import get_settings
from .models import IndexerState, Market, Notification, Project, Setting, Trade, utcnow

log = logging.getLogger("ops")

ADDRESS_RE = re.compile(r"^0x[0-9a-fA-F]{40}$")
ZERO = "0x" + "0" * 40

_ERC20 = [
    {"type": "function", "name": "name", "stateMutability": "view", "inputs": [], "outputs": [{"type": "string"}]},
    {"type": "function", "name": "symbol", "stateMutability": "view", "inputs": [], "outputs": [{"type": "string"}]},
    {"type": "function", "name": "decimals", "stateMutability": "view", "inputs": [], "outputs": [{"type": "uint8"}]},
    {"type": "function", "name": "totalSupply", "stateMutability": "view", "inputs": [], "outputs": [{"type": "uint256"}]},
]


def _aware(d: dt.datetime | None) -> dt.datetime | None:
    if d is None:
        return None
    return d if d.tzinfo else d.replace(tzinfo=dt.timezone.utc)


# --------------------------------------------------------------------------- token pre-flight


def check_token(address: str, typed_decimals: int | None = None, project_token: str = "", project_symbol: str = "") -> dict:
    """Reads the token from the chain and compares it with what the admin typed and with the project record.

    `ok` is False when the address is not a contract, or when the on-chain decimals differ from the typed value.
    Warnings are things a human should look at before signing (a different address than the project confirmed, a
    different symbol, zero supply, a token that does not answer the standard calls).
    """
    out: dict = {"address": address, "is_contract": False, "name": None, "symbol": None, "decimals": None, "total_supply": None, "checks": [], "ok": False}
    checks: list[dict] = out["checks"]

    def add(label: str, ok: bool, detail: str, blocking: bool = False) -> None:
        checks.append({"label": label, "ok": ok, "detail": detail, "blocking": blocking and not ok})

    if not ADDRESS_RE.match(address or "") or address.lower() == ZERO:
        add("Address", False, "Not a valid token address", blocking=True)
        return out
    from web3 import Web3

    w3 = get_web3()
    try:
        cs = Web3.to_checksum_address(address)
        code = w3.eth.get_code(cs)
    except Exception as exc:  # RPC down or bad input
        add("Chain", False, f"Could not read the chain ({type(exc).__name__}). Try again.", blocking=True)
        return out
    out["is_contract"] = len(code) > 0
    add("Contract", out["is_contract"], f"{len(code)} bytes of code" if out["is_contract"] else "No contract at this address on this network", blocking=True)
    if not out["is_contract"]:
        return out
    c = w3.eth.contract(address=cs, abi=_ERC20)

    def call(fn):
        try:
            return getattr(c.functions, fn)().call()
        except Exception:
            return None

    out["name"], out["symbol"], out["decimals"] = call("name"), call("symbol"), call("decimals")
    ts = call("totalSupply")
    out["total_supply"] = None if ts is None else str(ts)
    add("Standard calls", out["decimals"] is not None and ts is not None, "decimals() and totalSupply() answer" if out["decimals"] is not None and ts is not None else "decimals() or totalSupply() did not answer: this may not be an ERC-20", blocking=True)
    if out["decimals"] is not None and typed_decimals is not None:
        add("Decimals", out["decimals"] == typed_decimals, f"On-chain {out['decimals']}, market form {typed_decimals}" + ("" if out["decimals"] == typed_decimals else ": lot size would be wrong by a factor of 10^" + str(abs(out["decimals"] - typed_decimals))), blocking=True)
    if ts == 0:
        add("Supply", False, "Total supply is zero")
    elif ts is not None:
        add("Supply", True, f"{ts / 10 ** (out['decimals'] or 0):,.4f} tokens")
    if project_token:
        same = project_token.lower() == address.lower()
        add("Project record", same, "Same address as the project's confirmed token" if same else f"The project record says {project_token}", blocking=False)
    if project_symbol and out["symbol"] is not None:
        same = project_symbol.upper() == str(out["symbol"]).upper()
        add("Symbol", same, f"On-chain {out['symbol']}, project {project_symbol}" if not same else f"{out['symbol']} matches the project")
    out["ok"] = is_ok(checks)
    return out


def is_ok(checks: list[dict]) -> bool:
    return not any(c["blocking"] for c in checks)


# --------------------------------------------------------------------------- needs attention


def attention_items(db: Session, now: dt.datetime | None = None) -> list[dict]:
    """Things a person should look at, computed from indexed data. Newest severity first: high, warn, info."""
    now = now or utcnow()
    items: list[dict] = []

    def add(sev: str, key: str, title: str, detail: str, link: str = "/admin/settlement") -> None:
        items.append({"severity": sev, "key": key, "title": title, "detail": detail, "link": link})

    markets = db.scalars(select(Market).options(joinedload(Market.project)).where(Market.onchain_id.is_not(None)))
    for m in markets:
        name = (m.project.name if m.project else None) or f"Market #{m.onchain_id}"
        tge = _aware(m.tge_date or (m.project.tge_date if m.project else None))
        end = _aware(m.trading_end)
        if m.status in ("Live", "Suspended"):
            if tge and tge <= now:
                add("high", f"tge:{m.id}", f"TGE date passed: {name}", f"TGE was {tge:%Y-%m-%d %H:%M} UTC and settlement is not open. Verify the token and open settlement.")
            elif end and end <= now:
                add("warn", f"ended:{m.id}", f"Trading ended: {name}", f"Trading ended {end:%Y-%m-%d %H:%M} UTC. Open settlement or cancel; users wait until you do.")
        if m.status == "Setup":
            add("info", f"setup:{m.id}", f"Created on-chain, not activated: {name}", "Verify the configuration, approve and activate.", "/admin/market-management")
        if m.status == "SettlementOpen":
            dl = _aware(m.settlement_deadline)
            if m.open_trades == 0:
                add("info", f"complete:{m.id}", f"Ready to complete: {name}", "Every trade is settled, defaulted or refunded.")
            elif dl and dl <= now:
                add("warn", f"late:{m.id}", f"Deadline passed: {name}", f"{m.open_trades} trade(s) still open. Buyers can claim defaults; sellers can still settle until then.")
            elif dl and dl - now <= dt.timedelta(hours=24):
                add("warn", f"soon:{m.id}", f"Deadline within 24 hours: {name}", f"{m.open_trades} open trade(s), deadline {dl:%Y-%m-%d %H:%M} UTC. Extend only if there is a real delay.")
    st = db.get(IndexerState, 1)
    if st is not None:
        stale = (now - _aware(st.updated_at)).total_seconds() if st.updated_at else None
        if st.chain_head - st.last_block > 100 or (stale is not None and stale > 180):
            add("high", "indexer", "Indexer is behind or stopped", f"Indexed to block {st.last_block}, chain at {st.chain_head}. Market data on the site may be stale.", "/admin")
    krow = db.get(Setting, "keeper_status")
    if krow and krow.value:
        k = json.loads(krow.value)
        age = (now - dt.datetime.fromisoformat(k["updated_at"])).total_seconds() if k.get("updated_at") else None
        if k.get("error"):
            add("warn", "keeper", "Keeper needs attention", k["error"], "/admin/settings")
        elif age is not None and age > 600:
            add("warn", "keeper_stale", "Keeper has stopped", f"Last pass was {int(age // 60)} minutes ago. Check the keeper container.", "/admin/settings")
    waiting = db.scalar(select(func.count(Project.id)).where(Project.status == "Submitted")) or 0
    if waiting:
        add("info", "apps", f"{waiting} application(s) waiting for review", "Approve, ask for changes or reject.", "/admin/applications")
    order = {"high": 0, "warn": 1, "info": 2}
    return sorted(items, key=lambda i: order[i["severity"]])


# --------------------------------------------------------------------------- reminders


def _note(db: Session, address: str, kind: str, title: str, body: str, key: str) -> None:
    if db.scalar(select(Notification.id).where(Notification.dedupe_key == key)):
        return
    db.add(Notification(address=address, kind=kind, title=title, body=body, link="/portfolio?tab=Settlement%20Status", dedupe_key=key))


def run_reminders(db: Session, now: dt.datetime | None = None) -> int:
    """Notify buyers and sellers of open trades as a settlement deadline approaches and after it passes. Idempotent."""
    now = now or utcnow()
    before = db.scalar(select(func.count(Notification.id))) or 0
    for m in db.scalars(select(Market).options(joinedload(Market.project)).where(Market.status == "SettlementOpen", Market.onchain_id.is_not(None))):
        dl = _aware(m.settlement_deadline)
        if dl is None:
            continue
        name = (m.project.name if m.project else None) or f"market #{m.onchain_id}"
        left = dl - now
        for t in db.scalars(select(Trade).where(Trade.market_onchain_id == m.onchain_id, Trade.status == "Open")):
            if left <= dt.timedelta(0):
                _note(db, t.seller, "deadline_passed_seller", f"Trade #{t.id}: deadline passed", f"{name}: the buyer can now claim your collateral. You can still settle until they do.", f"dl0s:{t.id}:{int(dl.timestamp())}")
                _note(db, t.buyer, "deadline_passed_buyer", f"Trade #{t.id}: you can claim now", f"{name}: the seller did not deliver in time. Claim your payment plus their collateral.", f"dl0b:{t.id}:{int(dl.timestamp())}")
            elif left <= dt.timedelta(hours=1):
                _note(db, t.seller, "deadline_1h", f"Trade #{t.id}: under 1 hour left", f"{name}: approve the token and settle now to avoid losing your collateral.", f"dl1:{t.id}:{int(dl.timestamp())}")
            elif left <= dt.timedelta(hours=24):
                _note(db, t.seller, "deadline_24h", f"Trade #{t.id}: under 24 hours left", f"{name}: deliver before {dl:%Y-%m-%d %H:%M} UTC. Approve the token first.", f"dl24:{t.id}:{int(dl.timestamp())}")
    db.commit()
    return (db.scalar(select(func.count(Notification.id))) or 0) - before


# --------------------------------------------------------------------------- admin webhook


def notify_admins(db: Session, items: list[dict]) -> int:
    """POST newly appeared high and warn items to ADMIN_WEBHOOK_URL (Slack/Discord/Telegram-style JSON). Each key is sent once."""
    url = get_settings().admin_webhook_url
    if not url or not url.startswith("https://"):
        return 0
    row = db.get(Setting, "webhook_sent")
    sent = set(json.loads(row.value)) if row and row.value else set()
    alerting = [i for i in items if i["severity"] in ("high", "warn")]
    current = {i["key"] for i in alerting}
    fresh = [i for i in alerting if i["key"] not in sent]
    delivered = 0
    if fresh:
        lines = [f"- {i['title']}: {i['detail']}" for i in fresh]
        text = "Avantdex needs attention:\n" + "\n".join(lines)
        req = urllib.request.Request(url, data=json.dumps({"text": text, "content": text}).encode(), headers={"content-type": "application/json"}, method="POST")
        try:
            urllib.request.urlopen(req, timeout=10).read()  # noqa: S310 (https only, checked above)
            delivered = len(fresh)
        except Exception as exc:
            log.warning("admin webhook failed: %s", type(exc).__name__)
    keep = (sent & current) | ({i["key"] for i in fresh} if delivered else set())  # forget keys that no longer apply
    if keep != sent:
        value = json.dumps(sorted(keep))
        if row is None:
            db.add(Setting(key="webhook_sent", value=value))
        else:
            row.value = value
        db.commit()
    return delivered


def run_ops(db: Session) -> None:
    run_reminders(db)
    notify_admins(db, attention_items(db))
