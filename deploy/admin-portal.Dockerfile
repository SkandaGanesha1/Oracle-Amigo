FROM docker.io/library/node:24-bookworm-slim AS server-deps
WORKDIR /build/apps/admin-portal
COPY apps/admin-portal/package*.json ./
RUN npm ci

FROM docker.io/library/node:24-bookworm-slim AS ui-deps
WORKDIR /build/ui-admin
COPY ui-admin/package*.json ./
RUN npm ci

FROM server-deps AS server-build
WORKDIR /build/apps/admin-portal
COPY apps/admin-portal ./
RUN npm run build

FROM ui-deps AS ui-build
WORKDIR /build
COPY --from=ui-deps /build/ui-admin/node_modules ./ui-admin/node_modules
COPY ui-admin ./ui-admin
COPY apps/admin-portal ./apps/admin-portal
WORKDIR /build/ui-admin
RUN npm run build

FROM docker.io/library/node:24-bookworm-slim AS prod-deps
WORKDIR /prod/apps/admin-portal
COPY apps/admin-portal/package*.json ./
RUN npm ci --omit=dev

FROM docker.io/library/node:24-bookworm-slim AS runtime
ENV NODE_ENV=production \
    ADMIN_PORTAL_HOST=0.0.0.0 \
    ADMIN_PORTAL_PORT=3398 \
    ADMIN_STATIC_ROOT=/app/public
WORKDIR /app
RUN groupadd --system oracle-amigo \
  && useradd --system --gid oracle-amigo --home-dir /app --shell /usr/sbin/nologin oracle-amigo \
  && mkdir -p /app/public \
  && chown -R oracle-amigo:oracle-amigo /app
COPY --from=prod-deps --chown=oracle-amigo:oracle-amigo /prod/apps/admin-portal/node_modules ./node_modules
COPY --from=prod-deps --chown=oracle-amigo:oracle-amigo /prod/apps/admin-portal/package*.json ./
COPY --from=server-build --chown=oracle-amigo:oracle-amigo /build/apps/admin-portal/dist ./dist
COPY --from=ui-build --chown=oracle-amigo:oracle-amigo /build/apps/admin-portal/public ./public
USER oracle-amigo
EXPOSE 3398
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.ADMIN_PORTAL_PORT||3398)+'/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/src/server.js"]
