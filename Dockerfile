# syntax=docker/dockerfile:1

# ---- build stage: bun installs deps from bun.lock, vite builds the static app ----
FROM oven/bun:1.3.14 AS build
WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --ignore-scripts

COPY . .

# VITE_* values are baked into the JS bundle at build time (they are public, never put secrets here).
ARG VITE_ALLOCX_MARKETPLACE=0x1af972dc5f777088ff10a9b3fc2ee076b23e80b1
ARG VITE_ALLOCX_DEPLOY_BLOCK=69835919
ARG VITE_RPC_URL=https://rpc.testnet.arc.io
ENV VITE_ALLOCX_MARKETPLACE=$VITE_ALLOCX_MARKETPLACE \
    VITE_ALLOCX_DEPLOY_BLOCK=$VITE_ALLOCX_DEPLOY_BLOCK \
    VITE_RPC_URL=$VITE_RPC_URL

RUN bunx vite build

# ---- runtime stage: nginx serves the static files ----
FROM nginx:1.27-alpine AS runtime
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1/healthz >/dev/null || exit 1
