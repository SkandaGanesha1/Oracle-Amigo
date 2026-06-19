# Cloud Deployment Plan

## Pilot Target

Pilot deployment is a single-node Podman Compose stack for a small operations team:

- Control plane Fastify service on the private Compose network.
- Admin Portal Fastify adapter serving the built React SPA.
- Caddy reverse proxy as the single browser-facing entrypoint.
- Postgres DB in a named Podman volume.
- File transfer store in a separate named Podman volume.

This is not Kubernetes, HA, or enterprise production readiness.

## Exact Pilot Run Command

From repo root:

```powershell
podman machine start
podman compose -f deploy/docker-compose.pilot.yml up --build
```

Open:

```text
http://localhost:8088
```

Linux hosts usually do not need `podman machine start`. Windows and macOS use a Podman machine VM for Linux containers. `podman compose` uses the configured external Compose provider; no Docker daemon is required.

## Runtime Assets

Deployment files:

- `deploy/docker-compose.pilot.yml`
- `deploy/control-plane.Dockerfile`
- `deploy/admin-portal.Dockerfile`
- `deploy/reverse-proxy/Caddyfile`
- `deploy/env/control-plane.example.env`
- `deploy/env/admin-portal.example.env`
- `deploy/README.md`

Named volumes:

- `oracle-amigo-pilot_postgres-data`: Postgres data.
- `oracle-amigo-pilot_control-plane-transfers`: transfer payload store.
- `oracle-amigo-pilot_caddy-data`: Caddy data.
- `oracle-amigo-pilot_caddy-config`: Caddy config state.

Back up Postgres and transfer store together.

## TLS Modes

LAN demo mode uses HTTP and development cookie behavior:

- `CONTROL_PLANE_ENV=development`
- `CONTROL_PLANE_ALLOW_INSECURE_PUBLIC_URL=true`
- `ADMIN_COOKIE_HOST_PREFIX=false`

Production-shaped HTTPS mode requires:

- `NODE_ENV=production`
- `CONTROL_PLANE_ENV=production`
- `CONTROL_PLANE_PUBLIC_URL=https://admin.example.com`
- `CONTROL_PLANE_ALLOW_INSECURE_PUBLIC_URL=false`
- `ADMIN_COOKIE_HOST_PREFIX=true`
- strong rotated JWT/admin/transfer secrets
- RS256 JWT key pair
- no static admin tokens

Caddy HTTPS:

```caddyfile
admin.example.com {
	encode zstd gzip
	reverse_proxy admin-portal:3398
}
```

nginx HTTPS:

```nginx
server {
  listen 443 ssl http2;
  server_name admin.example.com;

  ssl_certificate /etc/letsencrypt/live/admin.example.com/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/admin.example.com/privkey.pem;

  location / {
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto https;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_pass http://admin-portal:3398;
  }
}
```

## Health And Readiness

Control plane:

- `/health`: service metadata.
- `/livez`: process liveness.
- `/ready`: database readiness.

Admin Portal:

- `/health`: service metadata.
- `/livez`: process liveness.
- `/ready`: control-plane upstream readiness.

## Enterprise Boundary

The checked-in stack is pilot-only. Enterprise production still needs managed Postgres or an operated Postgres cluster, HA/backup automation, secret rotation runbooks, alerting, and Kubernetes or equivalent orchestration before any production readiness claim.
