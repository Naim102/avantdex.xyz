"""Test fixtures. Tests run against a real PostgreSQL server (DATABASE_URL points at a server; a dedicated
`avantdex_test` database is created and migrated with Alembic)."""

from __future__ import annotations

import os

import pytest
from alembic import command
from alembic.config import Config
from eth_account import Account
from eth_account.messages import encode_defunct
from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url

BASE_URL = os.environ.get("DATABASE_URL", "postgresql+psycopg://avantdex:avantdex@localhost:55432/avantdex")
TEST_DB = "avantdex_test"
TEST_URL = make_url(BASE_URL).set(database=TEST_DB).render_as_string(hide_password=False)

os.environ["DATABASE_URL"] = TEST_URL
os.environ["ENV"] = "test"
os.environ.setdefault("JWT_SECRET", "test-secret-test-secret-test-secret-123")
os.environ["AUTH_DOMAIN"] = "avantdex.test"
os.environ["AUTH_URI"] = "https://avantdex.test"

from fastapi.testclient import TestClient  # noqa: E402

from app import db as app_db  # noqa: E402
from app.config import get_settings  # noqa: E402


def _create_database() -> None:
    admin = create_engine(BASE_URL, isolation_level="AUTOCOMMIT")
    with admin.connect() as c:
        c.execute(text(f"DROP DATABASE IF EXISTS {TEST_DB} WITH (FORCE)"))
        c.execute(text(f"CREATE DATABASE {TEST_DB}"))
    admin.dispose()


@pytest.fixture(scope="session", autouse=True)
def database():
    _create_database()
    cfg = Config(os.path.join(os.path.dirname(__file__), "..", "alembic.ini"))
    cfg.set_main_option("script_location", os.path.join(os.path.dirname(__file__), "..", "alembic"))
    command.upgrade(cfg, "head")
    yield


@pytest.fixture(autouse=True)
def clean_db(database):
    get_settings.cache_clear()
    app_db.reset_engine()
    engine = app_db.get_engine()
    with engine.begin() as c:
        tables = [r[0] for r in c.execute(text("SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> 'alembic_version'"))]
        c.execute(text("TRUNCATE " + ", ".join(tables) + " RESTART IDENTITY CASCADE"))
    yield


@pytest.fixture
def client():
    from app.main import create_app

    with TestClient(create_app()) as c:
        yield c


class Wallet:
    def __init__(self, seed: int):
        self.account = Account.from_key("0x" + f"{seed:02x}" * 32)
        self.address = self.account.address.lower()

    def sign(self, message: str) -> str:
        return self.account.sign_message(encode_defunct(text=message)).signature.hex()


def make_wallet(seed: int) -> Wallet:
    return Wallet(seed)


def login(client: TestClient, wallet: Wallet) -> dict:
    r = client.post("/api/auth/nonce", json={"address": wallet.address})
    assert r.status_code == 200, r.text
    n = r.json()
    sig = wallet.sign(n["message"])
    r = client.post("/api/auth/verify", json={"address": wallet.address, "nonce": n["nonce"], "signature": sig})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['token']}"}


def grant(roles: dict[str, list[str]]) -> None:
    """Insert admin roles directly: {address: [roles]}."""
    from app.db import SessionLocal
    from app.models import AdminRole

    with SessionLocal() as db:
        for addr, rs in roles.items():
            for r in rs:
                db.add(AdminRole(address=addr, role=r, granted_by="test"))
        db.commit()


@pytest.fixture
def admin_headers(client):
    w = make_wallet(0xA1)
    grant({w.address: ["super_admin"]})
    return login(client, w)
