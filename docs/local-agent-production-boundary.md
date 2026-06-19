# Local Agent Production Boundary

This document defines what the local agent may store on the endpoint and which values must be treated as secrets.

## Local Data Layout

Windows packaged builds should converge on:

```text
%LOCALAPPDATA%/OracleAmigo/profiles/<profile>/
  agent.db
  storage/
  logs/
  config.json
```

Current developer builds still have legacy paths such as `%LOCALAPPDATA%/AgenticApp/` and `.agentic-app/`; those remain migration inputs, not the final packaging contract.

## Metadata vs Secrets

SQLite may store local metadata such as profile ID, control-plane URL, org/user IDs, agent instance IDs, relay inbox URL, status, timestamps, and `secret://...` references.

These values must be stored through `SecretStore`:

- User access token
- User refresh token
- Legacy refresh token
- Device access token
- Device refresh token
- New local identity private keys

Existing raw SQLite token columns and filesystem PEM private keys are readable for migration compatibility. New writes should use `SecretStore` where possible.

## SecretStore Modes

`SECRET_STORE` supports:

- `auto`: development uses the file store; production chooses the platform store where available.
- `file`: development-only file-backed store.
- `windows`: placeholder for Windows Credential Manager or DPAPI-backed storage.
- `mac-keychain`: placeholder for macOS Keychain-backed storage.

`LOCAL_AGENT_SECRET_STORAGE` is a deprecated alias and should not be used in new docs or installer manifests.

## Production Rules

Production rejects `SECRET_STORE=file` unless `ALLOW_UNSAFE_FILE_SECRET_STORE=true` is set for a controlled lab. This override is not acceptable for broad release.

The Windows implementation task is to store profile-scoped secrets in Windows Credential Manager or a DPAPI-protected local vault with per-user protection, deterministic lookup names, deletion support, and no plaintext values in logs.

The macOS implementation task is to store profile-scoped secrets in Keychain with per-user access control, deterministic lookup names, deletion support, and no plaintext values in logs.

## Logging

Logs may include secret names and `secret://...` references only when needed for diagnostics. Logs must never include token values, private key PEM content, refresh tokens, or derived bearer strings.
