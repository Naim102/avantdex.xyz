"""Integration tests against a real local chain (anvil) with the compiled contracts.

Run with CHAIN_RPC=http://host:8545 and CONTRACT_OUT_DIR=/path/to/contracts/out (see scripts/test-backend.sh).
They deploy the exchange, drive real transactions, run the real indexer and check the API/DB.
"""

from __future__ import annotations

import datetime as dt
import json
import os
from pathlib import Path

import pytest
from web3 import Web3

from .conftest import grant, login, make_wallet
from .test_projects import GOOD

RPC = os.environ.get("CHAIN_RPC")
OUT = os.environ.get("CONTRACT_OUT_DIR")
pytestmark = [pytest.mark.chain, pytest.mark.skipif(not (RPC and OUT), reason="needs CHAIN_RPC and CONTRACT_OUT_DIR")]

COLLECTOR = Web3.to_checksum_address("0x136a2C17E0E6C077F48F489BeC6DBCE3202CEbd6")
ONE = 10**6
LOT = 10**18
TICK = 10**4

# Well-known public anvil development keys (no value): only used to sign API logins for chain accounts.
ANVIL_KEYS = {
    1: "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
    2: "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a",
}


def artifact(sol: str, name: str) -> dict:
    return json.loads((Path(OUT) / f"{sol}.sol" / f"{name}.json").read_text())


class Chain:
    def __init__(self):
        self.w3 = Web3(Web3.HTTPProvider(RPC))
        a = self.w3.eth.accounts
        self.deployer, self.seller, self.buyer, self.other = a[0], a[1], a[2], a[3]
        self.start_block = self.w3.eth.block_number

    def deploy(self, sol: str, name: str, *args):
        art = artifact(sol, name)
        c = self.w3.eth.contract(abi=art["abi"], bytecode=art["bytecode"]["object"])
        h = c.constructor(*args).transact({"from": self.deployer})
        r = self.w3.eth.wait_for_transaction_receipt(h)
        assert r.status == 1
        return self.w3.eth.contract(address=r.contractAddress, abi=art["abi"])

    def send(self, fn, sender):
        h = fn.transact({"from": sender})
        r = self.w3.eth.wait_for_transaction_receipt(h)
        assert r.status == 1, "transaction reverted"
        return r

    def now(self) -> int:
        return self.w3.eth.get_block("latest")["timestamp"]

    def warp(self, seconds: int) -> None:
        self.w3.provider.make_request("evm_increaseTime", [seconds])
        self.w3.provider.make_request("evm_mine", [])


@pytest.fixture
def chain(monkeypatch):
    from app import db as app_db
    from app.config import get_settings

    ch = Chain()
    ch.usdc = ch.deploy("MockTokens", "BlocklistUSDC")
    ch.token = ch.deploy("MockTokens", "MockERC20")
    ch.ex = ch.deploy("AvantdexExchange", "AvantdexExchange", ch.usdc.address, COLLECTOR, ch.deployer)
    for who in (ch.seller, ch.buyer, ch.other):
        ch.send(ch.usdc.functions.mint(who, 1_000_000 * ONE), ch.deployer)
        ch.send(ch.usdc.functions.approve(ch.ex.address, 2**255), who)
        ch.send(ch.token.functions.mint(who, 1_000_000 * 10**18), ch.deployer)
        ch.send(ch.token.functions.approve(ch.ex.address, 2**255), who)

    monkeypatch.setenv("RPC_URL", RPC)
    monkeypatch.setenv("EXCHANGE_ADDRESS", ch.ex.address)
    monkeypatch.setenv("USDC_ADDRESS", ch.usdc.address)
    monkeypatch.setenv("EXCHANGE_DEPLOY_BLOCK", str(ch.start_block))
    get_settings.cache_clear()
    app_db.reset_engine()
    return ch


def indexer():
    from app.indexer.worker import Indexer

    ix = Indexer()
    ix.catch_up()
    return ix


def snapshot():
    from sqlalchemy import select

    from app.db import SessionLocal
    from app.models import Order, Trade

    with SessionLocal() as db:
        orders = [(o.id, o.owner, o.side, o.price, o.lots, o.filled, o.locked, o.status) for o in db.scalars(select(Order).order_by(Order.id))]
        trades = [(t.id, t.buyer, t.seller, t.lots, t.price, t.value, t.buyer_fee, t.seller_fee, t.status) for t in db.scalars(select(Trade).order_by(Trade.id))]
    return orders, trades


def approved_project(client, name="Orbit Protocol", symbol="ORB"):
    applicant = make_wallet(0x71)
    super_admin = make_wallet(0x72)
    grant({super_admin.address: ["super_admin"]})
    ah = login(client, applicant)
    pid = client.post("/api/projects", headers=ah, json={**GOOD, "name": name, "token_symbol": symbol, "team_wallet": applicant.address}).json()["id"]
    assert client.post(f"/api/projects/{pid}/submit", headers=ah).status_code == 200
    sh = login(client, super_admin)
    for to in ("Under Review", "Verification", "Approved"):
        assert client.post(f"/api/admin/projects/{pid}/transition", headers=sh, json={"to": to}).status_code == 200
    return pid, sh


def create_market_on_chain(client, chain, pid, sh):
    now = chain.now()
    iso = lambda t: dt.datetime.fromtimestamp(t, tz=dt.timezone.utc).isoformat()
    r = client.post(
        "/api/admin/markets",
        headers=sh,
        json={"project_id": pid, "lot_size": LOT, "tick_size": TICK, "min_lots": 1, "max_lots": 1000, "trading_start": iso(now - 60), "trading_end": iso(now + 30 * 86400)},
    )
    assert r.status_code == 200, r.text
    mk = r.json()
    p = mk["onchain_params"]
    chain.send(
        chain.ex.functions.createMarket(
            Web3.to_checksum_address(p["token"]), int(p["lotSize"]), int(p["tickSize"]), int(p["minLots"]), int(p["maxLots"]),
            p["tradingStart"], p["tradingEnd"], bytes.fromhex(p["metadataRef"][2:]),
        ),
        chain.deployer,
    )
    return mk


def place(chain, who, market, side, price, lots, makers=(), ioc=False, min_fill=0):
    expiry = chain.now() + 29 * 86400
    return chain.send(chain.ex.functions.placeOrder(market, side, price, lots, expiry, ioc, min_fill, list(makers)), who)


def test_full_lifecycle_indexer_api_fees_and_replay(client, chain):
    pid, sh = approved_project(client)
    mk = create_market_on_chain(client, chain, pid, sh)
    indexer()

    # --- market bound to its DB record by metadata_ref
    adm = client.get(f"/api/admin/markets/{mk['id']}", headers=sh).json()
    assert adm["onchain_id"] == 1 and adm["status"] == "Setup" and adm["project_status"] == "Market Setup"
    assert client.get("/api/markets").json()["items"] == []  # Setup markets are not public

    # --- configuration verified against the chain, then activated
    v = client.get(f"/api/admin/markets/{mk['id']}/verify-config", headers=sh).json()
    assert v["config_ok"] and v["chain_status"] == "Setup"
    assert client.post(f"/api/admin/markets/{mk['id']}/approve-activation", headers=sh).status_code == 200
    chain.send(chain.ex.functions.activateMarket(1), chain.deployer)
    indexer()
    pub = client.get("/api/markets").json()["items"]
    assert len(pub) == 1 and pub[0]["status"] == "Live"
    assert pub[0]["stats"]["volume_total"] == "0" and pub[0]["stats"]["last_price"] is None  # no fabricated data
    assert client.get(f"/api/admin/projects/{pid}", headers=sh).json()["status"] == "Live"

    # --- seller rests 10 lots @ 2.00; buyer takes 4 using the API match plan
    place(chain, chain.seller, 1, 1, 2 * ONE, 10)
    indexer()
    plan = client.get("/api/markets/orbit-protocol/match-plan", params={"side": "buy", "price": 2_500_000, "lots": 4, "address": chain.buyer.lower()}).json()
    assert plan["maker_ids"] == [1] and plan["expected_fill_lots"] == "4" and plan["expected_value"] == str(8 * ONE)
    assert plan["expected_fee"] == str(8 * ONE * 50 // 10_000)
    r = place(chain, chain.buyer, 1, 0, 2_500_000, 4, plan["maker_ids"], ioc=True, min_fill=4)
    indexer()

    book = client.get("/api/markets/1/orderbook").json()
    assert book["asks"] == [{"price": str(2 * ONE), "lots": "6", "orders": 1, "cumulative_lots": "6"}]
    assert book["bids"] == [] and book["best_ask"] == str(2 * ONE)
    trades = client.get("/api/markets/orbit-protocol/trades").json()["items"]
    assert len(trades) == 1 and trades[0]["price"] == str(2 * ONE) and trades[0]["value"] == str(8 * ONE) and trades[0]["tx_hash"].startswith("0x")
    stats = client.get("/api/markets/1/stats").json()
    assert stats["volume_total"] == str(8 * ONE) and stats["volume_24h"] == str(8 * ONE) and stats["open_interest"] == str(8 * ONE) and stats["last_price"] == str(2 * ONE)

    # buyer also rests a bid
    place(chain, chain.buyer, 1, 0, ONE, 3)
    indexer()
    book = client.get("/api/markets/1/orderbook").json()
    assert book["bids"][0]["price"] == str(ONE) and book["spread"] == str(ONE)

    # --- portfolio
    pb = client.get(f"/api/portfolio/{chain.buyer}/summary").json()
    fee = 8 * ONE * 50 // 10_000
    assert pb["open_orders"] == 1 and pb["open_trades"] == 1
    assert pb["locked_in_trades"] == str(8 * ONE + fee)
    assert pb["locked_in_orders"] == str(3 * ONE + 3 * ONE * 50 // 10_000)
    ps = client.get(f"/api/portfolio/{chain.seller}/summary").json()
    assert ps["locked_in_trades"] == str(8 * ONE) and ps["locked_in_orders"] == str(12 * ONE)
    seller_orders = client.get(f"/api/portfolio/{chain.seller}/orders").json()["items"]
    assert seller_orders[0]["status"] == "Partially Filled" and seller_orders[0]["filled"] == "4"
    buyer_trades = client.get(f"/api/portfolio/{chain.buyer}/trades").json()["items"]
    assert buyer_trades[0]["role"] == "buyer" and buyer_trades[0]["status"] == "Open"

    # --- notifications (signed in with the public anvil dev key of the buyer)
    from eth_account import Account

    class Dev:
        def __init__(self, key):
            self.account = Account.from_key(key)
            self.address = self.account.address.lower()

        def sign(self, m):
            from eth_account.messages import encode_defunct

            return self.account.sign_message(encode_defunct(text=m)).signature.hex()

    bh = login(client, Dev(ANVIL_KEYS[2]))
    notes = client.get("/api/notifications", headers=bh).json()
    assert notes["unread"] >= 1 and any(n["kind"] == "trade_created" for n in notes["items"])

    # --- TGE: settlement opens, seller delivers atomically
    chain.send(chain.ex.functions.openSettlement(1, chain.token.address, 3600), chain.deployer)
    indexer()
    m = client.get("/api/markets/1").json()
    assert m["status"] == "SettlementOpen" and m["settlement_deadline"] and m["token_address"] == chain.token.address.lower()
    buyer_tokens = chain.token.functions.balanceOf(chain.buyer).call()
    collector_before = chain.usdc.functions.balanceOf(COLLECTOR).call()
    chain.send(chain.ex.functions.settleTrade(1), chain.seller)
    indexer()
    assert chain.token.functions.balanceOf(chain.buyer).call() - buyer_tokens == 4 * LOT
    assert chain.usdc.functions.balanceOf(COLLECTOR).call() - collector_before == 2 * fee  # 0.5% + 0.5%
    t = client.get(f"/api/portfolio/{chain.buyer}/trades").json()["items"][0]
    assert t["status"] == "Settled" and t["closed_tx_hash"]
    ov = client.get("/api/admin/overview", headers=sh).json()
    assert ov["fees_collected"] == str(2 * fee) and ov["settled_trades"] == 1 and ov["fee_collector"].lower() == COLLECTOR.lower()

    # cancelling resting orders returns funds with no fee, then the market completes
    buyer_usdc = chain.usdc.functions.balanceOf(chain.buyer).call()
    chain.send(chain.ex.functions.cancelOrder(3), chain.buyer)
    assert chain.usdc.functions.balanceOf(chain.buyer).call() - buyer_usdc == 3 * ONE + 3 * ONE * 50 // 10_000
    chain.send(chain.ex.functions.cancelOrder(1), chain.seller)
    chain.send(chain.ex.functions.completeMarket(1), chain.deployer)
    indexer()
    assert client.get("/api/markets?tab=settled").json()["count"] == 1
    assert client.get(f"/api/admin/projects/{pid}", headers=sh).json()["status"] == "Completed"
    assert chain.usdc.functions.balanceOf(chain.ex.address).call() == 0  # nothing left in escrow
    orders = {o["id"]: o["status"] for o in client.get(f"/api/portfolio/{chain.buyer}/orders").json()["items"]}
    assert orders[3] == "Cancelled"

    # --- replay: drop every mirrored table, re-index from the deploy block, state must be identical
    before = snapshot()
    from sqlalchemy import text

    from app.db import SessionLocal

    with SessionLocal() as db:
        for tbl in ("orders", "trades", "chain_events", "notifications", "claimable_credits", "indexer_state"):
            db.execute(text(f"DELETE FROM {tbl}"))
        db.commit()
    indexer()
    assert snapshot() == before
    assert len(before[0]) == 3 and len(before[1]) == 1


def test_default_claim_and_claimable_credit_are_indexed(client, chain):
    pid, sh = approved_project(client, "Delta Chain", "DLT")
    create_market_on_chain(client, chain, pid, sh)
    chain.send(chain.ex.functions.activateMarket(1), chain.deployer)
    place(chain, chain.seller, 1, 1, 3 * ONE, 5)
    place(chain, chain.buyer, 1, 0, 3 * ONE, 5, [1], ioc=True, min_fill=5)
    chain.send(chain.ex.functions.openSettlement(1, chain.token.address, 3600), chain.deployer)
    chain.warp(3700)
    # buyer is blocklisted: the default payout becomes a claimable credit instead of reverting
    chain.send(chain.usdc.functions.setBlocked(chain.buyer, True), chain.deployer)
    chain.send(chain.ex.functions.claimDefault(1), chain.buyer)
    indexer()

    t = client.get(f"/api/portfolio/{chain.buyer}/trades").json()["items"][0]
    assert t["status"] == "Defaulted"
    fee = 15 * ONE * 50 // 10_000
    s = client.get(f"/api/portfolio/{chain.buyer}/summary").json()
    assert s["claimable"] == str(2 * 15 * ONE + fee)
    chain.send(chain.usdc.functions.setBlocked(chain.buyer, False), chain.deployer)
    chain.send(chain.ex.functions.withdrawClaimable(), chain.buyer)
    indexer()
    assert client.get(f"/api/portfolio/{chain.buyer}/summary").json()["claimable"] == "0"
    # a failed trade pays no platform fee
    assert chain.usdc.functions.balanceOf(COLLECTOR).call() == 0
    ov = client.get("/api/admin/overview", headers=sh).json()
    assert ov["fees_collected"] == "0"


def test_mismatched_config_blocks_activation(client, chain):
    pid, sh = approved_project(client, "Wrong Config", "WRG")
    now = chain.now()
    iso = lambda t: dt.datetime.fromtimestamp(t, tz=dt.timezone.utc).isoformat()
    mk = client.post(
        "/api/admin/markets",
        headers=sh,
        json={"project_id": pid, "lot_size": LOT, "tick_size": TICK, "min_lots": 1, "max_lots": 1000, "trading_start": iso(now - 60), "trading_end": iso(now + 30 * 86400)},
    ).json()
    p = mk["onchain_params"]
    # on-chain market created with a DIFFERENT tick size than the draft
    chain.send(
        chain.ex.functions.createMarket(
            "0x0000000000000000000000000000000000000000", int(p["lotSize"]), int(p["tickSize"]) * 2, 1, 1000, p["tradingStart"], p["tradingEnd"], bytes.fromhex(p["metadataRef"][2:])
        ),
        chain.deployer,
    )
    indexer()
    v = client.get(f"/api/admin/markets/{mk['id']}/verify-config", headers=sh).json()
    assert v["config_ok"] is False and v["can_activate"] is False
    assert [c["field"] for c in v["checks"] if not c["ok"]] == ["tick_size"]


def test_indexer_is_idempotent_and_reports_lag(client, chain):
    pid, sh = approved_project(client, "Idem", "IDM")
    create_market_on_chain(client, chain, pid, sh)
    ix = indexer()
    first = snapshot()
    ix.run_once()
    ix.run_once()
    assert snapshot() == first
    h = client.get("/api/health").json()
    assert h["indexer"]["lag_blocks"] == 0 and h["indexer"]["last_block"] >= chain.start_block


def test_a_draft_sent_to_the_chain_twice_keeps_the_first_market(client, chain):
    """Regression: clicking Create on-chain again created copies that took over the draft record (the draft pointed at the last copy)."""
    pid, sh = approved_project(client, "Twice", "TWC")
    mk = create_market_on_chain(client, chain, pid, sh)
    p = mk["onchain_params"]
    for _ in range(2):
        chain.send(
            chain.ex.functions.createMarket(
                Web3.to_checksum_address(p["token"]), int(p["lotSize"]), int(p["tickSize"]), int(p["minLots"]), int(p["maxLots"]),
                p["tradingStart"], p["tradingEnd"], bytes.fromhex(p["metadataRef"][2:]),
            ),
            chain.deployer,
        )
    indexer()
    got = client.get(f"/api/admin/markets/{mk['id']}", headers=sh).json()
    first_id = chain.ex.functions.marketCount().call() - 2
    assert got["onchain_id"] == first_id and got["status"] == "Setup"
    from sqlalchemy import func, select

    from app.db import SessionLocal
    from app.models import Market

    with SessionLocal() as db:
        assert db.scalar(select(func.count(Market.id))) == 1  # no orphan rows for the copies


def test_new_contract_resets_chain_data_but_keeps_projects(client, chain, monkeypatch):
    from app import db as app_db
    from app.config import get_settings
    from app.db import SessionLocal
    from app.models import ChainEvent, Market, Project
    from sqlalchemy import func, select

    pid, sh = approved_project(client, "Moves", "MOV")
    mk = create_market_on_chain(client, chain, pid, sh)
    indexer()
    with SessionLocal() as db:
        assert db.scalar(select(func.count(ChainEvent.id))) > 0
        db.get(Project, pid).status = "Live"
        db.commit()
    # deploy a second exchange and point the indexer at it
    ex2 = chain.deploy("AvantdexExchange", "AvantdexExchange", chain.usdc.address, COLLECTOR, chain.deployer)
    monkeypatch.setenv("EXCHANGE_ADDRESS", ex2.address)
    monkeypatch.setenv("EXCHANGE_DEPLOY_BLOCK", str(chain.w3.eth.block_number))
    get_settings.cache_clear()
    app_db.reset_engine()
    indexer()
    with SessionLocal() as db:
        assert db.scalar(select(func.count(Market.id))) == 0
        assert db.get(Project, pid).status == "Approved"
        assert db.get(Project, pid).name == "Moves"
        assert db.scalar(select(func.count(ChainEvent.id))) <= 4  # only the new contract's setup events
