# Oracle Amigo Podman Pilot Deploy

This deploy pack runs the control plane and Admin Portal for a small pilot with Podman Compose. It is single-node, Postgres-backed, and not a Kubernetes or enterprise HA deployment.

## Run

From repo root:

```powershell
podman machine start
podman compose -f deploy/docker-compose.pilot.yml up --build
```

Open `http://localhost:8088`.

On Linux, `podman machine start` is usually not needed. On Windows and macOS, Podman runs Linux containers inside a Podman machine VM. `podman compose` uses the configured external Compose provider; `podman-compose` is optional, not required by this repo.

## Pilot Storage

Named volumes:

- `oracle-amigo-pilot_postgres-18-data`: Postgres data at `/var/lib/postgresql/data`.
- `oracle-amigo-pilot_control-plane-transfers`: encrypted transfer objects at `/app/data/transfers`.
- `oracle-amigo-pilot_caddy-data` and `oracle-amigo-pilot_caddy-config`: Caddy state.

Back up Postgres and transfer volumes together. Do not prune Podman volumes unless data loss is acceptable.

## Postgres Volume Migration

The pilot compose file now uses the `postgres-18-data` named volume for the Postgres 18 image. Older pilot deployments used `postgres-data`. If you upgrade without migrating the old volume, Postgres starts with an empty database.

Safest upgrade path:

1. Create a SQL backup before deleting or renaming anything. If the old stack is still running before the upgrade, prefer `pg_dumpall`:

   ```powershell
   podman exec oracle-amigo-pilot-postgres-1 pg_dumpall -U $env:POSTGRES_USER > postgres-backup.sql
   ```

2. Stop the pilot stack before changing volumes:

   ```powershell
   podman compose -f deploy/docker-compose.pilot.yml down
   ```

3. Confirm both volume names. The Compose project prefix is usually `oracle-amigo-pilot_`:

   ```powershell
   podman volume ls | Select-String "oracle-amigo-pilot_postgres"
   ```

4. Copy the old named volume to the new named volume with a one-shot container:

   ```powershell
   podman volume create oracle-amigo-pilot_postgres-18-data
   podman run --rm `
     -v oracle-amigo-pilot_postgres-data:/from:ro `
     -v oracle-amigo-pilot_postgres-18-data:/to `
     docker.io/library/alpine:3.20 `
     sh -c "cd /from/data && cp -a . /to/"
   ```

5. Start the upgraded stack and verify health before removing the old volume:

   ```powershell
   podman compose -f deploy/docker-compose.pilot.yml up --build
   podman healthcheck run oracle-amigo-pilot-postgres-1
   ```

Keep `oracle-amigo-pilot_postgres-data` until the upgraded stack is verified and a fresh backup exists. Removing the old volume before migration can permanently destroy the pilot database.

## HTTP LAN Demo

The checked-in env templates run in development control-plane mode over HTTP so admin cookies work in a LAN demo:

- `CONTROL_PLANE_ENV=development`
- `CONTROL_PLANE_ALLOW_INSECURE_PUBLIC_URL=true`
- `ADMIN_COOKIE_HOST_PREFIX=false`

This is for pilot demo only.

## HTTPS Production Shape

Production must use HTTPS at the browser-facing origin and secure admin cookies:

- `NODE_ENV=production`
- `CONTROL_PLANE_ENV=production`
- `CONTROL_PLANE_PUBLIC_URL=https://admin.example.com`
- `CONTROL_PLANE_ALLOW_INSECURE_PUBLIC_URL=false`
- `ADMIN_COOKIE_HOST_PREFIX=true`
- no `DEV_ADMIN_TOKEN`
- no `ADMIN_BOOTSTRAP_TOKEN`
- strong rotated `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `ADMIN_KEK`, `TRANSFER_KEK`
- configured `JWT_PRIVATE_KEY_PEM` and `JWT_PUBLIC_KEY_PEM`

Caddy HTTPS example:

```caddyfile
admin.example.com {
	encode zstd gzip
	reverse_proxy admin-portal:3398
}
```

nginx HTTPS sketch:

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

## Health

- Control plane: `/health`, `/livez`, `/ready`
- Admin Portal: `/health`, `/livez`, `/ready`

Debug Podman healthchecks:

```powershell
podman ps
podman healthcheck run oracle-amigo-pilot-control-plane-1
podman healthcheck run oracle-amigo-pilot-admin-portal-1
```

## Enterprise Boundary

This pack is pilot-shaped only. For enterprise production, use managed Postgres or an operated Postgres cluster, tested backup/restore, HA rollout docs, incident runbooks, and Kubernetes manifests before claiming Kubernetes or HA production readiness.
