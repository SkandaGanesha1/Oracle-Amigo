# A2A v1 Compatibility

Oracle Amigo implements A2A v1.0.0 locally for HTTP+JSON agent cards, task messaging, task lookup, task cancellation, task listing, subscribe, and push notification configuration. The implementation is tested in `tests/A2Av1.test.ts`.

## Implemented And Tested

- Agent Card v1 uses `protocolVersion: "1.0"` and publishes `supportedInterfaces`.
- Runtime v1 Agent Card and Task payload tests assert that no `kind` discriminator is emitted.
- `POST /v1/message:send`, `GET /v1/tasks/:id`, `GET /v1/tasks`, `POST /v1/tasks/:id:cancel`, and official-style `POST /v1/tasks/:id:subscribe` are covered.
- Push notification config responses emit `taskPushNotificationConfig`.
- Legacy `pushNotificationConfig` input is accepted for backward compatibility, but v1 responses emit the official field.
- Agent Card signing canonicalizes the card payload with signatures excluded and uses JOSE protected headers with `typ: "JOSE"`.
- Extended Agent Card access requires authorization by default.
- Remote A2A route tests reject missing tokens and cross-org callers when auth verification hooks are enabled.
- Internal task states map to v1 task states such as `TASK_STATE_SUBMITTED`, `TASK_STATE_WORKING`, `TASK_STATE_INPUT_REQUIRED`, `TASK_STATE_COMPLETED`, `TASK_STATE_REJECTED`, `TASK_STATE_FAILED`, `TASK_STATE_CANCELED`, and `TASK_STATE_AUTH_REQUIRED`.

## Compatibility-Only Surfaces

- The Fastify router rewrites colon verbs internally so public A2A URLs such as `/v1/tasks/:id:subscribe` can be supported reliably.
- The compatibility subscribe URL `/v1/tasks/subscribe/:id` remains available for older local callers.
- Legacy `pushNotificationConfig` request input remains accepted to avoid breaking existing clients.
- A2A v0.3-era internal code remains in the repository for legacy local flows; it is not the external v1 contract.

## Remaining Limitations

- This is local A2A v1 compatibility, not a certification claim for every external SDK or hosted network environment.
- Production validation is still needed for end-to-end bearer, device-token, relay-token, org, caller-agent, target-agent, and capability-scope checks across deployed laptops.
- App-local relay payloads may carry product-specific fields for chat and transfer orchestration. Those fields are not A2A v1 protocol object discriminators and must not be documented as v1 `kind` fields.
- The skipped legacy two-laptop direct test remains compatibility coverage only; relay-first behavior is covered by `npm run test:e2e:relay`.
