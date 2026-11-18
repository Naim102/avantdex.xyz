"""Wallet-signature login. Signing never authorizes transactions or token approvals."""

from __future__ import annotations

from fastapi import APIRouter, Depends
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.orm import Session

from ..db import get_db
from ..security import (
    ApiError,
    Session_,
    create_token,
    current_user,
    issue_nonce,
    normalize_address,
    rate_limit,
    roles_of,
    touch_user,
    verify_signature,
)

router = APIRouter(prefix="/auth", tags=["auth"])


class NonceIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    address: str


class VerifyIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    address: str
    nonce: str
    signature: str = Field(max_length=16500)  # 65-byte ECDSA, or an ERC-6492 wrapper from a smart wallet (capped again in smart_sig)


@router.post("/nonce", dependencies=[Depends(rate_limit("nonce", 30, 60))])
def nonce(body: NonceIn, db: Session = Depends(get_db)) -> dict:
    address = normalize_address(body.address)
    row = issue_nonce(db, address)
    return {"nonce": row.nonce, "message": row.message, "expires_at": row.expires_at.isoformat()}


@router.post("/verify", dependencies=[Depends(rate_limit("verify", 30, 60))])
def verify(body: VerifyIn, db: Session = Depends(get_db)) -> dict:
    address = normalize_address(body.address)
    verify_signature(db, address, body.nonce, body.signature)
    touch_user(db, address)
    token, ttl = create_token(db, address)
    return {"token": token, "expires_in": ttl, "address": address, "roles": roles_of(db, address)}


@router.get("/me")
def me(user: Session_ = Depends(current_user)) -> dict:
    return {"address": user.address, "roles": user.roles}


@router.post("/logout")
def logout(user: Session_ = Depends(current_user)) -> dict:
    # Sessions are stateless and short lived; the client discards the token.
    return {"ok": True}
