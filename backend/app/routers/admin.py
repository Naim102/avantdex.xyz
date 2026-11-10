"""Admin dashboard API. Every route checks a role server-side and every mutation is audit-logged.

Admins can never move escrowed funds: nothing here (or in the contract) allows it. Market actions that touch the
chain are signed by the manager's own wallet in the browser; this API only prepares parameters and records
off-chain decisions.
"""

from __future__ import annotations

import datetime as dt

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session, joinedload

from ..chain import decode_market, get_exchange, get_web3, live_fee_collector, metadata_ref_for
from ..config import get_settings
from ..db import get_db
from ..models import (
    AdminRole,
    AuditLog,
    Dispute,
    ListingRequest,
    Market,
    Order,
    Project,
    ProjectStatusHistory,
    Setting,
    Trade,
    User,
    VerificationBadge,
    IndexerState,
    utcnow,
)
from ..security import LEGACY_ROLES, ROLES, ApiError, Session_, audit, normalize_address, require_any_admin, role_label
from ..utils import BADGES, clean_text, iso, make_slug, project_private
from .public import market_json, bulk_stats
from .user import ProjectIn, _apply, dispute_json

router = APIRouter(prefix="/admin", tags=["admin"])

# from-status -> statuses an admin may move the project to (every admin can take every step)
TRANSITIONS: dict[str, set[str]] = {
    "Submitted": {"Under Review", "Approved", "Changes Requested", "Rejected"},
    "Under Review": {"Verification", "Approved", "Changes Requested", "Rejected"},
    "Verification": {"Approved", "Changes Requested", "Rejected"},
    "Changes Requested": {"Under Review", "Approved", "Rejected"},
    "Rejected": {"Under Review", "Approved"},
    "Approved": {"Market Setup", "Under Review", "Rejected"},
    "Market Setup": {"Approved"},
    "Live": {"Delisted"},
    "Suspended": {"Delisted"},
}
NEEDS_REASON = {"Rejected", "Changes Requested", "Delisted"}


# --------------------------------------------------------------------------- overview


@router.get("/overview")
def overview(user: Session_ = Depends(require_any_admin), db: Session = Depends(get_db)) -> dict:
    by_status = dict(db.execute(select(Project.status, func.count(Project.id)).group_by(Project.status)).all())
    markets = dict(db.execute(select(Market.status, func.count(Market.id)).group_by(Market.status)).all())
    open_trades = db.scalar(select(func.count(Trade.id)).where(Trade.status == "Open")) or 0
    settled = list(db.scalars(select(Trade).where(Trade.status == "Settled")))
    fees = sum(t.buyer_fee + t.seller_fee for t in settled)
    st = db.get(IndexerState, 1)
    return {
        "applications_by_status": by_status,
        "markets_by_status": markets,
        "open_trades": open_trades,
        "settled_trades": len(settled),
        "fees_collected": str(fees),
        "fee_collector": live_fee_collector(),
        "open_listing_requests": db.scalar(select(func.count(ListingRequest.id)).where(ListingRequest.status.in_(("Open", "Under Review")))) or 0,
        "open_disputes": db.scalar(select(func.count(Dispute.id)).where(Dispute.status.in_(("Open", "In Review")))) or 0,
        "indexer_lag_blocks": None if st is None else max(st.chain_head - st.last_block, 0),
        "you": {"address": user.address, "roles": user.roles},
    }


# --------------------------------------------------------------------------- applications & verification


@router.get("/projects")
def list_projects(
    status: str = Query("", max_length=24),
    user: Session_ = Depends(require_any_admin),
    db: Session = Depends(get_db),
) -> dict:
    q = select(Project).options(joinedload(Project.badges)).order_by(Project.id.desc())
    if status:
        q = q.where(Project.status == status)
    else:
        q = q.where(Project.status != "Draft")
    return {"items": [project_private(p) for p in db.scalars(q).unique()]}


@router.get("/projects/{pid}")
def get_project(
    pid: int,
    user: Session_ = Depends(require_any_admin),
    db: Session = Depends(get_db),
) -> dict:
    p = db.get(Project, pid)
    if p is None or p.status == "Draft":
        raise ApiError(404, "project_not_found", "Project not found")
    return project_private(p)


class TransitionIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    to: str
    reason: str = ""


@router.post("/projects/{pid}/transition")
def transition(pid: int, body: TransitionIn, user: Session_ = Depends(require_any_admin), db: Session = Depends(get_db)) -> dict:
    p = db.get(Project, pid)
    if p is None or p.status == "Draft":
        raise ApiError(404, "project_not_found", "Project not found")
    if body.to not in TRANSITIONS.get(p.status, set()):
        raise ApiError(409, "invalid_transition", f"{p.status} -> {body.to} is not an allowed transition")
    reason = clean_text(body.reason, "Reason", 2000, required=body.to in NEEDS_REASON)
    before = {"status": p.status}
    db.add(ProjectStatusHistory(project_id=p.id, from_status=p.status, to_status=body.to, actor=user.address, reason=reason))
    p.status = body.to
    p.review_note = reason or p.review_note
    if body.to == "Delisted":
        for m in db.scalars(select(Market).where(Market.project_id == p.id)):
            m.delisted = True  # off-chain discovery flag only; on-chain exits remain open
    audit(db, user, "project.transition", "project", p.id, before, {"status": body.to, "reason": reason})
    db.commit()
    return project_private(p)


class AdminProjectIn(ProjectIn):
    status: str = "Approved"


@router.post("/projects")
def admin_create_project(body: AdminProjectIn, user: Session_ = Depends(require_any_admin), db: Session = Depends(get_db)) -> dict:
    """Add a project directly (an admin can list a project on behalf of its team). Same validation as an application."""
    if body.status not in ("Submitted", "Under Review", "Verification", "Approved"):
        raise ApiError(422, "validation_error", "status must be Submitted, Under Review, Verification or Approved")
    data = body.model_dump(exclude={"status"})
    data["team_wallet"] = data["team_wallet"] or user.address
    p = Project(slug="pending", applicant=user.address, status="Draft", name="", token_symbol="X")
    _apply(p, ProjectIn(**data))
    p.slug = make_slug(db, p.name)
    db.add(p)
    db.flush()
    db.add(ProjectStatusHistory(project_id=p.id, from_status=None, to_status="Draft", actor=user.address, reason="created by admin"))
    db.add(ProjectStatusHistory(project_id=p.id, from_status="Draft", to_status=body.status, actor=user.address, reason="created by admin"))
    p.status = body.status
    audit(db, user, "project.create", "project", p.id, None, {"name": p.name, "status": p.status})
    db.commit()
    return project_private(p)


@router.put("/projects/{pid}")
def admin_edit_project(pid: int, body: ProjectIn, user: Session_ = Depends(require_any_admin), db: Session = Depends(get_db)) -> dict:
    """Edit any field of a project at any stage (the market, once created on-chain, is unaffected)."""
    p = db.get(Project, pid)
    if p is None:
        raise ApiError(404, "project_not_found", "Project not found")
    before = project_private(p)
    _apply(p, body)
    audit(db, user, "project.edit", "project", p.id, {"name": before["name"], "symbol": before["token_symbol"]}, {"name": p.name, "symbol": p.token_symbol})
    db.commit()
    return project_private(p)


@router.delete("/projects/{pid}")
def admin_delete_project(pid: int, user: Session_ = Depends(require_any_admin), db: Session = Depends(get_db)) -> dict:
    """Remove a project that has no market on-chain. A project with an on-chain market can only be delisted."""
    p = db.get(Project, pid)
    if p is None:
        raise ApiError(404, "project_not_found", "Project not found")
    markets = list(db.scalars(select(Market).where(Market.project_id == p.id)))
    if any(m.onchain_id is not None for m in markets):
        raise ApiError(409, "has_market", "This project has a market on-chain. Delist it instead of deleting it.")
    for m in markets:
        db.delete(m)
    audit(db, user, "project.delete", "project", p.id, {"name": p.name, "status": p.status}, None)
    db.delete(p)
    db.commit()
    return {"ok": True}


class BadgeIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    badge: str
    evidence: str = Field(min_length=3)
    expires_at: dt.datetime | None = None


@router.post("/projects/{pid}/badges")
def grant_badge(pid: int, body: BadgeIn, user: Session_ = Depends(require_any_admin), db: Session = Depends(get_db)) -> dict:
    p = db.get(Project, pid)
    if p is None or p.status == "Draft":
        raise ApiError(404, "project_not_found", "Project not found")
    if body.badge not in BADGES:
        raise ApiError(422, "validation_error", f"badge must be one of {', '.join(BADGES)}")
    evidence = clean_text(body.evidence, "Evidence", 2000, required=True)
    for b in p.badges:  # re-granting replaces the previous active badge of the same kind
        if b.badge == body.badge and b.revoked_at is None:
            b.revoked_at = utcnow()
    b = VerificationBadge(project_id=p.id, badge=body.badge, evidence=evidence, granted_by=user.address, granted_role=role_label(user.roles), expires_at=body.expires_at)
    db.add(b)
    audit(db, user, "badge.grant", "project", p.id, None, {"badge": body.badge, "evidence": evidence})
    db.commit()
    db.refresh(p)
    return project_private(p)


@router.delete("/projects/{pid}/badges/{badge}")
def revoke_badge(pid: int, badge: str, user: Session_ = Depends(require_any_admin), db: Session = Depends(get_db)) -> dict:
    p = db.get(Project, pid)
    if p is None:
        raise ApiError(404, "project_not_found", "Project not found")
    changed = False
    for b in p.badges:
        if b.badge == badge and b.revoked_at is None:
            b.revoked_at = utcnow()
            changed = True
    if not changed:
        raise ApiError(404, "badge_not_found", "No active badge of that kind")
    audit(db, user, "badge.revoke", "project", p.id, {"badge": badge}, None)
    db.commit()
    db.refresh(p)
    return project_private(p)


# --------------------------------------------------------------------------- listing requests


@router.get("/listing-requests")
def list_requests(user: Session_ = Depends(require_any_admin), db: Session = Depends(get_db)) -> dict:
    rows = db.scalars(select(ListingRequest).order_by(ListingRequest.id.desc()).limit(300))
    return {
        "items": [
            {"id": r.id, "requester": r.requester, "project_name": r.project_name, "token_symbol": r.token_symbol, "link": r.link,
             "reason": r.reason, "status": r.status, "admin_note": r.admin_note, "created_at": iso(r.created_at)}
            for r in rows
        ]
    }


class RequestUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    status: str
    note: str = ""


@router.post("/listing-requests/{rid}")
def update_request(rid: int, body: RequestUpdate, user: Session_ = Depends(require_any_admin), db: Session = Depends(get_db)) -> dict:
    r = db.get(ListingRequest, rid)
    if r is None:
        raise ApiError(404, "not_found", "Request not found")
    if body.status not in ("Open", "Under Review", "Declined", "Duplicate", "Converted"):
        raise ApiError(422, "validation_error", "Invalid status")
    before = {"status": r.status}
    r.status = body.status
    r.admin_note = clean_text(body.note, "Note", 1000)
    audit(db, user, "listing_request.update", "listing_request", r.id, before, {"status": r.status})
    db.commit()
    return {"id": r.id, "status": r.status}


# --------------------------------------------------------------------------- markets


class MarketDraftIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    project_id: int
    lot_size: int = Field(gt=0)
    tick_size: int = Field(gt=0)
    min_lots: int = Field(gt=0)
    max_lots: int = Field(gt=0)
    trading_start: dt.datetime
    trading_end: dt.datetime
    tge_date: dt.datetime | None = None
    token_decimals: int = Field(default=18, ge=0, le=36)


def _utc(v: dt.datetime) -> dt.datetime:
    return v if v.tzinfo else v.replace(tzinfo=dt.timezone.utc)


def onchain_params(m: Market) -> dict:
    token = m.token_address or (m.project.token_address if m.project else "") or "0x0000000000000000000000000000000000000000"
    return {
        "token": token,
        "lotSize": str(m.lot_size),
        "tickSize": str(m.tick_size),
        "minLots": str(m.min_lots),
        "maxLots": str(m.max_lots),
        "tradingStart": int(_utc(m.trading_start).timestamp()),
        "tradingEnd": int(_utc(m.trading_end).timestamp()),
        "metadataRef": m.metadata_ref,
    }


def admin_market_json(m: Market, db: Session) -> dict:
    d = market_json(m, bulk_stats(db, [m.onchain_id])[m.onchain_id] if m.onchain_id is not None else {})
    d.update(
        {
            "created_by": m.created_by,
            "activation_approved_by": m.activation_approved_by,
            "metadata_ref": m.metadata_ref,
            "onchain_params": onchain_params(m),
            "project_status": m.project.status if m.project else None,
            "project_id": m.project_id,
            "two_person_required": get_settings().require_two_person_approval,
        }
    )
    return d


@router.get("/markets")
def list_markets(user: Session_ = Depends(require_any_admin), db: Session = Depends(get_db)) -> dict:
    rows = db.scalars(select(Market).options(joinedload(Market.project).joinedload(Project.badges)).order_by(Market.id.desc())).unique()
    return {"items": [admin_market_json(m, db) for m in rows]}


@router.post("/markets")
def create_market_draft(body: MarketDraftIn, user: Session_ = Depends(require_any_admin), db: Session = Depends(get_db)) -> dict:
    p = db.get(Project, body.project_id)
    if p is None:
        raise ApiError(404, "project_not_found", "Project not found")
    if p.status not in ("Approved", "Market Setup"):
        raise ApiError(409, "project_not_approved", "A market can only be configured for an Approved project")
    if db.scalar(select(Market.id).where(Market.project_id == p.id, Market.status.notin_(("Cancelled", "Completed")))):
        raise ApiError(409, "market_exists", "This project already has an active market record")
    start, end = _utc(body.trading_start), _utc(body.trading_end)
    if body.max_lots < body.min_lots:
        raise ApiError(422, "validation_error", "max_lots must be >= min_lots")
    if end < start + dt.timedelta(hours=1) or end <= utcnow():
        raise ApiError(422, "validation_error", "Trading end must be at least 1 hour after start and in the future")
    slug = p.slug
    n = 1
    while db.scalar(select(Market.id).where(Market.slug == slug)):
        n += 1
        slug = f"{p.slug}-{n}"
    m = Market(
        project_id=p.id, slug=slug, metadata_ref=metadata_ref_for(slug), status="draft",
        token_address=p.token_address or "", token_decimals=body.token_decimals,
        lot_size=body.lot_size, tick_size=body.tick_size, min_lots=body.min_lots, max_lots=body.max_lots,
        trading_start=start, trading_end=end, tge_date=body.tge_date or p.tge_date, created_by=user.address,
    )
    db.add(m)
    if p.status == "Approved":
        db.add(ProjectStatusHistory(project_id=p.id, from_status=p.status, to_status="Market Setup", actor=user.address, reason="market configured"))
        p.status = "Market Setup"
    db.flush()
    audit(db, user, "market.draft", "market", m.id, None, {"slug": slug, "project_id": p.id})
    db.commit()
    db.refresh(m)
    return admin_market_json(m, db)


@router.get("/markets/{mid}")
def get_market(mid: int, user: Session_ = Depends(require_any_admin), db: Session = Depends(get_db)) -> dict:
    m = db.get(Market, mid)
    if m is None:
        raise ApiError(404, "market_not_found", "Market not found")
    return admin_market_json(m, db)


@router.get("/markets/{mid}/verify-config")
def verify_config(mid: int, user: Session_ = Depends(require_any_admin), db: Session = Depends(get_db)) -> dict:
    """Reads the market back from the chain and compares every parameter with the draft (blocks activation on mismatch)."""
    m = db.get(Market, mid)
    if m is None:
        raise ApiError(404, "market_not_found", "Market not found")
    if m.onchain_id is None:
        raise ApiError(409, "not_on_chain", "This market has not been created on-chain yet")
    chain = decode_market(get_exchange(get_web3()).functions.getMarket(m.onchain_id).call())
    p = onchain_params(m)
    expected = {
        "lot_size": int(p["lotSize"]), "tick_size": int(p["tickSize"]), "min_lots": int(p["minLots"]), "max_lots": int(p["maxLots"]),
        "trading_start": p["tradingStart"], "trading_end": p["tradingEnd"], "metadata_ref": p["metadataRef"],
        "token": p["token"].lower(),
    }
    actual = {
        "lot_size": chain["lot_size"], "tick_size": chain["tick_size"], "min_lots": chain["min_lots"], "max_lots": chain["max_lots"],
        "trading_start": int(chain["trading_start"].timestamp()), "trading_end": int(chain["trading_end"].timestamp()),
        "metadata_ref": chain["metadata_ref"], "token": chain["token"],
    }
    checks = [{"field": k, "draft": str(expected[k]), "chain": str(actual[k]), "ok": expected[k] == actual[k]} for k in expected]
    ok = all(c["ok"] for c in checks)
    needs_approval = get_settings().require_two_person_approval
    approved = bool(m.activation_approved_by) and (not needs_approval or m.activation_approved_by != m.created_by)
    return {
        "checks": checks,
        "config_ok": ok,
        "chain_status": chain["status"],
        "activation_approved_by": m.activation_approved_by,
        "two_person_required": needs_approval,
        "can_activate": ok and chain["status"] == "Setup" and (approved or not needs_approval),
    }


@router.post("/markets/{mid}/approve-activation")
def approve_activation(mid: int, user: Session_ = Depends(require_any_admin), db: Session = Depends(get_db)) -> dict:
    m = db.get(Market, mid)
    if m is None:
        raise ApiError(404, "market_not_found", "Market not found")
    if m.onchain_id is None:
        raise ApiError(409, "not_on_chain", "Create the market on-chain first")
    if get_settings().require_two_person_approval and user.address == m.created_by:
        raise ApiError(409, "two_person_rule", "A second admin must approve activation")
    m.activation_approved_by = user.address
    audit(db, user, "market.approve_activation", "market", m.id, None, {"approved_by": user.address})
    db.commit()
    return admin_market_json(m, db)


class DelistIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    delisted: bool


@router.post("/markets/{mid}/delist")
def set_delisted(mid: int, body: DelistIn, user: Session_ = Depends(require_any_admin), db: Session = Depends(get_db)) -> dict:
    """Hide a market from discovery (or show it again). Off-chain only: orders, settlement and refunds are untouched."""
    m = db.get(Market, mid)
    if m is None:
        raise ApiError(404, "market_not_found", "Market not found")
    before = {"delisted": m.delisted}
    m.delisted = body.delisted
    audit(db, user, "market.delist" if body.delisted else "market.relist", "market", m.id, before, {"delisted": m.delisted})
    db.commit()
    return admin_market_json(m, db)


@router.get("/settlement")
def settlement_overview(user: Session_ = Depends(require_any_admin), db: Session = Depends(get_db)) -> dict:
    rows = db.scalars(
        select(Market).options(joinedload(Market.project)).where(Market.onchain_id.is_not(None), Market.status.in_(("Live", "Suspended", "SettlementOpen")))
        .order_by(Market.trading_end.asc())
    ).unique()
    return {"items": [admin_market_json(m, db) for m in rows]}


@router.post("/markets/{mid}/note-action")
def record_market_action(mid: int, body: dict, user: Session_ = Depends(require_any_admin), db: Session = Depends(get_db)) -> dict:
    """Audit trail for on-chain actions the manager signed in their wallet (suspend, open settlement, ...)."""
    m = db.get(Market, mid)
    if m is None:
        raise ApiError(404, "market_not_found", "Market not found")
    action = clean_text(str(body.get("action", "")), "Action", 60, required=True)
    tx = clean_text(str(body.get("tx_hash", "")), "Transaction hash", 70)
    audit(db, user, f"market.onchain.{action}", "market", m.id, None, {"tx_hash": tx, "detail": clean_text(str(body.get("detail", "")), "Detail", 500)})
    db.commit()
    return {"ok": True}


# --------------------------------------------------------------------------- disputes


@router.get("/disputes")
def list_disputes(user: Session_ = Depends(require_any_admin), db: Session = Depends(get_db)) -> dict:
    return {"items": [dispute_json(d) for d in db.scalars(select(Dispute).order_by(Dispute.id.desc()).limit(300))]}


class DisputeUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    status: str | None = None
    note: str = ""


@router.post("/disputes/{did}")
def update_dispute(did: int, body: DisputeUpdate, user: Session_ = Depends(require_any_admin), db: Session = Depends(get_db)) -> dict:
    d = db.get(Dispute, did)
    if d is None:
        raise ApiError(404, "not_found", "Dispute not found")
    before = {"status": d.status}
    if body.status:
        if body.status not in ("Open", "In Review", "Resolved", "Rejected"):
            raise ApiError(422, "validation_error", "Invalid status")
        d.status = body.status
    if body.note.strip():
        d.notes = [*d.notes, {"by": user.address, "at": utcnow().isoformat(), "note": clean_text(body.note, "Note", 2000)}]
    audit(db, user, "dispute.update", "dispute", d.id, before, {"status": d.status})
    db.commit()
    return dispute_json(d)


# --------------------------------------------------------------------------- users, roles, audit, settings


@router.get("/users")
def users(user: Session_ = Depends(require_any_admin), limit: int = Query(200, ge=1, le=500), db: Session = Depends(get_db)) -> dict:
    rows = list(db.scalars(select(User).order_by(User.last_seen.desc()).limit(limit)))
    out = []
    for u in rows:
        orders = db.scalar(select(func.count(Order.id)).where(Order.owner == u.address)) or 0
        trades = db.scalar(select(func.count(Trade.id)).where((Trade.buyer == u.address) | (Trade.seller == u.address))) or 0
        out.append({"address": u.address, "first_seen": iso(u.first_seen), "last_seen": iso(u.last_seen), "orders": orders, "trades": trades})
    return {"items": out}


@router.get("/roles")
def roles(user: Session_ = Depends(require_any_admin), db: Session = Depends(get_db)) -> dict:
    rows = list(db.scalars(select(AdminRole).order_by(AdminRole.id)))
    onchain: dict[str, dict] = {}
    try:  # read on-chain role holders for display (best effort)
        ex = get_exchange(get_web3())
        names = {"DEFAULT_ADMIN_ROLE": ex.functions.DEFAULT_ADMIN_ROLE().call(), "MARKET_MANAGER_ROLE": ex.functions.MARKET_MANAGER_ROLE().call(), "PAUSER_ROLE": ex.functions.PAUSER_ROLE().call()}
        from web3 import Web3

        for addr in {r.address for r in rows}:
            onchain[addr] = {n: ex.functions.hasRole(h, Web3.to_checksum_address(addr)).call() for n, h in names.items()}
    except Exception:
        onchain = {}
    return {
        "available_roles": list(ROLES),
        "items": [{"id": r.id, "address": r.address, "role": r.role, "granted_by": r.granted_by, "created_at": iso(r.created_at), "onchain": onchain.get(r.address)} for r in rows],
    }


class RoleIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    address: str
    role: str = "super_admin"


@router.post("/roles")
def grant_role(body: RoleIn, user: Session_ = Depends(require_any_admin), db: Session = Depends(get_db)) -> dict:
    """Add an admin. There is one admin level; `role` is accepted for older clients and must be a known name."""
    addr = normalize_address(body.address)
    if body.role not in ROLES and body.role not in LEGACY_ROLES:
        raise ApiError(422, "validation_error", "role must be super_admin")
    if db.scalar(select(AdminRole.id).where(AdminRole.address == addr)):
        raise ApiError(409, "exists", "This wallet is already an admin")
    db.add(AdminRole(address=addr, role="super_admin", granted_by=user.address))
    audit(db, user, "role.grant", "admin_role", addr, None, {"role": "super_admin"})
    db.commit()
    return {"ok": True}


@router.delete("/roles/{rid}")
def revoke_role(rid: int, user: Session_ = Depends(require_any_admin), db: Session = Depends(get_db)) -> dict:
    r = db.get(AdminRole, rid)
    if r is None:
        raise ApiError(404, "not_found", "Role assignment not found")
    if r.role == "super_admin" and (db.scalar(select(func.count(AdminRole.id)).where(AdminRole.role == "super_admin")) or 0) <= 1:
        raise ApiError(409, "last_super_admin", "Cannot remove the last super admin")
    audit(db, user, "role.revoke", "admin_role", r.address, {"role": r.role}, None)
    db.delete(r)
    db.commit()
    return {"ok": True}


@router.get("/audit-logs")
def audit_logs(
    action: str = Query("", max_length=60),
    actor: str = Query("", max_length=42),
    limit: int = Query(100, ge=1, le=500),
    user: Session_ = Depends(require_any_admin),
    db: Session = Depends(get_db),
) -> dict:
    q = select(AuditLog).order_by(AuditLog.id.desc()).limit(limit)
    if action:
        q = q.where(AuditLog.action.like(f"{action}%"))
    if actor:
        q = q.where(AuditLog.actor == actor.lower())
    return {
        "items": [
            {"id": a.id, "actor": a.actor, "role": a.role, "action": a.action, "entity_type": a.entity_type, "entity_id": a.entity_id, "before": a.before, "after": a.after, "created_at": iso(a.created_at)}
            for a in db.scalars(q)
        ]
    }


@router.get("/settings")
def get_admin_settings(user: Session_ = Depends(require_any_admin), db: Session = Depends(get_db)) -> dict:
    s = get_settings()
    notice = db.get(Setting, "notice")
    return {
        "chain_id": s.chain_id,
        "exchange_address": s.exchange_address,
        "usdc_address": s.usdc_address,
        "fee_collector": live_fee_collector(),
        "buyer_fee_bps": s.buyer_fee_bps,
        "seller_fee_bps": s.seller_fee_bps,
        "two_person_required": s.require_two_person_approval,
        "notice": notice.value if notice else "",
        "note": "Fee rates are constants in the contract; the fee collector can only be changed on-chain by DEFAULT_ADMIN_ROLE.",
    }


class SettingsIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    notice: str = ""


@router.put("/settings")
def put_settings(body: SettingsIn, user: Session_ = Depends(require_any_admin), db: Session = Depends(get_db)) -> dict:
    text = clean_text(body.notice, "Notice", 500)
    row = db.get(Setting, "notice")
    before = {"notice": row.value if row else ""}
    if row is None:
        db.add(Setting(key="notice", value=text))
    else:
        row.value = text
    audit(db, user, "settings.notice", "settings", "notice", before, {"notice": text})
    db.commit()
    return {"notice": text}
