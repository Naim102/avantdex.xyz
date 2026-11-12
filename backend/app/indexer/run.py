"""Entry point: `python -m app.indexer.run`."""

import logging

from .worker import Indexer

logging.basicConfig(
    level=logging.INFO,
    format='{"time":"%(asctime)s","level":"%(levelname)s","logger":"%(name)s","msg":"%(message)s"}',
)

if __name__ == "__main__":
    Indexer().run_forever()
