/// <reference types="vitest/globals" />
import { describe, expect, it } from "vitest";
import {
  buildTimelineMeta,
  getUnreadMessageId,
  isDeletedMessage,
  isEditedMessage,
  messageSide,
  shouldGroupWithPrevious,
} from "../components/stream-like/timelineModel";
import type { HumanChatMessage, TimelineMessage } from "../types";

function human(id: string, createdAt: string, patch: Partial<HumanChatMessage> = {}): HumanChatMessage {
  return {
    kind: "human",
    id,
    conversation_id: "conv-test",
    sender_user_id: "user-a",
    sender_agent_instance_id: "agent-a",
    receiver_agent_instance_id: "agent-b",
    direction: "incoming",
    sender_label: "Docin",
    text: id,
    created_at: createdAt,
    delivery_status: "delivered",
    origin_side: "remote",
    author_id: "user-a",
    author_kind: "user",
    author_label: "Docin",
    ...patch,
  };
}

describe("timelineModel unread state", () => {
  const messages = [
    human("m1", "2026-06-14T10:00:00.000Z"),
    human("m2", "2026-06-14T10:01:00.000Z"),
    human("m3", "2026-06-14T10:02:00.000Z"),
  ];

  it("returns the first loaded message when no read marker exists", () => {
    expect(getUnreadMessageId(messages)).toBe("m1");
  });

  it("returns null when the read marker is missing", () => {
    expect(getUnreadMessageId(messages, "missing")).toBeNull();
  });

  it("returns the message immediately after the read marker", () => {
    expect(getUnreadMessageId(messages, "m2")).toBe("m3");
    expect(getUnreadMessageId(messages, "m3")).toBeNull();
  });
});

describe("timelineModel grouping", () => {
  it("groups adjacent plain rows by author, side, day, and five-minute window", () => {
    const first = human("m1", "2026-06-14T10:00:00.000Z");
    const second = human("m2", "2026-06-14T10:05:00.000Z");

    expect(shouldGroupWithPrevious(second, first)).toBe(true);
  });

  it("does not group across author, side, day, or five-minute boundaries", () => {
    const first = human("m1", "2026-06-14T10:00:00.000Z");

    expect(shouldGroupWithPrevious(human("m2", "2026-06-14T10:06:00.001Z"), first)).toBe(false);
    expect(shouldGroupWithPrevious(human("m3", "2026-06-15T10:01:00.000Z"), first)).toBe(false);
    expect(shouldGroupWithPrevious(human("m4", "2026-06-14T10:01:00.000Z", { author_id: "user-b" }), first)).toBe(false);
    expect(shouldGroupWithPrevious(human("m5", "2026-06-14T10:01:00.000Z", { origin_side: "local", direction: "outgoing" }), first)).toBe(false);
  });

  it("does not group structured, system, thinking, reply, thread, pinned, deleted, or moderated rows", () => {
    const first = human("m1", "2026-06-14T10:00:00.000Z");
    const second = human("m2", "2026-06-14T10:01:00.000Z");
    const fileRequest: TimelineMessage = {
      kind: "file_request",
      id: "file-request",
      task_id: "task-1",
      requester: "Docin",
      target: "You",
      natural_language_request: "send file",
      query: "send file",
      status: "pending",
      created_at: "2026-06-14T10:01:00.000Z",
    };
    const systemEvent: TimelineMessage = {
      kind: "system_event",
      id: "system",
      event_type: "relay_ready",
      text: "Connected",
      severity: "success",
      created_at: "2026-06-14T10:01:00.000Z",
    };
    const thinking: TimelineMessage = {
      kind: "thinking_bar",
      id: "thinking",
      run_id: "run-1",
      task_id: "task-1",
      created_at: "2026-06-14T10:01:00.000Z",
      updated_at: "2026-06-14T10:01:00.000Z",
      sourceMessageIds: [],
      state: { isActive: true, steps: [], summary: "Thinking", progress: 10 },
    };

    expect(shouldGroupWithPrevious(fileRequest, first)).toBe(false);
    expect(shouldGroupWithPrevious(systemEvent, first)).toBe(false);
    expect(shouldGroupWithPrevious(thinking, first)).toBe(false);
    expect(shouldGroupWithPrevious({ ...second, reply_to_id: "m1" }, first)).toBe(false);
    expect(shouldGroupWithPrevious({ ...second, thread_id: "thread-1" }, first)).toBe(false);
    expect(shouldGroupWithPrevious({ ...second, thread_count: 1 }, first)).toBe(false);
    expect(shouldGroupWithPrevious({ ...second, pinned: true }, first)).toBe(false);
    expect(shouldGroupWithPrevious({ ...second, deleted_at: "2026-06-14T10:02:00.000Z" }, first)).toBe(false);
    expect(shouldGroupWithPrevious({ ...second, moderation: { state: "hidden" } }, first)).toBe(false);
  });

  it("uses date separators as grouping boundaries", () => {
    const messages = [
      human("m1", "2026-06-14T10:00:00.000Z"),
      human("m2", "2026-06-15T10:00:00.000Z"),
    ];
    const meta = buildTimelineMeta(messages);

    expect(meta.get("m1")?.showDateSeparator).toBe(true);
    expect(meta.get("m2")?.showDateSeparator).toBe(true);
    expect(meta.get("m2")?.groupedWithPrevious).toBe(false);
  });

  it("maps outgoing human messages to the right side", () => {
    expect(messageSide(human("m-out", "2026-06-14T10:00:00.000Z", {
      origin_side: "local",
      direction: "outgoing",
    }))).toBe("right");
  });

  it("maps incoming human messages to the left side", () => {
    expect(messageSide(human("m-in", "2026-06-14T10:00:00.000Z", {
      origin_side: "remote",
      direction: "incoming",
    }))).toBe("left");
  });

  it("maps system events to the center", () => {
    expect(messageSide({
      kind: "system_event",
      id: "system",
      event_type: "relay_ready",
      text: "Connected",
      severity: "success",
      created_at: "2026-06-14T10:00:00.000Z",
    })).toBe("center");
  });

  it("reports deleted and edited message state", () => {
    const deleted = human("m-deleted", "2026-06-14T10:00:00.000Z", {
      deleted_at: "2026-06-14T10:01:00.000Z",
    });
    const edited = human("m-edited", "2026-06-14T10:00:00.000Z", {
      edited_at: "2026-06-14T10:01:00.000Z",
    });

    expect(isDeletedMessage(deleted)).toBe(true);
    expect(isEditedMessage(deleted)).toBe(false);
    expect(isEditedMessage(edited)).toBe(true);
  });
});
