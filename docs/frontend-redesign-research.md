# Oracle Amigo Frontend Redesign Research

Sources checked on 2026-06-09:

- Prompt-kit component docs for chat container, message, prompt input, file upload, reasoning, tool, steps, feedback, source, and code block patterns: https://www.prompt-kit.com/
- HeroUI React component docs for accessible primitives such as Button, Card, Tabs, Avatar, Badge, Progress, Modal, Tooltip, Table, and related enterprise controls: https://heroui.com/
- Flowbite React and Flowbite docs for admin-oriented sidebar, table, badge, modal, toast, pagination, and utility dashboard patterns: https://flowbite-react.com/docs/components/modal and https://flowbite.com/docs/components/sidebar/
- Stream Chat React SDK docs for channel, message list, composer, unread/date separators, and component override concepts: https://getstream.io/chat/docs/sdk/react/components/core-components/message_list/ and https://getstream.io/chat/docs/sdk/react/components/core-components/channel/

Findings:

- Stream Chat's React SDK gives the right mental model for a modern messaging surface: channel list, active channel header, scrollable message list, composer, attachment previews, date separators, unread state, notifications, and thread/detail panels. It should remain reference-only because its components consume Stream SDK channel state and require Stream API usage.
- Oracle Amigo needs custom Stream-like components because its state comes from local APIs such as `/chat/conversations`, `/chat/conversations/:id/messages`, `/relay/send-file-request`, `/approvals/:id/*`, `/storage/files`, `/audit/events`, and `/cloud/status`.
- Prompt-kit/shadcn-style AI components map well to the chat body: message shells, prompt input, reasoning/tool traces, activity loaders, feedback affordances, source/file cards, and code/terminal displays. The current implementation uses local equivalents and prompt-kit loader/chain components already installed under `components/ui`.
- HeroUI is suitable for Agentic Chat primitives where a reusable accessible component exists. The current app already uses `@heroui/react` for avatar primitives and keeps chat-specific surfaces local to avoid duplicate card/button systems.
- Flowbite is better scoped to the admin portal, where table, sidebar, modal, breadcrumb, badge, and dashboard utility patterns fit operator workflows. The admin UI remains separate from the chat bundle.
- The product UI should be dark-first, dense, and audit-aware: status chips must not rely on color alone, approval cards need strong warnings and disabled terminal states, and received-file actions must route to explicit backend endpoints instead of placeholder buttons.
