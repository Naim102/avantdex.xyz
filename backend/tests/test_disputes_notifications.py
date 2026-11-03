import datetime as dt

from app.db import SessionLocal
from app.models import Notification, Trade

from .conftest import grant, login, make_wallet


def seed_trade(buyer: str, seller: str):
    with SessionLocal() as db:
        db.add(Trade(
            id=1, market_onchain_id=1, buy_order_id=1, sell_order_id=2, buyer=buyer, seller=seller, lots=1, price=10**6, value=10**6,
            buyer_fee=5000, seller_fee=5000, status="Open", tx_hash="0x" + "1" * 64, block_number=1, created_at=dt.datetime.now(dt.timezone.utc),
        ))
        db.commit()


def test_dispute_only_for_participants_and_never_moves_funds(client):
    buyer, seller, stranger = make_wallet(61), make_wallet(62), make_wallet(63)
    seed_trade(buyer.address, seller.address)
    body = {"trade_id": 1, "reason": "Seller says the token address is wrong", "evidence": ["https://example.com/proof"]}
    assert client.post("/api/disputes", json=body, headers=login(client, stranger)).status_code == 404
    bh = login(client, buyer)
    assert client.post("/api/disputes", json={**body, "evidence": ["http://insecure"]}, headers=bh).status_code == 422
    r = client.post("/api/disputes", json=body, headers=bh)
    assert r.status_code == 200 and r.json()["status"] == "Open"
    assert "cannot move funds" in r.json()["note"]
    assert len(client.get("/api/disputes/mine", headers=bh).json()["items"]) == 1
    assert client.get("/api/disputes/mine", headers=login(client, seller)).json()["items"] == []


def test_support_admin_manages_tickets(client):
    buyer, support, reviewer = make_wallet(61), make_wallet(64), make_wallet(65)
    seed_trade(buyer.address, make_wallet(62).address)
    grant({support.address: ["support_admin"], reviewer.address: ["project_reviewer"]})
    did = client.post("/api/disputes", json={"trade_id": 1, "reason": "help"}, headers=login(client, buyer)).json()["id"]
    sh, rh = login(client, support), login(client, reviewer)
    assert client.get("/api/admin/disputes", headers=rh).status_code == 403
    assert client.post(f"/api/admin/disputes/{did}", headers=sh, json={"status": "bogus"}).status_code == 422
    r = client.post(f"/api/admin/disputes/{did}", headers=sh, json={"status": "In Review", "note": "Looking into it"})
    assert r.status_code == 200 and r.json()["status"] == "In Review" and len(r.json()["notes"]) == 1
    # support admins cannot change project statuses or grant badges
    assert client.post("/api/admin/projects/1/transition", headers=sh, json={"to": "Approved"}).status_code in (403, 404)
    logs = client.get("/api/admin/audit-logs?action=dispute", headers=sh).json()["items"]
    assert logs and logs[0]["action"] == "dispute.update"


def test_notifications_are_private_and_markable(client):
    a, b = make_wallet(66), make_wallet(67)
    with SessionLocal() as db:
        db.add(Notification(address=a.address, kind="trade_created", title="Matched", dedupe_key="k1"))
        db.add(Notification(address=b.address, kind="trade_created", title="Other", dedupe_key="k2"))
        db.commit()
    ah, bh = login(client, a), login(client, b)
    n = client.get("/api/notifications", headers=ah).json()
    assert n["unread"] == 1 and [x["title"] for x in n["items"]] == ["Matched"]
    nid = n["items"][0]["id"]
    assert client.post(f"/api/notifications/{nid}/read", headers=bh).status_code == 404  # not theirs
    assert client.post(f"/api/notifications/{nid}/read", headers=ah).status_code == 200
    assert client.get("/api/notifications", headers=ah).json()["unread"] == 0
    assert client.post("/api/notifications/read-all", headers=bh).status_code == 200
    assert client.get("/api/notifications", headers=bh).json()["unread"] == 0
