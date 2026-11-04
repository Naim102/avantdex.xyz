"""Wallet-signature login (EIP-4361 style), JWT sessions, roles, rate limiting and audit logging."""

from __future__ import annotations

import datetime as dt
import re
import secrets
import time
from collections import defaultdict, deque

import jwt
from eth_account import Account
from eth_account.messages import encode_defunct
from fastapi import Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from .config import get_settings
from .db import get_db
from .models import AdminRole, AuditLog, AuthNonce, User, utcnow

# One admin level: every admin can do every dashboard action. The older split roles still parse (existing
# rows and ADMIN_ROLES entries keep working) and are treated exactly like super_admin.
ROLES = ("super_admin",)
LEGACY_ROLES = ("project_reviewer", "verification_admin", "market_manager", "settlement_manager", "support_admin")
ADDRESS_RE = re.compile(r"^0x[0-9a-fA-F]{40}$")


class ApiError(HTTPException):
    def __init__(self, status: int, code: str, message: str):
        super().__init__(status_code=status, detail={"code": code, "message": message})


def normalize_address(address: str) -> str:
    if not isinstance(address, str) or not ADDRESS_RE.match(address):
        raise ApiError(422, "invalid_address", "Address must be a 0x-prefixed 20-byte hex string")
    return address.lower()


# --------------------------------------------------------------------------- login message


def build_message(address: str, nonce: str, issued: dt.datetime, expires: dt.datetime) -> str:
    s = get_settings()
    return (
        f"{s.auth_domain} wants you to sign in with your Ethereum account:\n"
        f"{address}\n\n"
        "Sign in to Avantdex. This signature does not authorize any transaction or token approval.\n\n"
        f"URI: {s.auth_uri}\n"
        "Version: 1\n"
        f"Chain ID: {s.chain_id}\n"
        f"Nonce: {nonce}\n"
        f"Issued At: {issued.strftime('%Y-%m-%dT%H:%M:%SZ')}\n"
        f"Expiration Time: {expires.strftime('%Y-%m-%dT%H:%M:%SZ')}"
    )


def issue_nonce(db: Session, address: str) -> AuthNonce:
    s = get_settings()
    nonce = secrets.token_hex(16)
    issued = utcnow()
    expires = issued + dt.timedelta(minutes=s.nonce_minutes)
    row = AuthNonce(nonce=nonce, address=address, message=build_message(address, nonce, issued, expires), expires_at=expires)
    db.add(row)
    db.commit()
    return row


def verify_signature(db: Session, address: str, nonce: str, signature: str) -> None:
    row = db.get(AuthNonce, nonce)
    if row is None or row.address != address:
        raise ApiError(401, "bad_nonce", "Unknown nonce for this address")
    if row.used:
        raise ApiError(401, "nonce_used", "This nonce was already used")
    if row.expires_at < utcnow():
        raise ApiError(401, "nonce_expired", "This nonce has expired")
    try:
        recovered = Account.recover_message(encode_defunct(text=row.message), signature=signature)
    except Exception as exc:  # malformed signature
        raise ApiError(401, "bad_signature", "Invalid signature") from exc
    if recovered.lower() != address:
        raise ApiError(401, "bad_signature", "Signature does not match the address")
    row.used = True  # single use, even on later failures
    db.commit()


# --------------------------------------------------------------------------- sessions


def roles_of(db: Session, address: str) -> list[str]:
    return list(db.scalars(select(AdminRole.role).where(AdminRole.address == address)))


def create_token(db: Session, address: str) -> tuple[str, int]:
    s = get_settings()
    hours = s.admin_session_hours if roles_of(db, address) else s.session_hours
    exp = utcnow() + dt.timedelta(hours=hours)
    token = jwt.encode({"sub": address, "exp": int(exp.timestamp()), "iat": int(time.time())}, s.jwt_secret, algorithm="HS256")
    return token, hours * 3600


def touch_user(db: Session, address: str) -> None:
    u = db.scalar(select(User).where(User.address == address))
    now = utcnow()
    if u is None:
        db.add(User(address=address, first_seen=now, last_seen=now))
    else:
        u.last_seen = now
    db.commit()


class Session_:
    def __init__(self, address: str, roles: list[str]):
        self.address = address
        self.roles = roles

    def has_any(self, *roles: str) -> bool:
        return bool(self.roles)  # any admin may do anything in the dashboard


def _decode(request: Request) -> str | None:
    header = request.headers.get("authorization", "")
    if not header.lower().startswith("bearer "):
        return None
    try:
        payload = jwt.decode(header[7:], get_settings().jwt_secret, algorithms=["HS256"])
    except jwt.PyJWTError:
        raise ApiError(401, "bad_token", "Invalid or expired session")
    return str(payload["sub"]).lower()


def current_user(request: Request, db: Session = Depends(get_db)) -> Session_:
    address = _decode(request)
    if address is None:
        raise ApiError(401, "auth_required", "Sign in with your wallet")
    return Session_(address, roles_of(db, address))


def optional_user(request: Request, db: Session = Depends(get_db)) -> Session_ | None:
    address = _decode(request)
    return None if address is None else Session_(address, roles_of(db, address))


def require_roles(*roles: str):
    """Dependency: the caller must be an admin (all admin roles are equivalent)."""

    def dep(user: Session_ = Depends(current_user)) -> Session_:
        if not user.roles:
            raise ApiError(403, "forbidden", "Admin access required")
        if not user.has_any(*roles):
            raise ApiError(403, "forbidden", "Your role does not allow this action")
        return user

    return dep


def require_any_admin(user: Session_ = Depends(current_user)) -> Session_:
    if not user.roles:
        raise ApiError(403, "forbidden", "Admin access required")
    return user


# --------------------------------------------------------------------------- audit log


def audit(db: Session, user: Session_, action: str, entity_type: str, entity_id: object, before=None, after=None) -> None:
    db.add(
        AuditLog(
            actor=user.address,
            role=",".join(user.roles),
            action=action,
            entity_type=entity_type,
            entity_id=str(entity_id),
            before=before,
            after=after,
        )
    )


# --------------------------------------------------------------------------- rate limiting (in memory)

_hits: dict[str, deque] = defaultdict(deque)


def rate_limit(key_prefix: str, limit: int, window_seconds: int):
    """Dependency factory: at most `limit` calls per `window_seconds` per client IP."""

    def dep(request: Request) -> None:
        if get_settings().env == "test":
            return
        ip = request.client.host if request.client else "unknown"
        key = f"{key_prefix}:{ip}"
        now = time.monotonic()
        q = _hits[key]
        while q and now - q[0] > window_seconds:
            q.popleft()
        if len(q) >= limit:
            raise ApiError(429, "rate_limited", "Too many requests, slow down")
        q.append(now)

    return dep
