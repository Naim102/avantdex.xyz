#!/bin/sh
# API container start-up. The schema is migrated by the app itself in the background (see app/main.py), so the
# server is reachable immediately and /api/health reports a database problem instead of the container dying.
set -u

python - <<'PY'
import os
from sqlalchemy.engine import make_url
from app.config import get_settings

u = make_url(get_settings().database_url)
print(f"[start] database: {u.drivername}://{u.username}@{u.host}:{u.port}/{u.database}", flush=True)
print(f"[start] chain {os.environ.get('CHAIN_ID', '5042002')} exchange {os.environ.get('EXCHANGE_ADDRESS', '(default)')}", flush=True)
PY

exec uvicorn app.main:app --host 0.0.0.0 --port 8000 --proxy-headers --forwarded-allow-ips "*"
