"""Public market API behaviour on seeded rows (no chain needed)."""

import datetime as dt

from app.db import SessionLocal
from app.models import Market, Order, Project, Trade, VerificationBadge

NOW = dt.datetime.now(dt.timezone.utc)
ONE = 10**6
A, B, C = "0x" + "a" * 40, "0x" + "b" * 40, "0x" + "c" * 40


def seed_market(db, oid, name, symbol, *, status="Live", category="DeFi", tge_days=None, end_days=30, badges=(), activated_days=0):
    p = Project(
        slug=name.lower().replace(" ", "-"), applicant=A, status="Live", name=name, token_symbol=symbol, category=category,
        tge_date=None if tge_days is None else NOW + dt.timedelta(days=tge_days),
    )
    for b in badges:
        p.badges.append(VerificationBadge(badge=b, granted_by=A))
    db.add(p)
    db.flush()
    m = Market(
        project_id=p.id, slug=p.slug, metadata_ref="0x" + f"{oid:064x}", onchain_id=oid, status=status,
        lot_size=10**18, tick_size=10**4, min_lots=1, max_lots=1000,
        trading_start=NOW - dt.timedelta(days=1), trading_end=NOW + dt.timedelta(days=end_days),
        activated_at=NOW - dt.timedelta(days=activated_days),
    )
    db.add(m)
    db.flush()
    return m


def order(db, oid, market, side, price, lots, owner=A, filled=0, expiry_days=10, age=0, status="Open"):
    db.add(Order(
        id=oid, market_onchain_id=market, owner=owner, side=side, price=price, lots=lots, filled=filled, locked=0, status=status,
        ioc=False, expiry=NOW + dt.timedelta(days=expiry_days), tx_hash="0x" + "1" * 64, block_number=1,
        created_at=NOW - dt.timedelta(minutes=age),
    ))


def trade(db, tid, market, price, lots, buyer=B, seller=A, status="Open", hours_ago=1):
    value = price * lots
    db.add(Trade(
        id=tid, market_onchain_id=market, buy_order_id=1, sell_order_id=2, buyer=buyer, seller=seller, lots=lots, price=price,
        value=value, buyer_fee=value * 50 // 10000, seller_fee=value * 50 // 10000, status=status,
        tx_hash="0x" + "2" * 64, block_number=2, created_at=NOW - dt.timedelta(hours=hours_ago),
    ))


def test_tabs_filters_and_sorting(client):
    with SessionLocal() as db:
        seed_market(db, 1, "Alpha Net", "ALP", category="DeFi", tge_days=5, end_days=3, badges=("verified_project",), activated_days=1)
        seed_market(db, 2, "Beta Chain", "BET", category="AI", tge_days=40, end_days=30, activated_days=5)
        seed_market(db, 3, "Gamma Pay", "GAM", category="Payments", status="Completed", activated_days=9)
        seed_market(db, 4, "Hidden Setup", "HID", status="Setup")
        trade(db, 1, 2, 2 * ONE, 100)  # beta has more volume
        trade(db, 2, 1, 2 * ONE, 10)
        db.commit()

    names = lambda **p: [i["project"]["name"] for i in client.get("/api/markets", params=p).json()["items"]]
    assert sorted(names()) == ["Alpha Net", "Beta Chain", "Gamma Pay"]  # Setup market is never public
    assert names(tab="trending") == ["Beta Chain", "Alpha Net", "Gamma Pay"]
    assert names(tab="new") == ["Alpha Net", "Beta Chain", "Gamma Pay"]
    assert names(tab="upcoming_tge") == ["Alpha Net", "Beta Chain"]
    assert names(tab="closing_soon") == ["Alpha Net"]
    assert names(tab="settled") == ["Gamma Pay"]
    assert names(q="beta") == ["Beta Chain"] and names(q="GAM") == ["Gamma Pay"]
    assert names(category="AI") == ["Beta Chain"]
    assert names(status="Completed") == ["Gamma Pay"]
    assert names(badge="verified_project") == ["Alpha Net"]
    assert names(badge="contract_verified") == []
    assert client.get("/api/markets?tab=bogus").status_code == 422


def test_delisted_markets_are_hidden_from_discovery_only(client):
    with SessionLocal() as db:
        m = seed_market(db, 1, "Alpha Net", "ALP")
        m.delisted = True
        db.commit()
    assert client.get("/api/markets").json()["items"] == []
    assert client.get("/api/markets/alpha-net").status_code == 200  # still reachable by link (exits stay open)


def test_orderbook_aggregation_hides_expired_and_filled(client):
    with SessionLocal() as db:
        seed_market(db, 1, "Alpha Net", "ALP")
        order(db, 1, 1, "sell", 3 * ONE, 10)
        order(db, 2, 1, "sell", 3 * ONE, 5, filled=2)  # 3 left
        order(db, 3, 1, "sell", 4 * ONE, 4)
        order(db, 4, 1, "sell", 2 * ONE, 4, expiry_days=-1)  # expired: not in book
        order(db, 5, 1, "sell", 2 * ONE, 4, status="Cancelled")
        order(db, 6, 1, "sell", 2 * ONE, 4, filled=4, status="Filled")
        order(db, 7, 1, "buy", ONE, 6)
        order(db, 8, 1, "buy", 2 * ONE, 2)
        db.commit()
    book = client.get("/api/markets/1/orderbook").json()
    assert book["asks"] == [
        {"price": str(3 * ONE), "lots": "13", "orders": 2, "cumulative_lots": "13"},
        {"price": str(4 * ONE), "lots": "4", "orders": 1, "cumulative_lots": "17"},
    ]
    assert book["bids"][0] == {"price": str(2 * ONE), "lots": "2", "orders": 1, "cumulative_lots": "2"}
    assert book["bids"][1]["price"] == str(ONE) and book["bids"][1]["cumulative_lots"] == "8"
    assert book["best_bid"] == str(2 * ONE) and book["best_ask"] == str(3 * ONE) and book["spread"] == str(ONE)


def test_match_plan_is_best_price_first_then_oldest_and_respects_limit(client):
    with SessionLocal() as db:
        seed_market(db, 1, "Alpha Net", "ALP")
        order(db, 1, 1, "sell", 3 * ONE, 5, age=5)
        order(db, 2, 1, "sell", 2 * ONE, 5, age=1)
        order(db, 3, 1, "sell", 2 * ONE, 5, age=10)  # same price as #2 but older: first
        order(db, 4, 1, "sell", 9 * ONE, 5)  # beyond the limit
        order(db, 5, 1, "sell", 2 * ONE, 5, owner=C)  # caller's own order excluded
        db.commit()
    plan = client.get("/api/markets/1/match-plan", params={"side": "buy", "price": 3 * ONE, "lots": 12, "address": C}).json()
    assert plan["maker_ids"] == [3, 2, 1]
    assert plan["expected_fill_lots"] == "12" and plan["remaining_lots"] == "0"
    assert plan["expected_value"] == str(5 * 2 * ONE + 5 * 2 * ONE + 2 * 3 * ONE)
    # sell taker: best (highest) bids first
    with SessionLocal() as db:
        order(db, 10, 1, "buy", ONE, 5)
        order(db, 11, 1, "buy", 2 * ONE, 5)
        db.commit()
    plan = client.get("/api/markets/1/match-plan", params={"side": "sell", "price": ONE, "lots": 6}).json()
    assert plan["maker_ids"] == [11, 10]
    plan = client.get("/api/markets/1/match-plan", params={"side": "sell", "price": 3 * ONE, "lots": 6}).json()
    assert plan["maker_ids"] == [] and plan["expected_fill_lots"] == "0"
    assert client.get("/api/markets/1/match-plan", params={"side": "hold", "price": 1, "lots": 1}).status_code == 422


def test_stats_use_only_real_trades(client):
    with SessionLocal() as db:
        seed_market(db, 1, "Alpha Net", "ALP")
        db.commit()
    s = client.get("/api/markets/1/stats").json()
    assert s == {
        "last_price": None, "best_bid": None, "best_ask": None, "volume_24h": "0", "volume_total": "0", "open_interest": "0",
        "bid_depth": "0", "ask_depth": "0", "open_orders": 0, "trades": 0,
    }
    with SessionLocal() as db:
        trade(db, 1, 1, 2 * ONE, 10, hours_ago=30)  # older than 24h
        trade(db, 2, 1, 3 * ONE, 4, status="Settled", hours_ago=1)
        trade(db, 3, 1, 5 * ONE, 1, status="Open", hours_ago=2)
        db.commit()
    s = client.get("/api/markets/1/stats").json()
    assert s["volume_24h"] == str(12 * ONE + 5 * ONE)
    assert s["volume_total"] == str(20 * ONE + 12 * ONE + 5 * ONE)
    assert s["open_interest"] == str(20 * ONE + 5 * ONE)  # only Open trades
    assert s["last_price"] == str(5 * ONE)


def test_portfolio_display_statuses_and_validation(client):
    with SessionLocal() as db:
        seed_market(db, 1, "Alpha Net", "ALP")
        order(db, 1, 1, "buy", ONE, 10, owner=B)
        order(db, 2, 1, "buy", ONE, 10, owner=B, filled=3)
        order(db, 3, 1, "buy", ONE, 10, owner=B, expiry_days=-1)  # expired, cleanup pending
        order(db, 4, 1, "buy", ONE, 10, owner=B, filled=10, status="Filled")
        order(db, 5, 1, "sell", ONE, 10, owner=B, status="Cancelled")
        db.commit()
    items = client.get(f"/api/portfolio/{B}/orders").json()["items"]
    assert {i["id"]: i["status"] for i in items} == {1: "Open", 2: "Partially Filled", 3: "Expired", 4: "Filled", 5: "Cancelled"}
    assert [i["id"] for i in client.get(f"/api/portfolio/{B}/orders", params={"status": "Partially Filled"}).json()["items"]] == [2]
    assert [i["id"] for i in client.get(f"/api/portfolio/{B}/orders", params={"side": "sell"}).json()["items"]] == [5]
    assert client.get("/api/portfolio/not-an-address/orders").status_code == 422
    assert client.get(f"/api/portfolio/{A}/orders").json()["items"] == []


def test_unknown_market_404(client):
    assert client.get("/api/markets/999").status_code == 404
    assert client.get("/api/markets/999/orderbook").status_code == 404


def test_depth_and_platform_stats_come_from_indexed_rows(client):
    with SessionLocal() as db:
        seed_market(db, 1, "Alpha Net", "ALP")
        order(db, 1, 1, "buy", 2 * ONE, 10)           # bid depth 20 USDC
        order(db, 2, 1, "buy", 1 * ONE, 4, filled=2)  # remaining 2 lots at 1 USDC = 2 USDC
        order(db, 3, 1, "sell", 3 * ONE, 5)           # ask depth 15 USDC
        order(db, 4, 1, "sell", 3 * ONE, 5, expiry_days=-1)  # expired: not counted
        trade(db, 1, 1, 2 * ONE, 3, status="Settled")
        trade(db, 2, 1, 2 * ONE, 4, status="Open", hours_ago=30)
        db.commit()
    s = client.get("/api/markets").json()["items"][0]["stats"]
    assert (s["bid_depth"], s["ask_depth"], s["open_orders"], s["trades"]) == (str(22 * ONE), str(15 * ONE), 3, 2)
    g = client.get("/api/stats").json()
    assert g["markets_live"] == 1 and g["open_orders"] == 3 and g["trades_total"] == 2 and g["trades_settled"] == 1
    assert g["volume_total"] == str(14 * ONE) and g["volume_24h"] == str(6 * ONE) and g["open_interest"] == str(8 * ONE)
    assert g["bid_depth"] == str(22 * ONE) and g["ask_depth"] == str(15 * ONE)
    assert g["fees_paid"] == str(6 * ONE * 100 // 10000)  # 0.5% + 0.5% of the one settled trade


def test_recent_trades_feed_lists_public_markets_only(client):
    with SessionLocal() as db:
        seed_market(db, 1, "Alpha Net", "ALP")
        seed_market(db, 2, "Hidden Setup", "HID", status="Setup")
        trade(db, 1, 1, 2 * ONE, 3, hours_ago=3)
        trade(db, 2, 1, 2 * ONE, 4, hours_ago=1)
        db.commit()
    items = client.get("/api/trades/recent").json()["items"]
    assert [t["id"] for t in items] == [2, 1]
    assert items[0]["market"]["name"] == "Alpha Net" and items[0]["market"]["symbol"] == "ALP"
    assert len(client.get("/api/trades/recent", params={"limit": 1}).json()["items"]) == 1
