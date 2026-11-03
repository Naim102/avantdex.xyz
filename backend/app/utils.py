"""Validation and serialization helpers shared by routers."""

from __future__ import annotations

import datetime as dt
import re
import secrets

from sqlalchemy import select
from sqlalchemy.orm import Session

from .models import Market, Project, VerificationBadge, utcnow
from .security import ADDRESS_RE, ApiError

SYMBOL_RE = re.compile(r"^[A-Z0-9]{1,12}$")
CATEGORIES = ["DeFi", "Infrastructure", "AI", "Gaming", "RWA", "Payments", "Other"]
BADGES = ("verified_project", "contract_verified", "allocation_verified")


def iso(value: dt.datetime | None) -> str | None:
    if value is None:
        return None
    if value.tzinfo is None:
        value = value.replace(tzinfo=dt.timezone.utc)
    return value.isoformat()


def clean_text(value: str | None, field: str, max_len: int, required: bool = False) -> str:
    v = (value or "").strip()
    if required and not v:
        raise ApiError(422, "validation_error", f"{field} is required")
    if len(v) > max_len:
        raise ApiError(422, "validation_error", f"{field} must be at most {max_len} characters")
    if re.search(r"[\x00-\x08\x0b\x0c\x0e-\x1f]", v):
        raise ApiError(422, "validation_error", f"{field} contains control characters")
    return v


def https_url(value: str | None, field: str, required: bool = False) -> str:
    v = (value or "").strip()
    if not v:
        if required:
            raise ApiError(422, "validation_error", f"{field} is required")
        return ""
    if len(v) > 500 or not re.match(r"^https://[^\s<>\"']+$", v):
        raise ApiError(422, "validation_error", f"{field} must be a valid https:// URL")
    return v


def evm_address(value: str | None, field: str, required: bool = False) -> str:
    v = (value or "").strip()
    if not v:
        if required:
            raise ApiError(422, "validation_error", f"{field} is required")
        return ""
    if not ADDRESS_RE.match(v):
        raise ApiError(422, "validation_error", f"{field} must be a valid 0x address")
    return v.lower()


def symbol(value: str | None) -> str:
    v = (value or "").strip().upper()
    if not SYMBOL_RE.match(v):
        raise ApiError(422, "validation_error", "Token symbol must be 1-12 characters A-Z or 0-9")
    return v


def make_slug(db: Session, name: str) -> str:
    base = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")[:50] or "project"
    slug = base
    while db.scalar(select(Project.id).where(Project.slug == slug)) or db.scalar(select(Market.id).where(Market.slug == slug)):
        slug = f"{base}-{secrets.token_hex(2)}"
    return slug


def active_badges(p: Project) -> list[dict]:
    now = utcnow()
    out = []
    for b in p.badges:
        exp = b.expires_at
        if exp is not None and exp.tzinfo is None:
            exp = exp.replace(tzinfo=dt.timezone.utc)
        if b.revoked_at is None and (exp is None or exp > now):
            out.append({"badge": b.badge, "granted_at": iso(b.created_at), "expires_at": iso(b.expires_at)})
    return out


def project_public(p: Project) -> dict:
    return {
        "id": p.id,
        "slug": p.slug,
        "name": p.name,
        "token_name": p.token_name,
        "token_symbol": p.token_symbol,
        "logo_url": p.logo_url,
        "description": p.description,
        "website": p.website,
        "socials": p.socials,
        "category": p.category,
        "blockchain": p.blockchain,
        "token_address": p.token_address,
        "supply_info": p.supply_info,
        "allocation_info": p.allocation_info,
        "tge_info": p.tge_info,
        "tge_date": iso(p.tge_date),
        "documentation": p.documentation,
        "badges": active_badges(p),
    }


def project_private(p: Project) -> dict:
    d = project_public(p)
    d.update(
        {
            "status": p.status,
            "applicant": p.applicant,
            "team_wallet": p.team_wallet,
            "evidence": p.evidence,
            "review_note": p.review_note,
            "created_at": iso(p.created_at),
            "updated_at": iso(p.updated_at),
            "history": [
                {"from": h.from_status, "to": h.to_status, "actor": h.actor, "reason": h.reason, "at": iso(h.created_at)}
                for h in p.history
            ],
        }
    )
    return d


def to_str_amounts(d: dict, *keys: str) -> dict:
    for k in keys:
        if d.get(k) is not None:
            d[k] = str(d[k])
    return d
