"""Signed-in user features: project applications, listing requests, notifications, disputes."""

from __future__ import annotations

import datetime as dt

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import Dispute, ListingRequest, Notification, Project, ProjectStatusHistory, Trade, utcnow
from ..security import ApiError, Session_, current_user, rate_limit
from ..utils import (
    CATEGORIES,
    arc_chain,
    clean_text,
    evm_address,
    https_url,
    iso,
    make_slug,
    project_private,
    symbol,
)

router = APIRouter(tags=["user"])


# --------------------------------------------------------------------------- project applications


class ProjectIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str = ""
    token_name: str = ""
    token_symbol: str = ""
    logo_url: str = ""
    description: str = ""
    website: str = ""
    socials: list[str] = Field(default_factory=list)
    category: str = "Other"
    blockchain: str = ""
    token_address: str = ""
    supply_info: str = ""
    allocation_info: str = ""
    tge_info: str = ""
    tge_date: dt.datetime | None = None
    documentation: list[str] = Field(default_factory=list)
    evidence: str = ""
    team_wallet: str = ""


def _apply(p: Project, body: ProjectIn) -> None:
    p.name = clean_text(body.name, "Project name", 120, required=True)
    p.token_name = clean_text(body.token_name, "Token name", 120)
    p.token_symbol = symbol(body.token_symbol)
    p.logo_url = https_url(body.logo_url, "Logo URL")
    p.description = clean_text(body.description, "Description", 2000)
    p.website = https_url(body.website, "Website")
    p.socials = [https_url(u, "Social link", required=True) for u in body.socials[:8]]
    if body.category not in CATEGORIES:
        raise ApiError(422, "validation_error", f"Category must be one of {', '.join(CATEGORIES)}")
    p.category = body.category
    p.blockchain = arc_chain(body.blockchain)
    p.token_address = evm_address(body.token_address, "Token contract address")
    p.supply_info = clean_text(body.supply_info, "Supply information", 2000)
    p.allocation_info = clean_text(body.allocation_info, "Allocation information", 2000)
    p.tge_info = clean_text(body.tge_info, "TGE information", 2000)
    p.tge_date = body.tge_date
    p.documentation = [https_url(u, "Documentation link", required=True) for u in body.documentation[:10]]
    p.evidence = clean_text(body.evidence, "Ownership / authorisation evidence", 2000)
    p.team_wallet = evm_address(body.team_wallet, "Team wallet")


def _require_complete(p: Project) -> None:
    missing = []
    if not p.name:
        missing.append("project name")
    if not p.token_symbol:
        missing.append("token symbol")
    if not p.description:
        missing.append("description")
    if not p.website:
        missing.append("official website")
    if not p.socials:
        missing.append("at least one social link")
    if p.blockchain != "Arc":
        missing.append("a token on Arc (Avantdex lists only tokens deployed on Arc)")
    if not (p.tge_info or p.tge_date):
        missing.append("TGE information")
    if not p.evidence:
        missing.append("ownership / authorisation evidence")
    if not p.team_wallet:
        missing.append("team wallet")
    if missing:
        raise ApiError(422, "incomplete_application", "Missing required fields: " + ", ".join(missing))


def _history(db: Session, p: Project, to: str, actor: str, reason: str = "") -> None:
    db.add(ProjectStatusHistory(project_id=p.id, from_status=p.status, to_status=to, actor=actor, reason=reason))
    p.status = to


def _mine(db: Session, user: Session_, pid: int) -> Project:
    p = db.get(Project, pid)
    if p is None or p.applicant != user.address:
        raise ApiError(404, "project_not_found", "Project not found")
    return p


@router.post("/projects", dependencies=[Depends(rate_limit("project", 20, 3600))])
def create_project(body: ProjectIn, user: Session_ = Depends(current_user), db: Session = Depends(get_db)) -> dict:
    since = utcnow() - dt.timedelta(hours=1)
    recent = db.scalar(select(func.count(Project.id)).where(Project.applicant == user.address, Project.created_at >= since))
    if recent >= 5:
        raise ApiError(429, "rate_limited", "At most 5 applications per hour per wallet")
    p = Project(slug="pending", applicant=user.address, status="Draft", name="", token_symbol="X")
    _apply(p, body)
    p.slug = make_slug(db, p.name)
    db.add(p)
    db.flush()
    db.add(ProjectStatusHistory(project_id=p.id, from_status=None, to_status="Draft", actor=user.address, reason="created"))
    db.commit()
    return project_private(p)


@router.put("/projects/{pid}")
def update_project(pid: int, body: ProjectIn, user: Session_ = Depends(current_user), db: Session = Depends(get_db)) -> dict:
    p = _mine(db, user, pid)
    if p.status not in ("Draft", "Changes Requested"):
        raise ApiError(409, "not_editable", "Only drafts and applications with requested changes can be edited")
    _apply(p, body)
    db.commit()
    return project_private(p)


@router.post("/projects/{pid}/submit", dependencies=[Depends(rate_limit("submit", 20, 3600))])
def submit_project(pid: int, user: Session_ = Depends(current_user), db: Session = Depends(get_db)) -> dict:
    p = _mine(db, user, pid)
    if p.status not in ("Draft", "Changes Requested"):
        raise ApiError(409, "invalid_transition", f"Cannot submit from status {p.status}")
    _require_complete(p)
    if p.team_wallet != user.address:
        raise ApiError(
            422,
            "team_wallet_mismatch",
            "Sign in with the team wallet you entered to prove control of it, or change the team wallet.",
        )
    _history(db, p, "Submitted", user.address, "submitted by applicant")
    db.commit()
    return project_private(p)


@router.get("/projects/mine")
def my_projects(user: Session_ = Depends(current_user), db: Session = Depends(get_db)) -> dict:
    rows = db.scalars(select(Project).where(Project.applicant == user.address).order_by(Project.id.desc()))
    return {"items": [project_private(p) for p in rows]}


@router.get("/projects/mine/{pid}")
def my_project(pid: int, user: Session_ = Depends(current_user), db: Session = Depends(get_db)) -> dict:
    return project_private(_mine(db, user, pid))


# --------------------------------------------------------------------------- listing requests


class RequestIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    project_name: str
    token_symbol: str
    link: str
    reason: str


@router.post("/listing-requests", dependencies=[Depends(rate_limit("lreq", 30, 3600))])
def create_request(body: RequestIn, user: Session_ = Depends(current_user), db: Session = Depends(get_db)) -> dict:
    since = utcnow() - dt.timedelta(days=1)
    recent = db.scalar(select(func.count(ListingRequest.id)).where(ListingRequest.requester == user.address, ListingRequest.created_at >= since))
    if recent >= 5:
        raise ApiError(429, "rate_limited", "At most 5 listing requests per day per wallet")
    sym = symbol(body.token_symbol)
    r = ListingRequest(
        requester=user.address,
        project_name=clean_text(body.project_name, "Project name", 120, required=True),
        token_symbol=sym,
        link=https_url(body.link, "Website or social link", required=True),
        reason=clean_text(body.reason, "Reason", 1000, required=True),
    )
    db.add(r)
    db.commit()
    same = db.scalar(select(func.count(ListingRequest.id)).where(ListingRequest.token_symbol == sym))
    return {"id": r.id, "status": r.status, "requests_for_symbol": same}


@router.get("/listing-requests/summary")
def requests_summary(db: Session = Depends(get_db)) -> dict:
    rows = db.execute(
        select(ListingRequest.token_symbol, func.count(ListingRequest.id))
        .where(ListingRequest.status.in_(("Open", "Under Review")))
        .group_by(ListingRequest.token_symbol)
        .order_by(func.count(ListingRequest.id).desc())
        .limit(20)
    ).all()
    return {"items": [{"token_symbol": s, "requests": c} for s, c in rows]}


@router.get("/listing-requests/mine")
def my_requests(user: Session_ = Depends(current_user), db: Session = Depends(get_db)) -> dict:
    rows = db.scalars(select(ListingRequest).where(ListingRequest.requester == user.address).order_by(ListingRequest.id.desc()))
    return {
        "items": [
            {"id": r.id, "project_name": r.project_name, "token_symbol": r.token_symbol, "status": r.status, "created_at": iso(r.created_at)}
            for r in rows
        ]
    }


# --------------------------------------------------------------------------- notifications


def notification_json(n: Notification) -> dict:
    return {"id": n.id, "kind": n.kind, "title": n.title, "body": n.body, "link": n.link, "read": n.read, "created_at": iso(n.created_at)}


@router.get("/notifications")
def notifications(limit: int = Query(50, ge=1, le=200), user: Session_ = Depends(current_user), db: Session = Depends(get_db)) -> dict:
    rows = list(db.scalars(select(Notification).where(Notification.address == user.address).order_by(Notification.id.desc()).limit(limit)))
    unread = db.scalar(select(func.count(Notification.id)).where(Notification.address == user.address, Notification.read.is_(False)))
    return {"items": [notification_json(n) for n in rows], "unread": unread}


@router.post("/notifications/{nid}/read")
def mark_read(nid: int, user: Session_ = Depends(current_user), db: Session = Depends(get_db)) -> dict:
    n = db.get(Notification, nid)
    if n is None or n.address != user.address:
        raise ApiError(404, "not_found", "Notification not found")
    n.read = True
    db.commit()
    return {"ok": True}


@router.post("/notifications/read-all")
def mark_all_read(user: Session_ = Depends(current_user), db: Session = Depends(get_db)) -> dict:
    for n in db.scalars(select(Notification).where(Notification.address == user.address, Notification.read.is_(False))):
        n.read = True
    db.commit()
    return {"ok": True}


# --------------------------------------------------------------------------- disputes (off-chain tickets; cannot move funds)


class DisputeIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    trade_id: int
    reason: str
    evidence: list[str] = Field(default_factory=list)


@router.post("/disputes", dependencies=[Depends(rate_limit("dispute", 20, 3600))])
def open_dispute(body: DisputeIn, user: Session_ = Depends(current_user), db: Session = Depends(get_db)) -> dict:
    t = db.get(Trade, body.trade_id)
    if t is None or user.address not in (t.buyer, t.seller):
        raise ApiError(404, "trade_not_found", "Trade not found for this wallet")
    d = Dispute(
        trade_id=t.id,
        opener=user.address,
        reason=clean_text(body.reason, "Reason", 2000, required=True),
        evidence=[https_url(u, "Evidence link", required=True) for u in body.evidence[:10]],
    )
    db.add(d)
    db.commit()
    return dispute_json(d, include_notes=False)


@router.get("/disputes/mine")
def my_disputes(user: Session_ = Depends(current_user), db: Session = Depends(get_db)) -> dict:
    rows = db.scalars(select(Dispute).where(Dispute.opener == user.address).order_by(Dispute.id.desc()))
    return {"items": [dispute_json(d, include_notes=False) for d in rows]}


def dispute_json(d: Dispute, include_notes: bool = True) -> dict:
    out = {
        "id": d.id,
        "trade_id": d.trade_id,
        "opener": d.opener,
        "reason": d.reason,
        "evidence": d.evidence,
        "status": d.status,
        "created_at": iso(d.created_at),
        "updated_at": iso(d.updated_at),
        "note": "This ticket cannot move funds. On-chain settlement, default and refund rules are deterministic.",
    }
    if include_notes:
        out["notes"] = d.notes
    return out
