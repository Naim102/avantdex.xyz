"""PostgreSQL data model.

On-chain state (orders, trades, market status) is mirrored from the exchange contract by the indexer and the
chain is canonical. Off-chain facts (applications, badges, metadata, disputes, audit logs) are canonical here.
All money amounts are stored as exact integers (NUMERIC(78,0)) in token base units. No floats.
"""

from __future__ import annotations

import datetime as dt
from decimal import Decimal
from typing import Any

from sqlalchemy import (
    JSON,
    BigInteger,
    Boolean,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship
from sqlalchemy.types import TypeDecorator


class Uint(TypeDecorator):
    """Exact unsigned integer stored as NUMERIC(78,0)."""

    impl = Numeric(78, 0)
    cache_ok = True

    def process_bind_param(self, value: Any, dialect: Any) -> Decimal | None:
        if value is None:
            return None
        if int(value) < 0:
            raise ValueError("negative amount")
        return Decimal(int(value))

    def process_result_value(self, value: Any, dialect: Any) -> int | None:
        return None if value is None else int(value)


def utcnow() -> dt.datetime:
    return dt.datetime.now(dt.timezone.utc)


class Base(DeclarativeBase):
    pass


# --------------------------------------------------------------------------- identity & auth


class User(Base):
    __tablename__ = "users"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    address: Mapped[str] = mapped_column(String(42), unique=True, index=True)
    first_seen: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    last_seen: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class AdminRole(Base):
    __tablename__ = "admin_roles"
    __table_args__ = (UniqueConstraint("address", "role", name="uq_admin_role"),)
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    address: Mapped[str] = mapped_column(String(42), index=True)
    role: Mapped[str] = mapped_column(String(32))
    granted_by: Mapped[str | None] = mapped_column(String(42), nullable=True)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class AuthNonce(Base):
    __tablename__ = "auth_nonces"
    nonce: Mapped[str] = mapped_column(String(64), primary_key=True)
    address: Mapped[str] = mapped_column(String(42), index=True)
    message: Mapped[str] = mapped_column(Text)
    expires_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True))
    used: Mapped[bool] = mapped_column(Boolean, default=False)


# --------------------------------------------------------------------------- projects & listing


class Project(Base):
    __tablename__ = "projects"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    slug: Mapped[str] = mapped_column(String(80), unique=True, index=True)
    applicant: Mapped[str] = mapped_column(String(42), index=True)
    status: Mapped[str] = mapped_column(String(24), default="Draft", index=True)
    name: Mapped[str] = mapped_column(String(120))
    token_name: Mapped[str] = mapped_column(String(120), default="")
    token_symbol: Mapped[str] = mapped_column(String(12), index=True)
    logo_url: Mapped[str] = mapped_column(String(500), default="")
    description: Mapped[str] = mapped_column(Text, default="")
    website: Mapped[str] = mapped_column(String(500), default="")
    socials: Mapped[list] = mapped_column(JSON, default=list)
    category: Mapped[str] = mapped_column(String(40), default="Other", index=True)
    blockchain: Mapped[str] = mapped_column(String(60), default="")
    token_address: Mapped[str] = mapped_column(String(42), default="")
    supply_info: Mapped[str] = mapped_column(Text, default="")
    allocation_info: Mapped[str] = mapped_column(Text, default="")
    tge_info: Mapped[str] = mapped_column(Text, default="")
    tge_date: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    documentation: Mapped[list] = mapped_column(JSON, default=list)
    evidence: Mapped[str] = mapped_column(Text, default="")
    team_wallet: Mapped[str] = mapped_column(String(42), default="")
    review_note: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)

    badges: Mapped[list[VerificationBadge]] = relationship(back_populates="project", cascade="all, delete-orphan")
    history: Mapped[list[ProjectStatusHistory]] = relationship(
        back_populates="project", cascade="all, delete-orphan", order_by="ProjectStatusHistory.id"
    )


class ProjectStatusHistory(Base):
    __tablename__ = "project_status_history"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), index=True)
    from_status: Mapped[str | None] = mapped_column(String(24), nullable=True)
    to_status: Mapped[str] = mapped_column(String(24))
    actor: Mapped[str] = mapped_column(String(42))
    reason: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    project: Mapped[Project] = relationship(back_populates="history")


class VerificationBadge(Base):
    __tablename__ = "verification_badges"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), index=True)
    badge: Mapped[str] = mapped_column(String(24))  # verified_project | contract_verified | allocation_verified
    evidence: Mapped[str] = mapped_column(Text, default="")
    granted_by: Mapped[str] = mapped_column(String(42))
    granted_role: Mapped[str] = mapped_column(String(32), default="")
    expires_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    revoked_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    project: Mapped[Project] = relationship(back_populates="badges")


class ListingRequest(Base):
    __tablename__ = "listing_requests"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    requester: Mapped[str] = mapped_column(String(42), index=True)
    project_name: Mapped[str] = mapped_column(String(120))
    token_symbol: Mapped[str] = mapped_column(String(12), index=True)
    link: Mapped[str] = mapped_column(String(500))
    reason: Mapped[str] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(24), default="Open", index=True)  # Open|Under Review|Declined|Duplicate|Converted
    admin_note: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


# --------------------------------------------------------------------------- markets & chain mirror


class Market(Base):
    """Off-chain market record plus a mirror of the on-chain market."""

    __tablename__ = "markets"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    project_id: Mapped[int | None] = mapped_column(ForeignKey("projects.id"), nullable=True, index=True)
    slug: Mapped[str | None] = mapped_column(String(80), unique=True, nullable=True)
    metadata_ref: Mapped[str] = mapped_column(String(66), unique=True, index=True)  # keccak256(slug), 0x…
    onchain_id: Mapped[int | None] = mapped_column(BigInteger, unique=True, nullable=True)
    # draft = off-chain config only; otherwise mirrors the contract: Setup, Live, Suspended, SettlementOpen, Completed, Cancelled
    status: Mapped[str] = mapped_column(String(20), default="draft", index=True)
    delisted: Mapped[bool] = mapped_column(Boolean, default=False)
    token_address: Mapped[str] = mapped_column(String(42), default="")
    token_decimals: Mapped[int] = mapped_column(Integer, default=18)
    lot_size: Mapped[int] = mapped_column(Uint)
    tick_size: Mapped[int] = mapped_column(Uint)
    min_lots: Mapped[int] = mapped_column(Uint)
    max_lots: Mapped[int] = mapped_column(Uint)
    trading_start: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True))
    trading_end: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True))
    tge_date: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    settlement_opened_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    settlement_deadline: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    open_trades: Mapped[int] = mapped_column(Integer, default=0)
    created_by: Mapped[str | None] = mapped_column(String(42), nullable=True)
    activation_approved_by: Mapped[str | None] = mapped_column(String(42), nullable=True)
    activated_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)

    project: Mapped[Project | None] = relationship()


class Order(Base):
    __tablename__ = "orders"
    __table_args__ = (Index("ix_orders_book", "market_onchain_id", "side", "status", "price"),)
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=False)  # on-chain order id
    market_onchain_id: Mapped[int] = mapped_column(BigInteger, index=True)
    owner: Mapped[str] = mapped_column(String(42), index=True)
    side: Mapped[str] = mapped_column(String(4))  # buy | sell
    price: Mapped[int] = mapped_column(Uint)
    lots: Mapped[int] = mapped_column(Uint)
    filled: Mapped[int] = mapped_column(Uint, default=0)
    locked: Mapped[int] = mapped_column(Uint, default=0)
    status: Mapped[str] = mapped_column(String(12), default="Open", index=True)  # Open|Filled|Cancelled|Expired
    ioc: Mapped[bool] = mapped_column(Boolean, default=False)
    expiry: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True))
    tx_hash: Mapped[str] = mapped_column(String(66))
    block_number: Mapped[int] = mapped_column(BigInteger)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True))
    closed_tx_hash: Mapped[str | None] = mapped_column(String(66), nullable=True)


class Trade(Base):
    __tablename__ = "trades"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=False)  # on-chain trade id
    market_onchain_id: Mapped[int] = mapped_column(BigInteger, index=True)
    buy_order_id: Mapped[int] = mapped_column(BigInteger)
    sell_order_id: Mapped[int] = mapped_column(BigInteger)
    buyer: Mapped[str] = mapped_column(String(42), index=True)
    seller: Mapped[str] = mapped_column(String(42), index=True)
    lots: Mapped[int] = mapped_column(Uint)
    price: Mapped[int] = mapped_column(Uint)
    value: Mapped[int] = mapped_column(Uint)
    buyer_fee: Mapped[int] = mapped_column(Uint)
    seller_fee: Mapped[int] = mapped_column(Uint)
    status: Mapped[str] = mapped_column(String(12), default="Open", index=True)  # Open|Settled|Defaulted|Refunded
    tx_hash: Mapped[str] = mapped_column(String(66))
    block_number: Mapped[int] = mapped_column(BigInteger)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), index=True)
    closed_tx_hash: Mapped[str | None] = mapped_column(String(66), nullable=True)
    closed_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class ChainEvent(Base):
    __tablename__ = "chain_events"
    __table_args__ = (UniqueConstraint("tx_hash", "log_index", name="uq_event_tx_log"),)
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    tx_hash: Mapped[str] = mapped_column(String(66))
    log_index: Mapped[int] = mapped_column(Integer)
    block_number: Mapped[int] = mapped_column(BigInteger, index=True)
    name: Mapped[str] = mapped_column(String(40), index=True)
    args: Mapped[dict] = mapped_column(JSON)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True))


class Claimable(Base):
    """Mirror of `claimable(address)` on the contract."""

    __tablename__ = "claimable_credits"
    address: Mapped[str] = mapped_column(String(42), primary_key=True)
    amount: Mapped[int] = mapped_column(Uint, default=0)
    updated_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class IndexerState(Base):
    __tablename__ = "indexer_state"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    chain_id: Mapped[int] = mapped_column(Integer)
    contract: Mapped[str] = mapped_column(String(42))
    last_block: Mapped[int] = mapped_column(BigInteger, default=0)
    chain_head: Mapped[int] = mapped_column(BigInteger, default=0)
    updated_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


# --------------------------------------------------------------------------- support & governance


class Notification(Base):
    __tablename__ = "notifications"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    address: Mapped[str] = mapped_column(String(42), index=True)
    kind: Mapped[str] = mapped_column(String(40))
    title: Mapped[str] = mapped_column(String(200))
    body: Mapped[str] = mapped_column(Text, default="")
    link: Mapped[str] = mapped_column(String(300), default="")
    dedupe_key: Mapped[str | None] = mapped_column(String(120), nullable=True, unique=True)
    read: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class Dispute(Base):
    """Off-chain support ticket. It can never move funds."""

    __tablename__ = "disputes"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    trade_id: Mapped[int] = mapped_column(BigInteger, index=True)
    opener: Mapped[str] = mapped_column(String(42), index=True)
    reason: Mapped[str] = mapped_column(Text)
    evidence: Mapped[list] = mapped_column(JSON, default=list)
    status: Mapped[str] = mapped_column(String(16), default="Open", index=True)  # Open|In Review|Resolved|Rejected
    notes: Mapped[list] = mapped_column(JSON, default=list)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)


class AuditLog(Base):
    __tablename__ = "audit_logs"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    actor: Mapped[str] = mapped_column(String(42), index=True)
    role: Mapped[str] = mapped_column(String(32), default="")
    action: Mapped[str] = mapped_column(String(60), index=True)
    entity_type: Mapped[str] = mapped_column(String(30))
    entity_id: Mapped[str] = mapped_column(String(80))
    before: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    after: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)


class Setting(Base):
    __tablename__ = "settings"
    key: Mapped[str] = mapped_column(String(60), primary_key=True)
    value: Mapped[str] = mapped_column(Text, default="")
