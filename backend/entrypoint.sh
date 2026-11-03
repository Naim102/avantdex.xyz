#!/bin/sh
# API container start-up: wait for the database, migrate, then serve. Errors are printed clearly in the logs.
set -u

python - <<'PY'
import os
from sqlalchemy.engine import make_url
from app.config import get_settings

u = make_url(get_settings().database_url)
print(f"[start] database: {u.drivername}://{u.username}@{u.host}:{u.port}/{u.database}", flush=True)
print(f"[start] chain {os.environ.get('CHAIN_ID', '5042002')} exchange {os.environ.get('EXCHANGE_ADDRESS', '(default)')}", flush=True)
PY

i=1
until alembic upgrade head; do
  if [ "$i" -ge 20 ]; then
    echo "[start] database migration failed after $i attempts. Check DATABASE_URL, the database host name and that this service is on the same Docker network as the database (Coolify: enable 'Connect To Predefined Network')." >&2
    exit 1
  fi
  echo "[start] database not ready (attempt $i/20), retrying in 3s..." >&2
  i=$((i + 1))
  sleep 3
done

exec uvicorn app.main:app --host 0.0.0.0 --port 8000 --proxy-headers --forwarded-allow-ips "*"
