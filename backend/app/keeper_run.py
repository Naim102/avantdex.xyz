"""Entry point: `python -m app.keeper_run`. Idles (and costs nothing) unless KEEPER_ENABLED=true."""

import logging
import time

from .config import get_settings

logging.basicConfig(
    level=logging.INFO,
    format='{"time":"%(asctime)s","level":"%(levelname)s","logger":"%(name)s","msg":"%(message)s"}',
)
log = logging.getLogger("keeper")

if __name__ == "__main__":
    s = get_settings()
    if not s.keeper_enabled:
        log.info("keeper is disabled (set KEEPER_ENABLED=true and KEEPER_PRIVATE_KEY to turn it on); idling")
        while True:
            time.sleep(3600)
    if not s.keeper_private_key:
        raise SystemExit("KEEPER_ENABLED is true but KEEPER_PRIVATE_KEY is empty")
    from .keeper import Keeper

    Keeper().run_forever()
