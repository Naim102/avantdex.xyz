"""Creates a few clearly labelled DEMO markets with real on-chain orders and trades, so every part of the
interface (market board, bid/ask, volume, liquidity, depth chart, open interest) has something to show.

Everything is real testnet state: projects are created through the real API, markets and orders are real
transactions on the exchange contract. The "tokens" are the worthless open-mint demo ERC-20; the projects are
named "Demo ..." and say so in their description. The exchange only supports ERC-20 tokens (there is no NFT market).

Environment:
  API_URL, RPC_URL, EXCHANGE_ADDRESS, DEMO_TOKEN_ADDRESS
  ADMIN_PRIVATE_KEY   an admin wallet of the dashboard (BOOTSTRAP_ADMIN_ADDRESSES / ADMIN_ROLES) that also holds the
                      on-chain MARKET_MANAGER role; it also places the sell orders
  TRADER_PRIVATE_KEY  a second wallet that places the buy orders
  SEED_SCALE          optional, multiplies order sizes (default 1; use 0 for markets without orders)
  SEED_MARKETS        optional, how many demo markets to create (default 3, max 6)
Each market needs about 5 USDC of testnet USDC in total (two asks and two bids at the 1 USDC minimum order value,
plus one small trade). It stays locked in resting orders and can be cancelled back at any time. Safe to run twice:
projects that already exist by name are skipped.
"""

from __future__ import annotations

import datetime as dt
import json
import os
import sys
import time
from pathlib import Path

import httpx
from eth_account import Account
from eth_account.messages import encode_defunct
from web3 import Web3

API = os.environ.get("API_URL", "http://localhost:8000").rstrip("/")
RPC = os.environ.get("RPC_URL", "https://rpc.testnet.arc.io")
EXCHANGE = Web3.to_checksum_address(os.environ["EXCHANGE_ADDRESS"])
DEMO = Web3.to_checksum_address(os.environ["DEMO_TOKEN_ADDRESS"])
USDC = Web3.to_checksum_address("0x3600000000000000000000000000000000000000")
ADMIN = Account.from_key(os.environ["ADMIN_PRIVATE_KEY"])
TRADER = Account.from_key(os.environ["TRADER_PRIVATE_KEY"])
SCALE = int(os.environ.get("SEED_SCALE", "1"))
LIMIT = int(os.environ.get("SEED_MARKETS", "3"))  # how many demo markets to create (max 6)
ONE = 10**6
TICK = 10_000  # 0.01 USDC per token
MAX_FEE = Web3.to_wei(25, "gwei")  # Arc guidance: at least 20 gwei

w3 = Web3(Web3.HTTPProvider(RPC, request_kwargs={"timeout": 30}))
assert w3.eth.chain_id == 5042002, "this script only runs against Arc Testnet (or a local chain using its chain id)"
EX_ABI = json.loads((Path(__file__).resolve().parent.parent / "backend" / "app" / "abi" / "AvantdexExchange.json").read_text())
ERC20 = [
    {"type": "function", "name": "approve", "stateMutability": "nonpayable", "inputs": [{"name": "s", "type": "address"}, {"name": "a", "type": "uint256"}], "outputs": [{"type": "bool"}]},
    {"type": "function", "name": "allowance", "stateMutability": "view", "inputs": [{"name": "o", "type": "address"}, {"name": "s", "type": "address"}], "outputs": [{"type": "uint256"}]},
    {"type": "function", "name": "balanceOf", "stateMutability": "view", "inputs": [{"name": "a", "type": "address"}], "outputs": [{"type": "uint256"}]},
]
ex = w3.eth.contract(address=EXCHANGE, abi=EX_ABI)
usdc = w3.eth.contract(address=USDC, abi=ERC20)

# name, symbol, category, mid price in USDC per token, description
DEMOS = [
    ("Demo Perp Protocol", "DPP", "DeFi", 0.40, "Demo project on a worthless testnet token. It exists only to show how an Avantdex market looks."),
    ("Demo Arc Games", "DAG", "Gaming", 0.25, "Demo project on a worthless testnet token. It exists only to show how an Avantdex market looks."),
    ("Demo Pay Rails", "DPR", "Payments", 0.60, "Demo project on a worthless testnet token. It exists only to show how an Avantdex market looks."),
    ("Demo Compute Net", "DCN", "AI", 0.15, "Demo project on a worthless testnet token. It exists only to show how an Avantdex market looks."),
    ("Demo Rollup Labs", "DRL", "Infrastructure", 0.85, "Demo project on a worthless testnet token. It exists only to show how an Avantdex market looks."),
    ("Demo Vault RWA", "DVR", "RWA", 0.32, "Demo project on a worthless testnet token. It exists only to show how an Avantdex market looks."),
]
ASKS = [(1.02, 1), (1.07, 1)]  # (multiple of mid price, lots); sizes are raised to the 1 USDC minimum order value
BIDS = [(0.98, 1), (0.93, 1)]


def send(label: str, account, fn):
    tx = fn.build_transaction({"from": account.address, "chainId": 5042002, "nonce": w3.eth.get_transaction_count(account.address), "maxFeePerGas": MAX_FEE, "maxPriorityFeePerGas": Web3.to_wei(1, "gwei")})
    h = w3.eth.send_raw_transaction(account.sign_transaction(tx).raw_transaction)
    r = w3.eth.wait_for_transaction_receipt(h, timeout=120)
    assert r.status == 1, f"{label} reverted: {h.hex()}"
    print(f"  ok  {label}  {'0x' + h.hex().removeprefix('0x')}")
    return r


def login(client: httpx.Client, account) -> dict:
    n = client.post("/api/auth/nonce", json={"address": account.address}).json()
    sig = account.sign_message(encode_defunct(text=n["message"])).signature.hex()
    r = client.post("/api/auth/verify", json={"address": account.address, "nonce": n["nonce"], "signature": sig})
    r.raise_for_status()
    return {"Authorization": f"Bearer {r.json()['token']}"}


def ok(r: httpx.Response) -> httpx.Response:
    assert r.status_code < 300, f"{r.request.method} {r.request.url.path} -> {r.status_code} {r.text[:300]}"
    return r


def wait(cond, what: str, timeout=90):
    end = time.time() + timeout
    while time.time() < end:
        try:
            if cond():
                return
        except Exception:
            pass
        time.sleep(2)
    raise AssertionError(f"timed out waiting for: {what}")


def size(lots: int, price_lot: int) -> int:
    """Order size in lots: the requested size, but never below the contract's minimum order value (1 USDC)."""
    return max(lots * SCALE, -(-int(1.05 * ONE) // price_lot))


def tick(price: float) -> int:
    """USDC base units per 1-token lot, rounded to the tick size."""
    return max(TICK, round(price * ONE / TICK) * TICK)


def ensure_allowance(account) -> None:
    if usdc.functions.allowance(account.address, EXCHANGE).call() < 10**15:
        send(f"{account.address[:8]} approves USDC", account, usdc.functions.approve(EXCHANGE, 2**255))


def main() -> None:
    client = httpx.Client(base_url=API, timeout=30)
    assert client.get("/api/health").json()["status"] == "ok", "the API is not healthy"
    ah = login(client, ADMIN)
    me = client.get("/api/admin/overview", headers=ah)
    assert me.status_code == 200, "ADMIN_PRIVATE_KEY is not an admin wallet of the dashboard (see BOOTSTRAP_ADMIN_ADDRESSES / ADMIN_ROLES)"
    manager_role = ex.functions.MARKET_MANAGER_ROLE().call()
    assert ex.functions.hasRole(manager_role, ADMIN.address).call(), "the admin wallet does not hold the on-chain MARKET_MANAGER role"
    existing = {p["name"] for p in client.get("/api/admin/projects", headers=ah).json()["items"]}
    ensure_allowance(ADMIN)
    ensure_allowance(TRADER)

    now = int(time.time())
    iso = lambda t: dt.datetime.fromtimestamp(t, tz=dt.timezone.utc).isoformat()
    expiry = now + 19 * 86400  # the contract caps order lifetime
    for name, symbol, category, mid, desc in DEMOS[:LIMIT]:
        if name in existing:
            print(f"skip {name} (already exists)")
            continue
        print(f"\n{name} ({symbol})")
        body = {
            "name": name, "token_name": name, "token_symbol": symbol, "description": desc, "website": "https://docs.arc.io",
            "socials": ["https://x.com/AvantDex"], "category": category, "blockchain": "Arc Testnet", "token_address": DEMO.lower(),
            "supply_info": "Demo token, open mint", "allocation_info": "None", "tge_info": "No real launch. Testnet demo.",
            "documentation": ["https://docs.arc.io"], "evidence": "Demo project created by the Avantdex team to show the product on testnet.",
            "team_wallet": ADMIN.address.lower(),
        }
        pid = ok(client.post("/api/admin/projects", json={**body, "status": "Approved"}, headers=ah)).json()["id"]
        mk = client.post("/api/admin/markets", headers=ah, json={"project_id": pid, "lot_size": 10**18, "tick_size": TICK, "min_lots": 1, "max_lots": 1000, "trading_start": iso(now - 60), "trading_end": iso(now + 30 * 86400)})
        mk.raise_for_status()
        mk = mk.json()
        p = mk["onchain_params"]
        send("createMarket", ADMIN, ex.functions.createMarket(DEMO, int(p["lotSize"]), int(p["tickSize"]), int(p["minLots"]), int(p["maxLots"]), p["tradingStart"], p["tradingEnd"], bytes.fromhex(p["metadataRef"][2:]), int(p["tokenDecimals"])))
        wait(lambda: client.get(f"/api/admin/markets/{mk['id']}", headers=ah).json()["onchain_id"] is not None, "indexer to bind the market")
        mid_id = client.get(f"/api/admin/markets/{mk['id']}", headers=ah).json()["onchain_id"]
        assert client.get(f"/api/admin/markets/{mk['id']}/verify-config", headers=ah).json()["config_ok"]
        send("activateMarket", ADMIN, ex.functions.activateMarket(mid_id))
        wait(lambda: client.get(f"/api/markets/{mid_id}").status_code == 200, "market to become public")
        if SCALE <= 0:
            continue
        for mult, lots in ASKS:
            pl = tick(mid * mult)
            send(f"sell {size(lots, pl)} @ {pl / ONE:.2f}", ADMIN, ex.functions.placeOrder(mid_id, 1, pl, size(lots, pl), expiry, False, 0, []))
        for mult, lots in BIDS:
            pl = tick(mid * mult)
            send(f"buy {size(lots, pl)} @ {pl / ONE:.2f}", TRADER, ex.functions.placeOrder(mid_id, 0, pl, size(lots, pl), expiry, False, 0, []))
        wait(lambda: client.get(f"/api/markets/{mid_id}/orderbook").json()["asks"] != [], "orders to be indexed")
        cap = tick(mid * 1.03)
        take = size(1, cap)
        plan = client.get(f"/api/markets/{mid_id}/match-plan", params={"side": "buy", "price": cap, "lots": take, "address": TRADER.address}).json()
        if plan["maker_ids"]:
            send(f"buyer takes {take} lots (IOC)", TRADER, ex.functions.placeOrder(mid_id, 0, cap, take, expiry, True, take, plan["maker_ids"]))
            wait(lambda: client.get(f"/api/markets/{mid_id}/stats").json()["trades"] >= 1, "trade to be indexed")
    print("\nDone. Open the site: every demo market shows bids, asks, last price, volume and open interest.")


if __name__ == "__main__":
    try:
        main()
    except AssertionError as e:
        print(f"FAILED: {e}")
        sys.exit(1)
