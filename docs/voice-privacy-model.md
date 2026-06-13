# Voice Launcher Privacy Model

Oracle Amigo Quick Voice is a command surface, not a second agent runtime. The local agent remains the system of record for command interpretation, directory lookup, relay, approvals, audit, storage, and transfers.

## Defaults

- No always-listening mode.
- Microphone capture starts only after user action.
- The launcher shows a visible microphone state.
- `Esc` stops capture and closes the launcher.
- Raw audio is not persisted.
- Remote actions require a preview and confirmation.
- Voice commands cannot send local files directly.
- Remote file requests still require approval on the sender side.

## Stored Data

The local agent stores command history in `voice_commands`:

- command id
- profile/user/agent context
- transcript
- parsed JSON
- preview JSON
- command status
- conversation id and relay task id when submitted
- safe error text

It does not store raw audio. Transcripts and errors are redacted for bearer tokens, common secret prefixes, and local Windows paths before persistence.

## Sidecar Boundary

If the local agent is offline, the Tauri shell plugin can start only allowlisted commands:

- `start-local-agent-dev`
- `start-local-agent-prod`

The launcher must not expose arbitrary shell execution.
