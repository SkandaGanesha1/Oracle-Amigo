FROM docker.io/library/node:24-bookworm-slim AS deps
WORKDIR /build
COPY package*.json ./
RUN npm ci
WORKDIR /build/apps/control-plane
COPY apps/control-plane/package*.json ./
RUN npm ci

FROM deps AS build
WORKDIR /build
COPY apps/control-plane ./apps/control-plane
COPY src ./src
COPY tests/CloudClients.test.ts ./tests/CloudClients.test.ts
WORKDIR /build/apps/control-plane
RUN npm run build \
  && cp src/db/schema.sql dist/apps/control-plane/src/db/schema.sql \
  && cp -R src/db/migrations dist/apps/control-plane/src/db/migrations

FROM docker.io/library/node:24-bookworm-slim AS prod-deps
WORKDIR /prod/apps/control-plane
COPY apps/control-plane/package*.json ./
RUN npm ci --omit=dev

FROM docker.io/library/node:24-bookworm-slim AS runtime
ENV NODE_ENV=production \
    CONTROL_PLANE_ENV=production \
    CONTROL_PLANE_HOST=0.0.0.0 \
    CONTROL_PLANE_PORT=8080 \
    CONTROL_PLANE_DB_DRIVER=postgres \
    FILE_TRANSFER_STORE=/app/data/transfers
WORKDIR /app
RUN groupadd --system oracle-amigo \
  && useradd --system --gid oracle-amigo --home-dir /app --shell /usr/sbin/nologin oracle-amigo \
  && mkdir -p /app/data/transfers \
  && chown -R oracle-amigo:oracle-amigo /app
COPY --from=prod-deps --chown=oracle-amigo:oracle-amigo /prod/apps/control-plane/node_modules ./node_modules
COPY --from=prod-deps --chown=oracle-amigo:oracle-amigo /prod/apps/control-plane/package*.json ./
COPY --from=build --chown=oracle-amigo:oracle-amigo /build/apps/control-plane/dist ./dist
USER oracle-amigo
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.CONTROL_PLANE_PORT||8080)+'/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/apps/control-plane/src/main.js"]
