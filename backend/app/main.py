"""Avantdex API (FastAPI)."""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import select

from .config import get_settings
from .db import SessionLocal
from .models import AdminRole
from .routers import admin, auth, public, user
from .security import ADDRESS_RE

log = logging.getLogger("api")


def bootstrap_admins() -> None:
    """Grant super_admin to the wallets listed in BOOTSTRAP_ADMIN_ADDRESSES (idempotent)."""
    addrs = [a for a in get_settings().bootstrap_admins if ADDRESS_RE.match(a)]
    if not addrs:
        return
    with SessionLocal() as db:
        for a in addrs:
            if not db.scalar(select(AdminRole.id).where(AdminRole.address == a, AdminRole.role == "super_admin")):
                db.add(AdminRole(address=a, role="super_admin", granted_by="bootstrap"))
        db.commit()


@asynccontextmanager
async def lifespan(app: FastAPI):
    get_settings()  # fail fast on missing secrets in production
    try:
        bootstrap_admins()
    except Exception:  # database not migrated yet; the first request after migration will still work
        log.exception("could not bootstrap admins")
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
