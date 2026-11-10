"""Needs-attention list, deadline reminders, admin webhook and draft edit/discard (no chain needed)."""

import datetime as dt

from sqlalchemy import select

from app import ops
from app.db import SessionLocal
from app.models import IndexerState, Market, Notification, Project, Setting, Trade

from .conftest import login, make_wallet
from .test_markets_api import ONE, A, B, seed_market

NOW = dt.datetime.now(dt.timezone.utc)


def _trade(db, tid, market, buyer, seller, status="Open"):
    db.add(Trade(id=tid, market_onchain_id=market, buy_order_id=1, sell_order_id=2, buyer=buyer, seller=seller, lots=2, price=ONE, value=2 * ONE,
                 buyer_fee=10_000, seller_fee=10_000, status=status, tx_hash="0x" + "3" * 64, block_number=1, created_at=NOW))


def _open_settlement(db, oid, name, symbol, deadline_in, open_trades=1):
    m = seed_market(db, oid, name, symbol, status="SettlementOpen")
    m.settlement_opened_at = NOW - dt.timedelta(hours=2)
    m.settlement_deadline = NOW + deadline_in
    m.open_trades = open_trades
    return m


def keys(db):
    return {i["key"]: i["severity"] for i in ops.attention_items(db)}


def test_attention_flags_tge_deadline_and_ready_to_complete(client):
    with SessionLocal() as db:
        ids = {}
        ids["tge"] = seed_market(db, 1, "Past Tge", "PTG", tge_days=-1).id  # TGE yesterday, still Live
        ids["ended"] = seed_market(db, 2, "Ended", "END", end_days=-1).id  # trading ended, no TGE date
        ids["soon"] = _open_settlement(db, 3, "Soon", "SON", dt.timedelta(hours=5)).id
        ids["late"] = _open_settlement(db, 4, "Late", "LAT", dt.timedelta(hours=-3)).id
        ids["done"] = _open_settlement(db, 5, "Done", "DON", dt.timedelta(hours=-3), open_trades=0).id
        ids["fine"] = seed_market(db, 6, "Fine", "FIN", tge_days=10, end_days=20).id
        db.add(IndexerState(id=1, chain_id=5042002, contract="0x" + "1" * 40, last_block=10, chain_head=10, updated_at=dt.datetime.now(dt.timezone.utc)))  # fresh: the module-level NOW goes stale in a long run
        db.commit()
        got = keys(db)
    assert got[f"tge:{ids['tge']}"] == "high"
    assert got[f"ended:{ids['ended']}"] == "warn" and got[f"soon:{ids['soon']}"] == "warn"
    assert got[f"late:{ids['late']}"] == "warn" and got[f"complete:{ids['done']}"] == "info"
    assert not any(k.endswith(f":{ids['fine']}") for k in got)  # a healthy market raises nothing
    assert "indexer" not in got


def test_attention_flags_a_stopped_indexer_and_waiting_applications(client):
    with SessionLocal() as db:
        db.add(IndexerState(id=1, chain_id=5042002, contract="0x" + "1" * 40, last_block=10, chain_head=500, updated_at=NOW - dt.timedelta(minutes=30)))
        db.add(Project(slug="w", applicant=A, status="Submitted", name="Waiting", token_symbol="WTG"))
        db.commit()
        got = keys(db)
    assert got["indexer"] == "high" and got["apps"] == "info"


def test_attention_endpoint_needs_an_admin(client, admin_headers):
    assert client.get("/api/admin/attention", headers=login(client, make_wallet(95))).status_code == 403
    assert client.get("/api/admin/attention", headers=admin_headers).json() == {"items": []}


def test_reminders_are_sent_once_per_stage(client):
    with SessionLocal() as db:
        _open_settlement(db, 1, "Soon", "SON", dt.timedelta(hours=20))
        _trade(db, 1, 1, B, A)
        db.commit()
        assert ops.run_reminders(db, now=NOW) == 1  # 24h reminder to the seller
        assert ops.run_reminders(db, now=NOW) == 0  # idempotent
        assert [n.kind for n in db.scalars(select(Notification))] == ["deadline_24h"]
        assert ops.run_reminders(db, now=NOW + dt.timedelta(hours=19, minutes=30)) == 1  # under 1 hour left
        assert ops.run_reminders(db, now=NOW + dt.timedelta(hours=21)) == 2  # deadline passed: seller and buyer
        kinds = {(n.kind, n.address) for n in db.scalars(select(Notification))}
        assert ("deadline_1h", A) in kinds and ("deadline_passed_seller", A) in kinds and ("deadline_passed_buyer", B) in kinds
        # settled trades are not reminded
        db.get(Trade, 1).status = "Settled"
        db.commit()
        assert ops.run_reminders(db, now=NOW + dt.timedelta(hours=30)) == 0


def test_webhook_sends_each_new_item_once(client, monkeypatch):
    sent = []

    class R:
        def read(self):
            return b""

    monkeypatch.setattr(ops.urllib.request, "urlopen", lambda req, timeout=0: sent.append(req.data) or R())
    monkeypatch.setenv("ADMIN_WEBHOOK_URL", "https://hooks.example.test/x")
    from app.config import get_settings

    get_settings.cache_clear()
    item = lambda k, sev: {"severity": sev, "key": k, "title": k.upper(), "detail": "d", "link": ""}
    items = [item("a", "high"), item("b", "info")]
    with SessionLocal() as db:
        assert ops.notify_admins(db, items) == 1  # info items are never sent
        assert ops.notify_admins(db, items) == 0
        assert ops.notify_admins(db, items + [item("c", "warn")]) == 1
        assert ops.notify_admins(db, []) == 0  # resolved items are forgotten, so a repeat later is sent again
        assert ops.notify_admins(db, items) == 1
        assert db.get(Setting, "webhook_sent") is not None
    assert len(sent) == 3
    monkeypatch.setenv("ADMIN_WEBHOOK_URL", "http://insecure.example/x")  # only https is used
    get_settings.cache_clear()
    with SessionLocal() as db:
        assert ops.notify_admins(db, [item("z", "high")]) == 0


def _draft(client, admin_headers):
    body = {
        "name": "Draft Co", "token_symbol": "DRF", "description": "x", "website": "https://d.example.com", "socials": ["https://x.com/d"],
        "category": "DeFi", "blockchain": "Arc Testnet", "tge_info": "soon", "evidence": "e",
    }
    pid = client.post("/api/admin/projects", headers=admin_headers, json=body).json()["id"]
    end = (NOW + dt.timedelta(days=30)).isoformat()
    mk = client.post("/api/admin/markets", headers=admin_headers, json={"project_id": pid, "lot_size": 10**18, "tick_size": 10_000, "min_lots": 1, "max_lots": 100, "trading_start": NOW.isoformat(), "trading_end": end})
    assert mk.status_code == 200, mk.text
    return pid, mk.json()


def test_draft_can_be_edited_with_a_tge_date_then_discarded(client, admin_headers):
    pid, mk = _draft(client, admin_headers)
    tge = (NOW + dt.timedelta(days=20)).isoformat()
    edit = {"lot_size": 10**6, "tick_size": 10_000, "min_lots": 2, "max_lots": 50, "trading_start": NOW.isoformat(), "trading_end": (NOW + dt.timedelta(days=25)).isoformat(), "tge_date": tge, "token_decimals": 6}
    r = client.put(f"/api/admin/markets/{mk['id']}", headers=admin_headers, json=edit)
    assert r.status_code == 200 and r.json()["tge_date"].startswith(tge[:10]) and r.json()["token_decimals"] == 6 and r.json()["min_lots"] == "2"
    assert client.put(f"/api/admin/markets/{mk['id']}", headers=admin_headers, json={**edit, "max_lots": 1}).status_code == 422
    assert client.put(f"/api/admin/markets/{mk['id']}", headers=login(client, make_wallet(96)), json=edit).status_code == 403
    assert client.get(f"/api/admin/projects/{pid}", headers=admin_headers).json()["status"] == "Market Setup"
    assert client.delete(f"/api/admin/markets/{mk['id']}", headers=admin_headers).status_code == 200
    assert client.get(f"/api/admin/projects/{pid}", headers=admin_headers).json()["status"] == "Approved"
    assert client.delete(f"/api/admin/markets/{mk['id']}", headers=admin_headers).status_code == 404


def test_on_chain_market_cannot_be_edited_or_discarded(client, admin_headers):
    with SessionLocal() as db:
        m = seed_market(db, 1, "Chain Co", "CHN")
        mid = m.id
        db.commit()
    edit = {"lot_size": 1, "tick_size": 1, "min_lots": 1, "max_lots": 1, "trading_start": NOW.isoformat(), "trading_end": (NOW + dt.timedelta(days=2)).isoformat()}
    assert client.put(f"/api/admin/markets/{mid}", headers=admin_headers, json=edit).status_code == 409
    assert client.delete(f"/api/admin/markets/{mid}", headers=admin_headers).status_code == 409
    with SessionLocal() as db:
        assert db.get(Market, mid) is not None
