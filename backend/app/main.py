"""Avantdex API (FastAPI)."""

from __future__ import annotations

import logging
import threading
import time
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import func, select

from . import runtime
from .config import get_settings
from .db import SessionLocal
from .models import AdminRole
from .routers import admin, auth, public, user
from .security import ADDRESS_RE, ROLES

log = logging.getLogger("api")


def bootstrap_admins() -> None:
    """Make the database match the admins defined in the environment (idempotent, runs at every start).

    BOOTSTRAP_ADMIN_ADDRESSES -> super_admin; ADMIN_ROLES -> specific roles per wallet.
    Roles granted from the environment are tagged granted_by="env": removing a wallet/role from the environment
    removes it at the next start. Roles granted from the dashboard are never touched. The last super_admin is
    never removed, so a mistake in the environment cannot lock everyone out.
    """
    wanted = {a: roles for a, roles in get_settings().env_admin_roles.items() if ADDRESS_RE.match(a)}
    valid = set(ROLES)
    with SessionLocal() as db:
        for addr, roles in wanted.items():
            for role in roles:
                if role not in valid:
                    log.warning("ignoring unknown admin role %r for %s", role, addr)
                    continue
                if not db.scalar(select(AdminRole.id).where(AdminRole.address == addr, AdminRole.role == role)):
                    db.add(AdminRole(address=addr, role=role, granted_by="env"))
        db.flush()
        stale = [
            r
            for r in db.scalars(select(AdminRole).where(AdminRole.granted_by.in_(("env", "bootstrap"))))
            if r.role not in wanted.get(r.address, set())
        ]
        total_super = db.scalar(select(func.count(AdminRole.id)).where(AdminRole.role == "super_admin")) or 0
        stale_super = [r for r in stale if r.role == "super_admin"]
        if stale_super and total_super - len(stale_super) <= 0:
            keep = stale_super[0]  # never remove the last super_admin
            log.warning("keeping super_admin %s although it is no longer in the environment", keep.address)
            stale = [r for r in stale if r.id != keep.id]
        for r in stale:
            db.delete(r)
        db.commit()


def _migrate_forever() -> None:
    """Create/upgrade the database schema, retrying until the database is reachable.

    Runs in a background thread so the API is already serving /api/health (which reports the current error)
    instead of the whole container failing without a visible reason.
    """
    from pathlib import Path

    from alembic import command
    from alembic.config import Config

    base = Path(__file__).resolve().parents[1]
    cfg = Config(str(base / "alembic.ini"))
    cfg.set_main_option("script_location", str(base / "alembic"))
    attempt = 0
    while True:
        try:
            command.upgrade(cfg, "head")
            bootstrap_admins()
            runtime.state.update(migrated=True, error="")
            log.info("database ready, migrations applied")
            return
        except Exception as exc:
            attempt += 1
            first = (str(exc).strip().splitlines() or [type(exc).__name__])[0]
            runtime.state["error"] = runtime.mask(f"{type(exc).__name__}: {first}")[:400]
            log.error("database not ready (attempt %s): %s", attempt, runtime.state["error"])
            time.sleep(min(5 * attempt, 30))


@asynccontextmanager
async def lifespan(app: FastAPI):
    get_settings()  # fail fast on missing secrets in production
    if get_settings().env == "test":
        runtime.state.update(migrated=True, error="")  # tests migrate their own database
    else:
        threading.Thread(target=_migrate_forever, name="migrate", daemon=True).start()
    yield


def create_app() -> FastAPI:
    s = get_settings()
    app = FastAPI(title="Avantdex API", version="1.0.0", lifespan=lifespan, docs_url="/docs", openapi_url="/openapi.json")
    if s.cors_list:
        app.add_middleware(CORSMiddleware, allow_origins=s.cors_list, allow_methods=["*"], allow_headers=["*"])

    @app.exception_handler(HTTPException)
    async def http_error(_: Request, exc: HTTPException) -> JSONResponse:
        detail = exc.detail
        if not isinstance(detail, dict):
            detail = {"code": "error", "message": str(detail)}
        return JSONResponse({"error": detail}, status_code=exc.status_code)

    @app.exception_handler(RequestValidationError)
    async def validation_error(_: Request, exc: RequestValidationError) -> JSONResponse:
        fields = [{"field": ".".join(str(p) for p in e["loc"] if p != "body"), "message": e["msg"]} for e in exc.errors()]
        return JSONResponse({"error": {"code": "validation_error", "message": "Invalid request", "fields": fields}}, status_code=422)

    @app.exception_handler(Exception)
    async def unhandled(_: Request, exc: Exception) -> JSONResponse:
        log.exception("unhandled error")
        return JSONResponse({"error": {"code": "internal_error", "message": "Something went wrong"}}, status_code=500)

    app.include_router(public.router, prefix="/api")
    app.include_router(auth.router, prefix="/api")
    app.include_router(user.router, prefix="/api")
    app.include_router(admin.router, prefix="/api")
    return app


app = create_app()
