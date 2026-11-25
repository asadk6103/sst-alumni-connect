# SST Alumni Connect — frontend image (build context: repository root)
#   target "nginx": reverse proxy + the portal/admin single-page app (service: nginx)

FROM node:22.12.0-bookworm-slim AS spa-build
WORKDIR /src
COPY frontend/app/package.json frontend/app/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY frontend/app ./
RUN npm run build

# ── reverse proxy with the single-page app baked in ──
FROM nginx:1.27.3-alpine AS nginx
COPY infrastructure/nginx/nginx.conf /etc/nginx/nginx.conf
COPY infrastructure/nginx/html/ /usr/share/nginx/html/
COPY --from=spa-build /src/dist /usr/share/nginx/app
RUN nginx -t
