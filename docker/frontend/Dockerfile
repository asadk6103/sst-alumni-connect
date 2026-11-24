# SST Alumni Connect — frontend images (build context: repository root)
#   target "web":   Next.js public website (service: frontend)
#   target "nginx": reverse proxy + the portal/admin single-page app (service: nginx)

FROM node:22.12.0-bookworm-slim AS spa-build
WORKDIR /src
COPY frontend/app/package.json frontend/app/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY frontend/app ./
RUN npm run build

FROM node:22.12.0-bookworm-slim AS web-build
ENV NEXT_TELEMETRY_DISABLED=1
WORKDIR /src
COPY frontend/web/package.json frontend/web/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY frontend/web ./
RUN npm run build

# ── public website (standalone Next.js server, non-root) ──
FROM node:22.12.0-bookworm-slim AS web
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
WORKDIR /app
COPY --from=web-build --chown=node:node /src/.next/standalone ./
COPY --from=web-build --chown=node:node /src/.next/static ./.next/static
COPY --from=web-build --chown=node:node /src/public ./public
USER node
EXPOSE 3000
HEALTHCHECK --interval=20s --timeout=5s --start-period=20s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:3000/').then(r=>process.exit(r.status<500?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.js"]

# ── reverse proxy with the single-page app baked in ──
FROM nginx:1.27.3-alpine AS nginx
COPY infrastructure/nginx/nginx.conf /etc/nginx/nginx.conf
COPY infrastructure/nginx/html/ /usr/share/nginx/html/
COPY --from=spa-build /src/dist /usr/share/nginx/app
RUN nginx -t
