import datetime as dt

from sqlalchemy import text

from app.db import SessionLocal
from app.models import AuthNonce

from .conftest import grant, login, make_wallet


def test_login_flow_and_me(client):
    w = make_wallet(1)
    h = login(client, w)
    r = client.get("/api/auth/me", headers=h)
    assert r.status_code == 200
    assert r.json() == {"address": w.address, "roles": []}


def test_nonce_cannot_be_replayed(client):
    w = make_wallet(2)
    n = client.post("/api/auth/nonce", json={"address": w.address}).json()
    sig = w.sign(n["message"])
    body = {"address": w.address, "nonce": n["nonce"], "signature": sig}
    assert client.post("/api/auth/verify", json=body).status_code == 200
    r = client.post("/api/auth/verify", json=body)
    assert r.status_code == 401
    assert r.json()["error"]["code"] == "nonce_used"


def test_expired_nonce_rejected(client):
    w = make_wallet(3)
    n = client.post("/api/auth/nonce", json={"address": w.address}).json()
    with SessionLocal() as db:
        row = db.get(AuthNonce, n["nonce"])
        row.expires_at = dt.datetime.now(dt.timezone.utc) - dt.timedelta(minutes=1)
        db.commit()
    r = client.post("/api/auth/verify", json={"address": w.address, "nonce": n["nonce"], "signature": w.sign(n["message"])})
    assert r.status_code == 401
    assert r.json()["error"]["code"] == "nonce_expired"


def test_signature_from_other_wallet_rejected(client):
    a, b = make_wallet(4), make_wallet(5)
    n = client.post("/api/auth/nonce", json={"address": a.address}).json()
    r = client.post("/api/auth/verify", json={"address": a.address, "nonce": n["nonce"], "signature": b.sign(n["message"])})
    assert r.status_code == 401
    assert r.json()["error"]["code"] == "bad_signature"


def test_signature_over_different_message_rejected(client):
    w = make_wallet(6)
    n = client.post("/api/auth/nonce", json={"address": w.address}).json()
    r = client.post("/api/auth/verify", json={"address": w.address, "nonce": n["nonce"], "signature": w.sign("something else")})
    assert r.status_code == 401


def test_nonce_for_other_address_rejected(client):
    a, b = make_wallet(7), make_wallet(8)
    n = client.post("/api/auth/nonce", json={"address": a.address}).json()
    r = client.post("/api/auth/verify", json={"address": b.address, "nonce": n["nonce"], "signature": b.sign(n["message"])})
    assert r.status_code == 401


def test_message_contains_domain_chain_and_no_funds_warning(client):
    w = make_wallet(9)
    m = client.post("/api/auth/nonce", json={"address": w.address}).json()["message"]
    assert "avantdex.test wants you to sign in" in m
    assert "Chain ID: 5042002" in m
    assert "does not authorize any transaction or token approval" in m


def test_invalid_address_and_unknown_fields(client):
    assert client.post("/api/auth/nonce", json={"address": "nope"}).status_code == 422
    assert client.post("/api/auth/nonce", json={"address": make_wallet(1).address, "x": 1}).status_code == 422


def test_protected_routes_require_token(client):
    assert client.get("/api/auth/me").status_code == 401
    assert client.get("/api/notifications").status_code == 401
    assert client.get("/api/admin/overview").status_code == 401
    assert client.get("/api/admin/overview", headers={"Authorization": "Bearer junk"}).status_code == 401


def test_admin_routes_forbidden_for_normal_wallet(client):
    h = login(client, make_wallet(10))
    for path in ("/api/admin/overview", "/api/admin/projects", "/api/admin/markets", "/api/admin/audit-logs", "/api/admin/roles", "/api/admin/users", "/api/admin/disputes", "/api/admin/settlement", "/api/admin/settings"):
        r = client.get(path, headers=h)
        assert r.status_code == 403, path
        assert r.json()["error"]["code"] == "forbidden"


def test_admin_overview_and_roles_check_per_route(client):
    reviewer = make_wallet(11)
    grant({reviewer.address: ["project_reviewer"]})
    h = login(client, reviewer)
    assert client.get("/api/admin/overview", headers=h).status_code == 200
    assert client.get("/api/admin/projects", headers=h).status_code == 200
    assert client.get("/api/admin/roles", headers=h).status_code == 403  # super_admin only
    assert client.get("/api/admin/users", headers=h).status_code == 403  # support_admin only


def test_error_shape_is_consistent(client):
    r = client.get("/api/markets/does-not-exist")
    assert r.status_code == 404
    assert set(r.json()["error"]) >= {"code", "message"}


def test_bootstrap_admin_addresses(monkeypatch, client):
    from app.config import get_settings
    from app.main import bootstrap_admins
    from app.security import roles_of

    w = make_wallet(12)
    monkeypatch.setenv("BOOTSTRAP_ADMIN_ADDRESSES", w.address)
    get_settings.cache_clear()
    bootstrap_admins()
    bootstrap_admins()  # idempotent
    with SessionLocal() as db:
        assert roles_of(db, w.address) == ["super_admin"]


def test_audit_logs_are_append_only(client, admin_headers):
    client.put("/api/admin/settings", headers=admin_headers, json={"notice": "hello"})
    with SessionLocal() as db:
        n = db.execute(text("SELECT count(*) FROM audit_logs")).scalar()
        assert n == 1
        for stmt in ("UPDATE audit_logs SET action='x'", "DELETE FROM audit_logs"):
            try:
                db.execute(text(stmt))
                db.commit()
                raise AssertionError("audit_logs must reject " + stmt)
            except Exception as e:
                assert "append-only" in str(e)
                db.rollback()


def _roles(address):
    from app.security import roles_of

    with SessionLocal() as db:
        return sorted(roles_of(db, address))


def test_admins_and_roles_from_environment(monkeypatch, client):
    from app.config import get_settings
    from app.main import bootstrap_admins

    boss, rev, ver = make_wallet(20), make_wallet(21), make_wallet(22)
    monkeypatch.setenv("BOOTSTRAP_ADMIN_ADDRESSES", boss.address)
    monkeypatch.setenv("ADMIN_ROLES", f"{rev.address}:project_reviewer|support_admin, {ver.address}:verification_admin,bad:entry, {ver.address}:nonsense")
    get_settings.cache_clear()
    bootstrap_admins()
    assert _roles(boss.address) == ["super_admin"]
    assert _roles(rev.address) == ["project_reviewer", "support_admin"]
    assert _roles(ver.address) == ["verification_admin"]  # unknown role ignored


def test_removing_from_environment_revokes_env_roles_only(monkeypatch, client):
    from app.config import get_settings
    from app.main import bootstrap_admins
    from app.models import AdminRole

    boss, rev, dash = make_wallet(23), make_wallet(24), make_wallet(25)
    monkeypatch.setenv("BOOTSTRAP_ADMIN_ADDRESSES", boss.address)
    monkeypatch.setenv("ADMIN_ROLES", f"{rev.address}:project_reviewer")
    get_settings.cache_clear()
    bootstrap_admins()
    with SessionLocal() as db:  # a role granted from the dashboard
        db.add(AdminRole(address=dash.address, role="support_admin", granted_by=boss.address))
        db.commit()
    monkeypatch.setenv("ADMIN_ROLES", "")
    get_settings.cache_clear()
    bootstrap_admins()
    assert _roles(rev.address) == []  # removed from env -> revoked
    assert _roles(dash.address) == ["support_admin"]  # dashboard grants are untouched
    assert _roles(boss.address) == ["super_admin"]


def test_last_super_admin_is_never_removed_by_environment_change(monkeypatch, client):
    from app.config import get_settings
    from app.main import bootstrap_admins

    boss = make_wallet(26)
    monkeypatch.setenv("BOOTSTRAP_ADMIN_ADDRESSES", boss.address)
    get_settings.cache_clear()
    bootstrap_admins()
    monkeypatch.setenv("BOOTSTRAP_ADMIN_ADDRESSES", "")
    get_settings.cache_clear()
    bootstrap_admins()
    assert _roles(boss.address) == ["super_admin"]  # safety net against locking everyone out


def test_database_url_styles_are_normalized(monkeypatch):
    from app.config import Settings

    for raw in ("postgres://u:p@h:5432/d", "postgresql://u:p@h:5432/d", "postgresql+psycopg://u:p@h:5432/d"):
        monkeypatch.setenv("DATABASE_URL", raw)
        assert Settings().database_url == "postgresql+psycopg://u:p@h:5432/d"
