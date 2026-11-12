# syntax=docker/dockerfile:1
#
# Serves the prebuilt static app from deploy/dist with nginx. Nothing is compiled on the server,
# so deploys take seconds and need almost no RAM (the vite build alone needs ~1.2 GB).
#
# Rebuild the static files on your own machine after changing code or VITE_* values, then commit them:
#   bun run build:static
FROM nginx:1.27-alpine

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY deploy/dist /usr/share/nginx/html

EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1/healthz >/dev/null || exit 1
