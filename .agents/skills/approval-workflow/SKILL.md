---
id: approval-workflow
name: Human Approval Workflow
description: Request human approval before destructive or sharing actions via UI card or Windows notification bridge.
version: 0.1.0
tags: [approval, human-in-the-loop, governance]
examples: ["approve sharing API_Design_Final.pdf with peer agent", "reject transfer of confidential file"]
inputModes: [text/plain, application/json]
outputModes: [application/json]
---

# Human Approval Workflow

Inserts a human-approval checkpoint into an agent task.

## Flow

1. Agent requests approval with candidate action details
2. System renders a UI card on the local agent panel
3. If UI not visible, sends a Windows notification via the .NET bridge
4. User approves or rejects; response is returned to the calling task
5. Audit event is appended to the immutable audit chain

## Audit

Every approval decision is recorded with timestamp, requester DID, action summary, and outcome.
