import datetime as dt

from sqlalchemy import select

from app.db import SessionLocal
from app.models import AuditLog, Project

from .conftest import grant, login, make_wallet

GOOD = {
    "name": "Orbit Protocol",
    "token_name": "Orbit",
    "token_symbol": "orb",
    "logo_url": "https://example.com/logo.png",
    "description": "A test project.",
    "website": "https://orbit.example.com",
    "socials": ["https://x.com/orbit"],
    "category": "DeFi",
    "blockchain": "Arc",
    "token_address": "",
    "supply_info": "1B",
    "allocation_info": "40% community",
    "tge_info": "Q1",
    "documentation": ["https://orbit.example.com/docs"],
    "evidence": "Signed statement on the official site",
}


def team(seed=21):
    return make_wallet(seed)


def create(client, h, wallet, **over):
    body = {**GOOD, "team_wallet": wallet.address, **over}
    return client.post("/api/projects", json=body, headers=h)


# --------------------------------------------------------------------------- applicant flow


def test_project_validation_errors(client):
    w = team()
    h = login(client, w)
    for over, field in [
        ({"token_symbol": "bad symbol!"}, "symbol"),
        ({"website": "http://insecure.example.com"}, "https"),
        ({"logo_url": "javascript:alert(1)"}, "https"),
        ({"socials": ["ftp://x"]}, "https"),
        ({"team_wallet": "0x123"}, "0x address"),
        ({"category": "Memes"}, "Category"),
        ({"description": "x" * 2001}, "2000"),
        ({"name": ""}, "required"),
    ]:
        r = create(client, h, w, **over)
        assert r.status_code == 422, (over, r.text)
    assert client.post("/api/projects", json={**GOOD, "unknown": 1}, headers=h).status_code == 422


def test_symbol_is_normalized_and_draft_created(client):
    w = team()
    h = login(client, w)
    r = create(client, h, w)
    assert r.status_code == 200
    d = r.json()
    assert d["status"] == "Draft"
    assert d["token_symbol"] == "ORB"
    assert d["slug"] == "orbit-protocol"
    assert d["applicant"] == w.address


def test_submit_requires_complete_application(client):
    w = team()
    h = login(client, w)
    pid = create(client, h, w, evidence="", socials=[]).json()["id"]
    r = client.post(f"/api/projects/{pid}/submit", headers=h)
    assert r.status_code == 422
    assert r.json()["error"]["code"] == "incomplete_application"
    assert "social link" in r.json()["error"]["message"]


def test_submit_requires_team_wallet_signature(client):
    applicant = team(22)
    h = login(client, applicant)
    other = make_wallet(23)
    pid = create(client, h, applicant, team_wallet=other.address).json()["id"]
    r = client.post(f"/api/projects/{pid}/submit", headers=h)
    assert r.status_code == 422
    assert r.json()["error"]["code"] == "team_wallet_mismatch"


def test_full_submit_and_edit_lock(client):
    w = team()
    h = login(client, w)
    pid = create(client, h, w).json()["id"]
    r = client.post(f"/api/projects/{pid}/submit", headers=h)
    assert r.status_code == 200 and r.json()["status"] == "Submitted"
    # not editable once submitted
    r = client.put(f"/api/projects/{pid}", json={**GOOD, "team_wallet": w.address, "name": "Changed"}, headers=h)
    assert r.status_code == 409
    # cannot submit twice
    assert client.post(f"/api/projects/{pid}/submit", headers=h).status_code == 409
    mine = client.get("/api/projects/mine", headers=h).json()["items"]
    assert len(mine) == 1 and mine[0]["history"][-1]["to"] == "Submitted"


def test_other_wallet_cannot_touch_project(client):
    w = team()
    h = login(client, w)
    pid = create(client, h, w).json()["id"]
    h2 = login(client, make_wallet(24))
    assert client.put(f"/api/projects/{pid}", json={**GOOD, "team_wallet": w.address}, headers=h2).status_code == 404
    assert client.post(f"/api/projects/{pid}/submit", headers=h2).status_code == 404
    assert client.get(f"/api/projects/mine/{pid}", headers=h2).status_code == 404


def test_submission_never_creates_market_and_is_not_public(client):
    w = team()
    h = login(client, w)
    pid = create(client, h, w).json()["id"]
    client.post(f"/api/projects/{pid}/submit", headers=h)
    assert client.get("/api/markets").json()["items"] == []
    assert client.get("/api/markets/orbit-protocol").status_code == 404


def test_application_rate_limit_per_wallet(client):
    w = team()
    h = login(client, w)
    codes = [create(client, h, w, name=f"P{i}", token_symbol=f"S{i}").status_code for i in range(6)]
    assert codes[:5] == [200] * 5 and codes[5] == 429


def test_plain_text_is_stored_verbatim_not_as_html(client):
    w = team()
    h = login(client, w)
    r = create(client, h, w, description="<script>alert(1)</script>")
    assert r.status_code == 200
    assert r.json()["description"] == "<script>alert(1)</script>"  # stored as text; the UI escapes on render


# --------------------------------------------------------------------------- admin review


def _submitted(client):
    w = team()
    h = login(client, w)
    pid = create(client, h, w).json()["id"]
    client.post(f"/api/projects/{pid}/submit", headers=h)
    return w, h, pid


def _admin(seed, *roles):
    w = make_wallet(seed)
    grant({w.address: list(roles)})
    return w


def test_status_machine_any_admin_can_approve(client):
    _, applicant_h, pid = _submitted(client)
    admin = login(client, _admin(31, "super_admin"))

    def go(h, to, reason=""):
        return client.post(f"/api/admin/projects/{pid}/transition", headers=h, json={"to": to, "reason": reason})

    assert go(admin, "Live").status_code == 409  # not an allowed jump
    assert go(admin, "Rejected").status_code == 422  # reason required
    assert go(admin, "Approved").status_code == 200  # one click from Submitted
    r = client.get(f"/api/admin/projects/{pid}", headers=admin).json()
    assert r["status"] == "Approved"
    assert [h["to"] for h in r["history"]] == ["Draft", "Submitted", "Approved"]
    # approval did not create a market
    assert client.get("/api/admin/markets", headers=admin).json()["items"] == []
    with SessionLocal() as db:
        actions = [a.action for a in db.scalars(select(AuditLog))]
    assert actions.count("project.transition") == 1


def test_non_admin_cannot_approve_and_approved_projects_are_listed_as_upcoming(client):
    _, applicant_h, pid = _submitted(client)
    assert client.get("/api/projects/upcoming").json()["items"] == []  # nothing before approval
    assert client.post(f"/api/admin/projects/{pid}/transition", headers=applicant_h, json={"to": "Approved"}).status_code == 403
    admin = login(client, _admin(31, "project_reviewer"))  # legacy role names act as admin
    assert client.post(f"/api/admin/projects/{pid}/transition", headers=admin, json={"to": "Approved"}).status_code == 200
    items = client.get("/api/projects/upcoming").json()["items"]
    assert [i["status"] for i in items] == ["Approved"] and items[0]["token_symbol"]
    assert "applicant" not in items[0] and "evidence" not in items[0]  # public view only
    assert client.get("/api/markets").json()["items"] == []  # still not tradable
    client.post(f"/api/admin/projects/{pid}/transition", headers=admin, json={"to": "Rejected", "reason": "no"})
    assert client.get("/api/projects/upcoming").json()["items"] == []


def test_changes_requested_loop(client):
    w, applicant_h, pid = _submitted(client)
    reviewer = login(client, _admin(31, "project_reviewer"))
    client.post(f"/api/admin/projects/{pid}/transition", headers=reviewer, json={"to": "Under Review"})
    r = client.post(f"/api/admin/projects/{pid}/transition", headers=reviewer, json={"to": "Changes Requested", "reason": "Add a team wallet proof"})
    assert r.status_code == 200
    # applicant edits and resubmits
    assert client.put(f"/api/projects/{pid}", json={**GOOD, "team_wallet": w.address, "description": "Better"}, headers=applicant_h).status_code == 200
    r = client.post(f"/api/projects/{pid}/submit", headers=applicant_h)
    assert r.status_code == 200 and r.json()["status"] == "Submitted"


def test_drafts_are_invisible_to_admins(client):
    w = team()
    h = login(client, w)
    pid = create(client, h, w).json()["id"]
    reviewer = login(client, _admin(31, "project_reviewer"))
    assert client.get(f"/api/admin/projects/{pid}", headers=reviewer).status_code == 404
    assert client.get("/api/admin/projects", headers=reviewer).json()["items"] == []


def test_badges_admin_only_and_audited(client):
    _, _, pid = _submitted(client)
    applicant = login(client, make_wallet(70))
    verifier = login(client, _admin(32, "verification_admin"))
    body = {"badge": "contract_verified", "evidence": "Address confirmed on official docs"}
    assert client.post(f"/api/admin/projects/{pid}/badges", headers=applicant, json=body).status_code == 403
    assert client.post(f"/api/admin/projects/{pid}/badges", headers=verifier, json={"badge": "safe", "evidence": "xxx"}).status_code == 422
    r = client.post(f"/api/admin/projects/{pid}/badges", headers=verifier, json=body)
    assert r.status_code == 200
    assert [b["badge"] for b in r.json()["badges"]] == ["contract_verified"]
    # expired badges are not shown
    past = (dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=1)).isoformat()
    client.post(f"/api/admin/projects/{pid}/badges", headers=verifier, json={"badge": "allocation_verified", "evidence": "docs", "expires_at": past})
    r = client.get(f"/api/admin/projects/{pid}", headers=verifier).json()
    assert [b["badge"] for b in r["badges"]] == ["contract_verified"]
    # revoke
    r = client.delete(f"/api/admin/projects/{pid}/badges/contract_verified", headers=verifier)
    assert r.status_code == 200 and r.json()["badges"] == []
    assert client.delete(f"/api/admin/projects/{pid}/badges/contract_verified", headers=verifier).status_code == 404
    with SessionLocal() as db:
        actions = [a.action for a in db.scalars(select(AuditLog))]
    assert "badge.grant" in actions and "badge.revoke" in actions


# --------------------------------------------------------------------------- listing requests


def test_listing_request_validation_and_limits(client):
    h = login(client, make_wallet(41))
    ok = {"project_name": "Foo", "token_symbol": "foo", "link": "https://foo.example.com", "reason": "Please list it"}
    assert client.post("/api/listing-requests", json={**ok, "link": "http://x"}, headers=h).status_code == 422
    assert client.post("/api/listing-requests", json={**ok, "reason": ""}, headers=h).status_code == 422
    assert client.post("/api/listing-requests", json={**ok, "reason": "x" * 1001}, headers=h).status_code == 422
    r = client.post("/api/listing-requests", json=ok, headers=h)
    assert r.status_code == 200 and r.json()["requests_for_symbol"] == 1
    r = client.post("/api/listing-requests", json=ok, headers=login(client, make_wallet(42)))
    assert r.json()["requests_for_symbol"] == 2
    assert client.get("/api/listing-requests/summary").json()["items"][0] == {"token_symbol": "FOO", "requests": 2}
    codes = [client.post("/api/listing-requests", json={**ok, "token_symbol": f"T{i}"}, headers=h).status_code for i in range(5)]
    assert codes[-1] == 429
    # never a market
    assert client.get("/api/markets").json()["items"] == []


def test_listing_request_admin_roles(client):
    h = login(client, make_wallet(41))
    rid = client.post("/api/listing-requests", json={"project_name": "Foo", "token_symbol": "FOO", "link": "https://f.example.com", "reason": "r"}, headers=h).json()["id"]
    reviewer = login(client, _admin(31, "project_reviewer"))
    outsider = login(client, make_wallet(71))
    assert client.get("/api/admin/listing-requests", headers=outsider).status_code == 403
    assert client.post(f"/api/admin/listing-requests/{rid}", headers=outsider, json={"status": "Declined"}).status_code == 403
    assert client.post(f"/api/admin/listing-requests/{rid}", headers=reviewer, json={"status": "bogus"}).status_code == 422
    assert client.post(f"/api/admin/listing-requests/{rid}", headers=reviewer, json={"status": "Declined", "note": "no"}).status_code == 200
    assert client.get("/api/listing-requests/summary").json()["items"] == []


# --------------------------------------------------------------------------- roles & settings


def test_admin_management_one_row_per_wallet(client, admin_headers):
    other = make_wallet(51)
    assert client.post("/api/admin/roles", headers=admin_headers, json={"address": other.address}).status_code == 200
    assert client.post("/api/admin/roles", headers=admin_headers, json={"address": other.address}).status_code == 409
    outsider = login(client, make_wallet(72))
    assert client.post("/api/admin/roles", headers=outsider, json={"address": other.address}).status_code == 403
    items = client.get("/api/admin/roles", headers=admin_headers).json()["items"]
    assert len(items) == 2
    added = next(x for x in items if x["address"] == other.address.lower())
    mine = next(x for x in items if x["address"] != other.address.lower())
    assert client.delete(f"/api/admin/roles/{added['id']}", headers=admin_headers).status_code == 200  # another admin remains
    assert client.delete(f"/api/admin/roles/{mine['id']}", headers=admin_headers).status_code == 409  # last admin stays


def test_legacy_duplicate_role_rows_show_as_one_admin(client):
    w = make_wallet(91)
    grant({w.address: ["super_admin", "market_manager", "support_admin"]})
    h = login(client, w)
    assert [x["address"] for x in client.get("/api/admin/roles", headers=h).json()["items"]] == [w.address.lower()]


def test_notice_setting_shows_publicly_and_is_audited(client, admin_headers):
    client.put("/api/admin/settings", headers=admin_headers, json={"notice": "Testnet maintenance at noon"})
    assert client.get("/api/config").json()["notice"] == "Testnet maintenance at noon"
    logs = client.get("/api/admin/audit-logs?action=settings", headers=admin_headers).json()["items"]
    assert logs and logs[0]["action"] == "settings.notice"


def test_config_reports_fee_table_and_not_audited(client):
    c = client.get("/api/config").json()
    assert c["buyer_fee_bps"] == 50 and c["seller_fee_bps"] == 50
    assert c["fee_collector"].lower() == "0x136a2c17e0e6c077f48f489bec6dbce3202cebd6"
    assert c["usdc_decimals"] == 6 and c["chain_id"] == 5042002 and c["audited"] is False


def test_health_without_indexer(client):
    h = client.get("/api/health").json()
    assert h["status"] == "ok" and h["indexer"]["last_block"] is None


def test_health_degrades_with_a_reason_instead_of_failing(client, monkeypatch):
    from app import runtime

    monkeypatch.setitem(runtime.state, "migrated", False)
    monkeypatch.setitem(runtime.state, "error", "OperationalError: could not translate host name")
    r = client.get("/api/health")
    assert r.status_code == 200  # the container still counts as started so the reason is visible
    h = r.json()
    assert h["status"] == "degraded" and h["migrated"] is False and "host name" in h["error"]


def test_connection_strings_are_masked():
    from app.runtime import mask

    assert mask("postgresql://user:secretpw@host:5432/db failed") == "postgresql://user:***@host:5432/db failed"


# --------------------------------------------------------------------------- super admin controls


def test_admin_can_create_edit_and_delete_projects(client, admin_headers):
    body = {
        "name": "Admin Added", "token_symbol": "ADM", "description": "Added by an admin", "website": "https://adm.example.com",
        "socials": ["https://x.com/adm"], "category": "DeFi", "blockchain": "Arc Testnet", "tge_info": "Q3", "evidence": "added by the team",
    }
    outsider = login(client, make_wallet(80))
    assert client.post("/api/admin/projects", headers=outsider, json=body).status_code == 403
    r = client.post("/api/admin/projects", headers=admin_headers, json={**body, "status": "Live"})
    assert r.status_code == 422
    r = client.post("/api/admin/projects", headers=admin_headers, json=body)
    assert r.status_code == 200 and r.json()["status"] == "Approved"
    pid = r.json()["id"]
    assert [i["token_symbol"] for i in client.get("/api/projects/upcoming").json()["items"]] == ["ADM"]
    # edit at any stage
    r = client.put(f"/api/admin/projects/{pid}", headers=admin_headers, json={**body, "name": "Admin Renamed", "token_symbol": "ADN"})
    assert r.status_code == 200 and r.json()["name"] == "Admin Renamed"
    assert client.put(f"/api/admin/projects/{pid}", headers=outsider, json=body).status_code == 403
    assert client.put(f"/api/admin/projects/{pid}", headers=admin_headers, json={**body, "token_symbol": "bad symbol!"}).status_code == 422
    # delete (no market on-chain)
    assert client.delete(f"/api/admin/projects/{pid}", headers=outsider).status_code == 403
    assert client.delete(f"/api/admin/projects/{pid}", headers=admin_headers).status_code == 200
    assert client.get("/api/projects/upcoming").json()["items"] == []
    assert client.delete(f"/api/admin/projects/{pid}", headers=admin_headers).status_code == 404
    with SessionLocal() as db:
        actions = [a.action for a in db.scalars(select(AuditLog))]
    assert {"project.create", "project.edit", "project.delete"} <= set(actions)


def test_admin_can_delist_and_relist_but_not_delete_a_market_project(client, admin_headers):
    from .test_markets_api import seed_market

    with SessionLocal() as db:
        m = seed_market(db, 1, "Alpha Net", "ALP")
        mid, pid = m.id, m.project_id
        db.commit()
    assert client.delete(f"/api/admin/projects/{pid}", headers=admin_headers).status_code == 409
    r = client.post(f"/api/admin/markets/{mid}/delist", headers=admin_headers, json={"delisted": True})
    assert r.status_code == 200 and r.json()["delisted"] is True
    assert client.get("/api/markets").json()["items"] == []
    assert client.post(f"/api/admin/markets/{mid}/delist", headers=admin_headers, json={"delisted": False}).status_code == 200
    assert len(client.get("/api/markets").json()["items"]) == 1


def test_admin_with_every_legacy_role_row_can_approve_and_grant_badges(client):
    """Regression: the joined role names (over 32 characters) used to overflow audit_logs.role and fail with a 500."""
    w = make_wallet(90)
    grant({w.address: ["super_admin", "settlement_manager", "market_manager", "project_reviewer", "verification_admin", "support_admin"]})
    h = login(client, w)
    _, _, pid = _submitted(client)
    assert client.post(f"/api/admin/projects/{pid}/transition", headers=h, json={"to": "Approved"}).status_code == 200
    assert client.post(f"/api/admin/projects/{pid}/badges", headers=h, json={"badge": "verified_project", "evidence": "checked"}).status_code == 200
    with SessionLocal() as db:
        assert {a.role for a in db.scalars(select(AuditLog))} == {"super_admin"}


def test_only_tokens_on_arc_can_be_listed(client):
    """Settlement happens on Arc, so a project whose token lives on another chain is refused with a clear reason."""
    w = team()
    h = login(client, w)
    for chain in ("Ethereum", "Solana", "Base", "Arc-like"):
        r = create(client, h, w, blockchain=chain)
        assert r.status_code == 422, (chain, r.text)
        assert r.json()["error"]["code"] == "arc_only"
        assert "deployed on Arc" in r.json()["error"]["message"]
    for label in ("Arc", "arc testnet", "ARC NETWORK"):
        r = create(client, h, w, blockchain=label)
        assert r.status_code == 200, (label, r.text)
        assert r.json()["blockchain"] == "Arc"  # stored in one canonical form


def test_the_tge_date_can_be_tbd(client):
    """A project whose team has not fixed the TGE date can say "TBD" instead of a date or free text."""
    w = team()
    h = login(client, w)
    pid = create(client, h, w, tge_info="", tge_date=None).json()["id"]
    r = client.post(f"/api/projects/{pid}/submit", headers=h)
    assert r.status_code == 422 and "TGE information" in r.text  # nothing about the TGE yet

    body = {**GOOD, "team_wallet": w.address, "tge_info": "", "tge_tbd": True, "tge_date": "2027-01-01T00:00:00Z"}
    r = client.put(f"/api/projects/{pid}", json=body, headers=h)
    assert r.status_code == 200, r.text
    assert r.json()["tge_tbd"] is True
    assert r.json()["tge_date"] is None  # "TBD" and a date exclude each other
    assert client.post(f"/api/projects/{pid}/submit", headers=h).status_code == 200  # TBD counts as an answer

    # back to a real date: TBD is switched off
    r = client.put(f"/api/projects/{pid}", json={**body, "tge_tbd": False}, headers=h)
    assert r.status_code in (200, 409)  # a submitted application is locked; the rule is checked on a fresh draft below
    pid2 = create(client, h, w, tge_info="", tge_tbd=False, tge_date="2027-02-01T00:00:00Z").json()["id"]
    got = client.get(f"/api/projects/mine/{pid2}", headers=h).json()
    assert got["tge_tbd"] is False and got["tge_date"].startswith("2027-02-01")
