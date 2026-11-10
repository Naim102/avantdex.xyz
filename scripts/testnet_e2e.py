"""End-to-end check against a RUNNING stack and a real chain (Arc Testnet by default).

It drives the real API and the real exchange contract with two wallets you control:
  DEPLOYER_PRIVATE_KEY  seller, project applicant and admin (must be listed in BOOTSTRAP_ADMIN_ADDRESSES)
  TRADER_PRIVATE_KEY    buyer
and a demo ERC-20 (DEMO_TOKEN_ADDRESS, mintable by the deployer) as the "project token".

Flow: project -> review -> verification -> approval -> market draft -> createMarket on-chain -> verify -> activate ->
sell order -> buy order (partial fill) -> open settlement -> settle -> cancel -> complete, then checks the API/DB and
that the fee collector received exactly 0.5% + 0.5% of the settled trade.

Environment: API_URL, RPC_URL, EXCHANGE_ADDRESS, DEMO_TOKEN_ADDRESS, DEPLOYER_PRIVATE_KEY, TRADER_PRIVATE_KEY.
Costs a few cents of testnet USDC. Never run it against a network with real value.
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
from web3.logs import DISCARD

API = os.environ.get("API_URL", "http://localhost:8000").rstrip("/")
RPC = os.environ.get("RPC_URL", "https://rpc.testnet.arc.io")
EXCHANGE = Web3.to_checksum_address(os.environ["EXCHANGE_ADDRESS"])
DEMO = Web3.to_checksum_address(os.environ["DEMO_TOKEN_ADDRESS"])
USDC = Web3.to_checksum_address("0x3600000000000000000000000000000000000000")
COLLECTOR = Web3.to_checksum_address(os.environ.get("FEE_COLLECTOR", "0x136a2C17E0E6C077F48F489BeC6DBCE3202CEbd6"))
SELLER = Account.from_key(os.environ["DEPLOYER_PRIVATE_KEY"])
BUYER = Account.from_key(os.environ["TRADER_PRIVATE_KEY"])
ONE = 10**6
MAX_FEE = Web3.to_wei(25, "gwei")  # Arc guidance: at least 20 gwei

w3 = Web3(Web3.HTTPProvider(RPC, request_kwargs={"timeout": 30}))
assert w3.eth.chain_id == 5042002, "this script only runs against Arc Testnet (or a local chain using its chain id)"
EX_ABI = json.loads((Path(__file__).resolve().parent.parent / "backend" / "app" / "abi" / "AvantdexExchange.json").read_text())
ERC20 = [
    {"type": "function", "name": "approve", "stateMutability": "nonpayable", "inputs": [{"name": "s", "type": "address"}, {"name": "a", "type": "uint256"}], "outputs": [{"type": "bool"}]},
    {"type": "function", "name": "balanceOf", "stateMutability": "view", "inputs": [{"name": "a", "type": "address"}], "outputs": [{"type": "uint256"}]},
    {"type": "function", "name": "mint", "stateMutability": "nonpayable", "inputs": [{"name": "t", "type": "address"}, {"name": "a", "type": "uint256"}], "outputs": []},
]
ex = w3.eth.contract(address=EXCHANGE, abi=EX_ABI)
usdc = w3.eth.contract(address=USDC, abi=ERC20)
demo = w3.eth.contract(address=DEMO, abi=ERC20)
txs: list[tuple[str, str]] = []


def send(label: str, account, fn=None, to=None, value=0):
    """Build, sign and send a transaction; fail loudly if it reverts."""
    base = {"from": account.address, "chainId": 5042002, "nonce": w3.eth.get_transaction_count(account.address), "maxFeePerGas": MAX_FEE, "maxPriorityFeePerGas": Web3.to_wei(1, "gwei")}
    if fn is not None:
        tx = fn.build_transaction(base)
    else:
        tx = {**base, "to": to, "value": value, "gas": 21000}
    signed = account.sign_transaction(tx)
    h = w3.eth.send_raw_transaction(signed.raw_transaction)
    r = w3.eth.wait_for_transaction_receipt(h, timeout=120)
    assert r.status == 1, f"{label} reverted: {h.hex()}"
    txs.append((label, "0x" + h.hex().removeprefix("0x")))
    print(f"  ok  {label}  {txs[-1][1]}")
    return r


def login(client: httpx.Client, account) -> dict:
    n = client.post("/api/auth/nonce", json={"address": account.address}).json()
    sig = account.sign_message(encode_defunct(text=n["message"])).signature.hex()
    r = client.post("/api/auth/verify", json={"address": account.address, "nonce": n["nonce"], "signature": sig})
    r.raise_for_status()
    return {"Authorization": f"Bearer {r.json()['token']}"}


def wait_indexer(client: httpx.Client, cond, what: str, timeout=90):
    end = time.time() + timeout
    while time.time() < end:
        try:
            if cond():
                return
        except Exception:
            pass
        time.sleep(2)
    raise AssertionError(f"timed out waiting for: {what}")


def main() -> None:
    print(f"exchange {EXCHANGE}  seller {SELLER.address}  buyer {BUYER.address}")
    client = httpx.Client(base_url=API, timeout=30)
    assert client.get("/api/health").json()["status"] == "ok"

    # fund the buyer with a little testnet USDC (native balance == ERC-20 balance on Arc)
    if usdc.functions.balanceOf(BUYER.address).call() < 4 * ONE:
        send("fund buyer with 4 USDC", SELLER, to=BUYER.address, value=4 * 10**18)
    if demo.functions.balanceOf(SELLER.address).call() < 100 * 10**18:
        send("mint demo tokens to seller", SELLER, demo.functions.mint(SELLER.address, 1000 * 10**18))

    # ---- project workflow through the real API
    sh = login(client, SELLER)
    name = f"Avantdex Demo Token {int(time.time())}"
    body = {
        "name": name, "token_name": "Demo Token", "token_symbol": "DEMO", "description": "Testnet demo token used to exercise settlement. Not a real project.",
        "website": "https://faucet.circle.com", "socials": ["https://x.com/circle"], "category": "Other", "blockchain": "Arc Testnet",
        "token_address": DEMO.lower(), "supply_info": "Test token, open mint", "allocation_info": "None", "tge_info": "Immediate (testnet)",
        "documentation": ["https://docs.arc.io"], "evidence": "Test token deployed by the Avantdex deployer wallet for testnet checks.",
        "team_wallet": SELLER.address.lower(),
    }
    pid = client.post("/api/projects", json=body, headers=sh).json()["id"]
    client.post(f"/api/projects/{pid}/submit", headers=sh).raise_for_status()
    for to in ("Under Review", "Verification"):
        client.post(f"/api/admin/projects/{pid}/transition", json={"to": to}, headers=sh).raise_for_status()
    client.post(f"/api/admin/projects/{pid}/badges", json={"badge": "contract_verified", "evidence": "Test token deployed by the platform deployer wallet; not a real asset."}, headers=sh).raise_for_status()
    client.post(f"/api/admin/projects/{pid}/transition", json={"to": "Approved"}, headers=sh).raise_for_status()
    print(f"  ok  project {pid} approved with a contract badge")

    now = int(time.time())
    iso = lambda t: dt.datetime.fromtimestamp(t, tz=dt.timezone.utc).isoformat()
    mk = client.post("/api/admin/markets", headers=sh, json={"project_id": pid, "lot_size": 10**18, "tick_size": 10_000, "min_lots": 1, "max_lots": 1000, "trading_start": iso(now - 60), "trading_end": iso(now + 30 * 86400)})
    mk.raise_for_status()
    mk = mk.json()
    p = mk["onchain_params"]
    send("createMarket", SELLER, ex.functions.createMarket(Web3.to_checksum_address(p["token"]) if int(p["token"], 16) else Web3.to_checksum_address("0x" + "00" * 20), int(p["lotSize"]), int(p["tickSize"]), int(p["minLots"]), int(p["maxLots"]), p["tradingStart"], p["tradingEnd"], bytes.fromhex(p["metadataRef"][2:]), int(p["tokenDecimals"])))
    wait_indexer(client, lambda: client.get(f"/api/admin/markets/{mk['id']}", headers=sh).json()["onchain_id"] is not None, "indexer to bind the new market")
    market_id = client.get(f"/api/admin/markets/{mk['id']}", headers=sh).json()["onchain_id"]
    v = client.get(f"/api/admin/markets/{mk['id']}/verify-config", headers=sh).json()
    assert v["config_ok"], v
    send("activateMarket", SELLER, ex.functions.activateMarket(market_id))
    wait_indexer(client, lambda: client.get(f"/api/markets/{market_id}").status_code == 200, "market to become public")
    print(f"  ok  market #{market_id} live and config verified against the chain")

    # ---- trading on the real chain
    send("seller approves USDC", SELLER, usdc.functions.approve(EXCHANGE, 2**255))
    send("buyer approves USDC", BUYER, usdc.functions.approve(EXCHANGE, 2**255))
    exp = int(time.time()) + 20 * 86400
    r1 = send("seller places SELL 5 @ 1.00", SELLER, ex.functions.placeOrder(market_id, 1, ONE, 5, exp, False, 0, []))
    wait_indexer(client, lambda: client.get(f"/api/markets/{market_id}/orderbook").json()["asks"] != [], "ask to appear in the order book")
    plan = client.get(f"/api/markets/{market_id}/match-plan", params={"side": "buy", "price": 1_020_000, "lots": 3, "address": BUYER.address}).json()
    assert plan["expected_fill_lots"] == "3", plan
    collector_before = usdc.functions.balanceOf(COLLECTOR).call()
    send("buyer takes 3 lots (IOC, price cap 1.02)", BUYER, ex.functions.placeOrder(market_id, 0, 1_020_000, 3, exp, True, 3, plan["maker_ids"]))
    wait_indexer(client, lambda: client.get(f"/api/markets/{market_id}/stats").json()["volume_total"] == str(3 * ONE), "trade to be indexed")
    book = client.get(f"/api/markets/{market_id}/orderbook").json()
    assert book["asks"][0]["lots"] == "2", book

    if os.environ.get("E2E_LEAVE_LIVE") == "1":
        # demo mode: add depth on both sides and leave the market live for manual testing
        send("seller adds ask 3 @ 1.10", SELLER, ex.functions.placeOrder(market_id, 1, 1_100_000, 3, exp, False, 0, []))
        send("buyer adds bid 2 @ 0.90", BUYER, ex.functions.placeOrder(market_id, 0, 900_000, 2, exp, False, 0, []))
        print(f"LEFT LIVE: market {market_id} with orders on both sides and one open trade.")
        return

    # ---- TGE: settlement
    send("openSettlement (1 hour window)", SELLER, ex.functions.openSettlement(market_id, DEMO, 3600))
    send("seller approves demo token", SELLER, demo.functions.approve(EXCHANGE, 2**255))
    buyer_tokens = demo.functions.balanceOf(BUYER.address).call()
    send("seller settles trade #1 (atomic delivery)", SELLER, ex.functions.settleTrade(ex.functions.tradeCount().call()))
    assert demo.functions.balanceOf(BUYER.address).call() - buyer_tokens == 3 * 10**18, "buyer must receive exactly 3 tokens"
    fee = 3 * ONE * 50 // 10_000
    got = usdc.functions.balanceOf(COLLECTOR).call() - collector_before
    assert got == 2 * fee, f"fee collector received {got}, expected {2 * fee}"
    print(f"  ok  buyer received 3 tokens, fee collector received {got / ONE} USDC (0.5% + 0.5%)")

    # ---- cleanup: cancel the remaining ask (no fee), complete the market
    send("seller cancels remaining order", SELLER, ex.functions.cancelOrder(r1_order_id(r1)))
    send("completeMarket", SELLER, ex.functions.completeMarket(market_id))
    wait_indexer(client, lambda: client.get(f"/api/markets/{market_id}").json()["status"] == "Completed", "market to show Completed")
    trade = client.get(f"/api/portfolio/{BUYER.address.lower()}/trades").json()["items"][0]
    assert trade["status"] == "Settled", trade
    ov = client.get("/api/admin/overview", headers=sh).json()
    assert int(ov["fees_collected"]) >= 2 * fee
    print("\nALL CHECKS PASSED. Transactions:")
    for label, h in txs:
        print(f"  {label}: https://explorer.testnet.arc.io/tx/{h}")


def r1_order_id(receipt) -> int:
    ev = ex.events.OrderPlaced().process_receipt(receipt, errors=DISCARD)
    return ev[0]["args"]["orderId"]


if __name__ == "__main__":
    try:
        main()
    except AssertionError as e:
        print(f"FAILED: {e}")
        sys.exit(1)
