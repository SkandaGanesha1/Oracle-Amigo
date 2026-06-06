# Windows Notification Bridge

## Architecture

```
┌──────────────────┐     HTTP      ┌──────────────────────┐
│   Local Agent    │ ──────────▶   │  Notification Bridge │
│  127.0.0.1:3399  │               │  127.0.0.1:3400      │
│                  │ ◀───────────  │  (.NET 8 + WinAppSDK)│
└──────────────────┘     POST      └──────────┬───────────┘
                                              │
                                              ▼
                                    ┌──────────────────┐
                                    │  Windows Toast    │
                                    │  Notification     │
                                    └──────────────────┘
```

## Toast XML

```xml
<toast launch="approval_id=...&task_id=...">
  <visual>
    <binding template="ToastGeneric">
      <text>File request approval</text>
      <text>User requested: API design document</text>
      <text>Candidate: API_Design_v4_Final.pdf</text>
    </binding>
  </visual>
  <actions>
    <input id="feedback" type="text" placeHolderContent="Type correction feedback"/>
    <action content="Approve" arguments="action=approve&approval_id=...&candidate_id=..."/>
    <action content="Reject" arguments="action=reject&approval_id=..."/>
    <action content="Send feedback" arguments="action=feedback&approval_id=..." hint-inputId="feedback"/>
  </actions>
</toast>
```

## Callback Flow

1. Local agent sends `POST /notify` to bridge
2. Bridge shows Windows toast notification
3. User clicks Approve/Reject/Send feedback
4. Bridge handles `NotificationInvoked` event
5. Bridge POSTs to `http://127.0.0.1:3399/approvals/notification-callback`
6. Local agent validates approval_id, task_id, applies decision

## Fallback

- If bridge is unreachable → in-app approval via UI
- If `AppNotificationManager` unsupported (elevated/remote session) → bridge returns `{ supported: false }`
- Agent checks bridge health before sending notifications
- All approval logic exists in local agent; bridge is notification-only
