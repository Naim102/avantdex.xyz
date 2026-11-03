"""web3 helpers: contract handle, enum names and struct decoding for AvantdexExchange."""

from __future__ import annotations

import datetime as dt
import json
from pathlib import Path

from web3 import Web3

from .config import get_settings

ABI = json.loads((Path(__file__).parent / "abi" / "AvantdexExchange.json").read_text())

MARKET_STATUS = ["None", "Setup", "Live", "Suspended", "SettlementOpen", "Completed", "Cancelled"]
ORDER_STATUS = ["None", "Open", "Filled", "Cancelled", "Expired"]
TRADE_STATUS = ["None", "Open", "Settled", "Defaulted", "Refunded"]
SIDES = ["buy", "sell"]


def get_web3() -> Web3:
    return Web3(Web3.HTTPProvider(get_settings().rpc_url, request_kwargs={"timeout": 20}))


def get_exchange(w3: Web3):
    addr = get_settings().exchange_address
    if not addr:
        raise RuntimeError("EXCHANGE_ADDRESS is not configured")
    return w3.eth.contract(address=Web3.to_checksum_address(addr), abi=ABI)


def to_dt(ts: int) -> dt.datetime | None:
    return dt.datetime.fromtimestamp(ts, tz=dt.timezone.utc) if ts else None


def decode_market(t) -> dict:
    return {
        "status": MARKET_STATUS[t[0]],
        "token": t[1].lower(),
        "trading_start": to_dt(t[2]),
        "trading_end": to_dt(t[3]),
        "settlement_opened_at": to_dt(t[4]),
        "settlement_deadline": to_dt(t[5]),
        "lot_size": t[6],
        "tick_size": t[7],
        "min_lots": t[8],
        "max_lots": t[9],
        "open_trades": t[10],
        "metadata_ref": "0x" + bytes(t[11]).hex(),
    }


def decode_order(t) -> dict:
    return {
        "owner": t[0].lower(),
        "side": SIDES[t[1]],
        "status": ORDER_STATUS[t[2]],
        "market_onchain_id": t[3],
        "price": t[4],
        "lots": t[5],
        "filled": t[6],
        "locked": t[7],
        "expiry": to_dt(t[8]),
    }


def decode_trade(t) -> dict:
    return {
        "market_onchain_id": t[0],
        "buyer": t[1].lower(),
        "seller": t[2].lower(),
        "lots": t[3],
        "price": t[4],
        "value": t[5],
        "buyer_fee": t[6],
        "seller_fee": t[7],
        "status": TRADE_STATUS[t[8]],
    }


def metadata_ref_for(slug: str) -> str:
    """keccak256(slug) as 0x-hex: emitted on-chain at createMarket so the indexer can bind the DB record."""
    return "0x" + Web3.keccak(text=slug).hex().removeprefix("0x")


_collector_cache: dict[str, tuple[float, str]] = {}


def live_fee_collector() -> str:
    """The platform fee address as the contract reports it (authoritative); falls back to FEE_COLLECTOR.

    Cached for 60 seconds so API requests do not hit the RPC every time.
    """
    import time

    s = get_settings()
    key = s.exchange_address
    hit = _collector_cache.get(key)
    if hit and time.time() - hit[0] < 60:
        return hit[1]
    value = s.fee_collector
    if key:
        try:
            value = get_exchange(get_web3()).functions.feeCollector().call()
        except Exception:
            value = s.fee_collector
    _collector_cache[key] = (time.time(), value)
    return value
