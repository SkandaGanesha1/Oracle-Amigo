# Oracle Amigo Frontend Redesign Plan

Implementation direction:

1. Keep the chat bundle focused on a custom Oracle Amigo Stream-like shell, not Stream SDK dependencies.
2. Use the local API spine as the source of truth: auth/enrollment, cloud status, conversations, messages, relay file requests, approvals, received files, audit, and diagnostics.
3. Use prompt-kit/shadcn-style components for agentic message mechanics, reasoning/tool trace, loaders, feedback, and composer behavior.
4. Keep HeroUI for Agentic Chat primitives where it is already installed and useful; keep Flowbite-style utility patterns confined to the admin portal.
5. Replace the old light Slack-like color system with Oracle Amigo dark-first command-chat tokens.

Completed in the current pass:

- Added approval decision UI inside approval messages, including feedback, approve, reject, disabled terminal/pending states, and the exact-file warning.
- Added a right inspector with Agent card panel, Approval Center, task timeline panel, received files, diagnostics, and read-only safety policy rows.
- Added received-file open, download, and verify hash actions using explicit `/storage/files/:id/*` backend routes.
- Exposed `openUrl` and `downloadUrl` helpers in `filesApi`.
- Converted the chat color tokens toward the requested dark command-chat palette and added CSS for approval and inspector panels.
- Updated focused inventory tests to inspect the actual chat implementation file after the app was split into `App.tsx` plus `StreamLikeChat.tsx`.

Remaining larger-scope work:

- Break `StreamLikeChat.tsx` into the requested `app/`, `features/`, `components/stream-like/`, `components/agentic-ai/`, and `hooks/` folders once behavior stabilizes.
- Add full TanStack Query hooks for all client calls instead of local effect state.
- Expand auth/enrollment into dedicated route-level screens.
- Add virtualized message rendering for very large conversations.
- Broaden admin portal Flowbite usage if the project chooses that dependency directly instead of local Flowbite-style components.
- Add visual regression screenshots and route-level Playwright flows for signup, enroll, message send, file request, approval, receipt, diagnostics, and admin monitoring.
