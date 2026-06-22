# Persistent Postgres Control-Plane Auth

When the control plane is backed by persistent Postgres, configure stable `JWT_PRIVATE_KEY_PEM` and `JWT_PUBLIC_KEY_PEM` even in long-lived development or staging environments.

If those PEM values are omitted outside production, `TokenService` generates an in-memory RSA keypair at process start. Restarting the control plane then invalidates previously issued access tokens. Refresh tokens can recover the session only when the saved refresh token still exists in the same Postgres `refresh_tokens` table and has not been revoked or expired.

Generate a keypair once:

```bash
openssl genrsa -out jwt_private.pem 2048
openssl rsa -in jwt_private.pem -pubout -out jwt_public.pem
```

Then set:

```bash
JWT_PRIVATE_KEY_PEM="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----"
JWT_PUBLIC_KEY_PEM="-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----"
```

Stable JWT keys do not replace refresh-token rotation or the local agent's single-flight refresh lock. They reduce unnecessary refresh pressure after control-plane restarts and prevent persistent Postgres dev sessions from behaving like throwaway in-memory auth sessions.
