# syntax=docker/dockerfile:1
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1
WORKDIR /app

COPY requirements.txt .
RUN pip install -r requirements.txt

COPY alembic.ini .
COPY alembic ./alembic
COPY app ./app
COPY entrypoint.sh .
RUN chmod +x /app/entrypoint.sh

RUN useradd --system --uid 10001 avantdex
USER avantdex

EXPOSE 8000
# Default: the API. The indexer runs from the same image with `python -m app.indexer.run`.
CMD ["/app/entrypoint.sh"]
