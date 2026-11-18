"""Sign-in with a smart-contract wallet (a Circle Wallet is one): ERC-1271 for a deployed account, ERC-6492 for an
account that does not exist yet. Needs a local chain and the compiled mocks, like test_chain.py."""

from __future__ import annotations

import json
import os
from pathlib import Path

import pytest
from eth_abi import encode
from eth_account import Account
from eth_account.messages import defunct_hash_message
from web3 import Web3

RPC = os.environ.get("CHAIN_RPC")
OUT = os.environ.get("CONTRACT_OUT_DIR")
pytestmark = [pytest.mark.chain, pytest.mark.skipif(not (RPC and OUT), reason="needs CHAIN_RPC and CONTRACT_OUT_DIR")]

MAGIC_6492 = bytes.fromhex("6492" * 16)
OWNER = Account.from_key("0x" + "5a" * 32)
OTHER = Account.from_key("0x" + "6b" * 32)
SALT = b"\x01" * 32


def artifact(name: str) -> dict:
    return json.loads((Path(OUT) / "MockSmartAccount.sol" / f"{name}.json").read_text())


@pytest.fixture
def world(monkeypatch):
    from app.config import get_settings

    w3 = Web3(Web3.HTTPProvider(RPC))
    deployer = w3.eth.accounts[0]
    art = artifact("MockAccountFactory")
    c = w3.eth.contract(abi=art["abi"], bytecode=art["bytecode"]["object"])
    r = w3.eth.wait_for_transaction_receipt(c.constructor().transact({"from": deployer}))
    factory = w3.eth.contract(address=r.contractAddress, abi=art["abi"])
    monkeypatch.setenv("RPC_URL", RPC)
    get_settings.cache_clear()
    yield type("W", (), {"w3": w3, "factory": factory, "deployer": deployer})
    get_settings.cache_clear()


def sign_digest(key, digest: bytes) -> bytes:
    """Sign the 32-byte digest itself (no prefix). For an ordinary wallet the digest is the prefixed message hash;
    for the mock smart account it is what its isValidSignature recovers from."""
    return bytes(Account.unsafe_sign_hash(digest, key).signature)


def wrap_6492(factory_address: str, factory_calldata: bytes, inner: bytes) -> bytes:
    return encode(["address", "bytes", "bytes"], [factory_address, factory_calldata, inner]) + MAGIC_6492


def create_call(world, owner) -> bytes:
    return bytes.fromhex(world.factory.encode_abi("createAccount", args=[owner.address, SALT])[2:])


def try_login(client, address: str, make_signature) -> tuple[int, dict]:
    n = client.post("/api/auth/nonce", json={"address": address}).json()
    digest = bytes(defunct_hash_message(text=n["message"]))
    sig = make_signature(digest)
    r = client.post("/api/auth/verify", json={"address": address, "nonce": n["nonce"], "signature": "0x" + sig.hex()})
    return r.status_code, r.json()


def test_a_deployed_smart_account_can_sign_in(client, world):
    f = world.factory
    world.w3.eth.wait_for_transaction_receipt(f.functions.createAccount(OWNER.address, SALT).transact({"from": world.deployer}))
    account = f.functions.accountFor(OWNER.address, SALT).call()
    assert world.w3.eth.get_code(account) != b""
    status, body = try_login(client, account.lower(), lambda d: sign_digest(OWNER.key, d))
    assert status == 200, body
    assert body["address"] == account.lower()


def test_an_account_that_does_not_exist_yet_can_sign_in_with_a_6492_signature(client, world):
    f = world.factory
    account = f.functions.accountFor(OWNER.address, SALT).call()
    assert world.w3.eth.get_code(account) == b""  # a new Circle Wallet is only deployed with its first transaction
    status, body = try_login(client, account.lower(), lambda d: wrap_6492(f.address, create_call(world, OWNER), sign_digest(OWNER.key, d)))
    assert status == 200, body
    assert body["address"] == account.lower()
    assert world.w3.eth.get_code(account) == b""  # the check is an eth_call: nothing was deployed


def test_a_signature_from_the_wrong_owner_is_refused(client, world):
    f = world.factory
    account = f.functions.accountFor(OWNER.address, SALT).call()
    status, body = try_login(client, account.lower(), lambda d: wrap_6492(f.address, create_call(world, OWNER), sign_digest(OTHER.key, d)))
    assert status == 401 and body["error"]["code"] == "bad_signature"


def test_a_signature_over_another_message_is_refused(client, world):
    f = world.factory
    account = f.functions.accountFor(OWNER.address, SALT).call()
    status, _ = try_login(client, account.lower(), lambda d: wrap_6492(f.address, create_call(world, OWNER), sign_digest(OWNER.key, b"\x02" * 32)))
    assert status == 401


def test_nobody_can_sign_in_as_an_account_they_do_not_own(client, world):
    """A wrapper built for OTHER's account cannot be presented for OWNER's address."""
    f = world.factory
    owner_account = f.functions.accountFor(OWNER.address, SALT).call()
    status, _ = try_login(client, owner_account.lower(), lambda d: wrap_6492(f.address, create_call(world, OTHER), sign_digest(OTHER.key, d)))
    assert status == 401


def test_garbage_and_oversized_signatures_are_refused_without_errors(client, world):
    account = world.factory.functions.accountFor(OWNER.address, SALT).call().lower()
    # under the API's own size limit: refused by the signature check (8200 bytes is also over the validator's cap)
    for sig in (b"\x00", b"\x12" * 64, b"\xff" * 4000, MAGIC_6492, b"\xab" * 8200):
        status, _ = try_login(client, account, lambda d, s=sig: s)
        assert status == 401
    # over the API's limit: refused before any chain call
    status, _ = try_login(client, account, lambda d: b"\xab" * 9000)
    assert status == 422


def test_an_ordinary_wallet_still_signs_in_with_ecdsa(client, world):
    status, body = try_login(client, OWNER.address.lower(), lambda d: sign_digest(OWNER.key, d))
    assert status == 200 and body["address"] == OWNER.address.lower()
