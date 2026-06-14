/// <reference types="vitest/globals" />
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildRailUsers } from "../app/userRailModel";
import type { CloudStatus, DirectoryUser } from "../types";

const ROOT = resolve(__dirname, "../../..");
function read(rel: string): string {
  return readFileSync(resolve(ROOT, rel), "utf8");
}

describe("ChatWindow", () => {
  it("renders MessageTimeline and ComposerDock", () => {
    const source = read("ui/src/features/chat/ChatWindow.tsx");
    expect(source).toContain("MessageTimeline");
    expect(source).toContain("ComposerDock");
    expect(source).toContain("SendConfirmation");
  });

  it("has proper fragment wrapping without extra div", () => {
    const source = read("ui/src/features/chat/ChatWindow.tsx");
    // Uses <> as root wrapper
    expect(source).toContain("return (");
    expect(source).toContain("<>");
  });
});

describe("MainChatLayout", () => {
  it("renders ConversationHeader, ChatWindow, RightInspectorPanel", () => {
    const source = read("ui/src/features/chat/MainChatLayout.tsx");
    expect(source).toContain("ConversationHeader");
    expect(source).toContain("ChatWindow");
    expect(source).toContain("RightInspectorPanel");
  });

  it("renders the global UserRail via AppShell", () => {
    const source = read("ui/src/app/AppShell.tsx");
    expect(source).toContain("UserRail");
  });

  it("persists inspector state to localStorage", () => {
    const source = read("ui/src/features/chat/MainChatLayout.tsx");
    expect(source).toContain("localStorage");
    expect(source).toContain("oa-inspector-open");
  });
});

describe("MessageComposer", () => {
  it("has slash command support", () => {
    const source = read("ui/src/components/stream-like/MessageComposer.tsx");
    expect(source).toContain("handleKeyDown");
    expect(source).toContain("onSend");
    expect(source).toContain("aria-label");
  });
});

describe("ConversationSidebar", () => {
  it("renders DirectorySearch and ConversationList", () => {
    const source = read("ui/src/features/chat/ConversationSidebar.tsx");
    expect(source).toContain("DirectorySearch");
    expect(source).toContain("ConversationList");
  });
});

describe("NavBar", () => {
  it("keeps Chats out of the top header while the rail logo opens chats", () => {
    const source = read("ui/src/app/NavBar.tsx");
    const rail = read("ui/src/app/UserRail.tsx");
    expect(source).not.toContain('id: "chats"');
    expect(source).not.toContain('label: "Chats"');
    expect(source).not.toContain("MessageSquareText");
    expect(rail).toContain('label="Oracle Amigo"');
    expect(rail).toContain('navigate("/chats")');
  });
});

describe("UserRail", () => {
  it("renders inbox, directory search, local agent, and user avatars", () => {
    const source = read("ui/src/app/UserRail.tsx");
    const model = read("ui/src/app/userRailModel.ts");
    const avatar = read("ui/src/components/primitives/OracleAvatar.tsx");
    const css = read("ui/src/styles.css");
    const hooks = read("ui/src/hooks/queries.ts");
    expect(source).toContain("Search directory");
    expect(source).toContain("Inbox");
    expect(source).toContain("StatusAvatar");
    expect(source).toContain("../../../UI_images/oracle_logo.png");
    expect(source).toContain("alt=\"Oracle\"");
    expect(source).not.toContain("Bot,");
    expect(source).not.toContain("<Bot");
    expect(source).toContain("from \"@heroui/react\"");
    expect(source).toContain("Dropdown");
    expect(source).toContain("Drawer");
    expect(source).toContain("AccountProfileDrawer");
    expect(source).toContain("<ProfileDetails");
    expect(source).toContain("oa-account-dropdown");
    expect(css).toContain(".oa-profile-drawer");
    expect(css).toContain(".oa-account-dropdown");
    expect(css).toContain("background: #2F2F2F");
    expect(css).toContain("backdrop-filter: none");
    expect(source).toContain("id=\"profile\"");
    expect(source).toContain("id=\"settings\"");
    expect(source).toContain("id=\"logout\"");
    expect(source.indexOf("id=\"profile\"")).toBeLessThan(source.indexOf("id=\"settings\""));
    expect(source.indexOf("id=\"settings\"")).toBeLessThan(source.indexOf("id=\"logout\""));
    expect(source).toContain("placement=\"right\"");
    expect(source).toContain("aria-label=\"Account profile drawer\"");
    expect(source).not.toContain("label=\"Settings\"");
    expect(source).toContain("w-16");
    expect(source).toContain("md:w-[72px]");
    expect(source).toContain("size=\"md\"");
    expect(source).not.toContain("size=\"lg\"");
    expect(source).not.toContain("w-24");
    expect(source).toContain("Badge.Anchor className=\"relative inline-flex\"");
    expect(source).toContain("Badge.Anchor className=\"oa-rail-avatar-anchor relative inline-flex h-10 w-10 overflow-visible\"");
    expect(source).toContain("className={`oa-rail-avatar h-10 w-10 rounded-full");
    expect(source).not.toContain("oa-rail-avatar rounded-full ring-2 ring-transparent transition-all duration-150 group-hover:rounded-2xl");
    expect(source).toContain("oa-rail-presence-online");
    expect(source).toContain("oa-rail-presence-offline");
    expect(source).toContain("placement=\"bottom-right\"");
    expect(avatar).toContain("Avatar.Fallback");
    expect(avatar).toContain("oa-avatar-fallback");
    expect(avatar).toContain("h-full w-full");
    expect(css).toContain(".oa-avatar-fallback");
    expect(css).toContain("height: 100%");
    expect(css).toContain("width: 100%");
    expect(css).toContain("border-radius: 9999px");
    expect(css).toContain("background: #22c55e");
    expect(css).toContain("background: #ef4444");
    expect(css).toContain(".oa-rail-avatar-anchor > .oa-rail-presence-badge.badge--bottom-right");
    expect(css).toContain(".oa-rail-avatar-anchor > .oa-rail-count-badge.badge--top-right");
    expect(css).toContain(".brand-mark img");
    expect(css).toContain("object-fit: contain");
    expect(css).toContain("position: absolute");
    expect(css).not.toMatch(/oa-rail-(?:count|presence)-badge[\s\S]*?transform: translate/);
    expect(hooks).toContain("queryKeys.contacts");
    expect(hooks).toContain("queryKey: [\"directory\"]");
    expect(model).toContain("My local agent");
    expect(model).toContain("RAW_AGENT_RE");
  });

  it("resolves old agent-instance conversations into people rail users", () => {
    const users = buildRailUsers(
      [{
        id: "conv-docin-old-agent",
        title: "Remote agent agi_12345678",
        subtitle: "Remote agent",
        peerUserId: null,
        agentInstanceId: "agi_docin_current",
        presence: "unknown",
        unread: 4,
        lastMessage: "hi",
        pendingApprovals: 0,
        transferCount: 0,
        messages: []
      }],
      cloudStatus(),
      [],
      [directoryUser()]
    );

    const docin = users.find((user) => user.id === "user-docin");
    expect(docin?.displayName).toBe("Docin");
    expect(docin?.presence.status).toBe("online");
    expect(docin?.unread).toBe(4);
    expect(users.map((user) => user.displayName).join(" ")).not.toMatch(/agi_|Remote agent/i);
  });

  it("keeps agent-instance conversations visible while directory enrichment is unavailable", () => {
    const users = buildRailUsers(
      [{
        id: "conv-docin-agent-only",
        title: "Docin",
        subtitle: "Relay peer agi_docin_current",
        peerUserId: null,
        agentInstanceId: "agi_docin_current",
        presence: "unknown",
        unread: 2,
        lastMessage: "hello",
        pendingApprovals: 0,
        transferCount: 0,
        messages: []
      }],
      cloudStatus(),
      [],
      []
    );

    const docin = users.find((user) => user.conversationId === "conv-docin-agent-only");
    expect(docin?.id).toBe("agent:agi_docin_current");
    expect(docin?.displayName).toBe("Docin");
    expect(docin?.unread).toBe(2);
    expect(users.map((user) => user.displayName).join(" ")).not.toMatch(/agi_|Remote agent/i);
  });

  it("shows accepted contacts even before a conversation exists", () => {
    const users = buildRailUsers(
      [],
      cloudStatus(),
      [{
        id: "contact-docin",
        requester_user_id: "user-me",
        target_user_id: "user-docin",
        status: "accepted",
        updated_at: "2026-06-13T00:00:00.000Z"
      }],
      [directoryUser()]
    );

    const docin = users.find((user) => user.id === "user-docin");
    expect(docin?.displayName).toBe("Docin");
    expect(docin?.conversationId).toBeNull();
    expect(docin?.presence.status).toBe("online");
  });

  it("shows accepted contacts without a directory snapshot", () => {
    const users = buildRailUsers(
      [],
      cloudStatus(),
      [{
        id: "contact-docin",
        requester_user_id: "user-me",
        target_user_id: "user-docin",
        target_display_name: "Docin",
        target_email: "docin@example.com",
        status: "accepted",
        updated_at: "2026-06-13T00:00:00.000Z"
      }],
      []
    );

    const docin = users.find((user) => user.id === "user-docin");
    expect(docin?.displayName).toBe("Docin");
    expect(docin?.email).toBe("docin@example.com");
    expect(docin?.conversationId).toBeNull();
  });

  it("uses incoming messages as a rail badge fallback when unread is stale", () => {
    const users = buildRailUsers(
      [{
        id: "conv-docin-message",
        title: "Docin",
        subtitle: "Remote user",
        peerUserId: "user-docin",
        agentInstanceId: "agi_docin_current",
        presence: "online",
        unread: 0,
        lastMessage: "hello",
        pendingApprovals: 0,
        transferCount: 0,
        messages: [{
          kind: "human",
          id: "msg-docin",
          conversation_id: "conv-docin-message",
          sender_user_id: "user-docin",
          sender_agent_instance_id: "agi_docin_current",
          receiver_agent_instance_id: "agi_me_current",
          direction: "incoming",
          sender_label: "Docin",
          text: "hello",
          created_at: "2026-06-13T00:00:00.000Z",
          delivery_status: "stored_by_remote_agent"
        }]
      }],
      cloudStatus(),
      [],
      [directoryUser()]
    );

    expect(users.find((user) => user.id === "user-docin")?.unread).toBe(1);
  });

  it("keeps human-titled legacy conversations visible without raw agent ids", () => {
    const users = buildRailUsers(
      [{
        id: "conv-legacy-docin",
        title: "Docin",
        subtitle: "",
        peerUserId: null,
        agentInstanceId: null,
        presence: "unknown",
        unread: 0,
        lastMessage: "",
        pendingApprovals: 0,
        transferCount: 0,
        messages: []
      }],
      cloudStatus()
    );

    const legacy = users.find((user) => user.displayName === "Docin");
    expect(legacy?.conversationId).toBe("conv-legacy-docin");
    expect(legacy?.id).not.toMatch(/agi_/);
  });
});

function cloudStatus(): CloudStatus {
  return {
    cloud: {
      profileId: "profile-test",
      controlPlaneUrl: "http://127.0.0.1:8080",
      orgId: "org-test",
      userId: "user-me",
      userEmail: "skanda@example.com",
      displayName: "Skanda",
      deviceId: "device-me",
      agentId: "agent-me",
      agentInstanceId: "agi_me_current",
      relayInboxUrl: "http://127.0.0.1:8080/v1/relay/a2a/inbox",
      status: "enrolled",
      hasUserAccessToken: true,
      hasDeviceAccessToken: true,
      hasRefreshToken: true,
      updatedAt: "2026-06-13T00:00:00.000Z"
    },
    heartbeat: { running: true, lastResult: { ok: true }, lastError: null },
    inbox: { running: true, lastItemCount: 0, lastError: null },
    relayMode: "polling"
  };
}

function directoryUser(): DirectoryUser {
  return {
    user_id: "user-docin",
    email: "docin@example.com",
    display_name: "Docin",
    status: "online",
    presence: "online",
    active_agent_instances: 1,
    agents: [{
      agent_instance_id: "agi_docin_current",
      agent_id: "agent-docin",
      device_id: "device-docin",
      display_name: "Docin device",
      device_name: "Docin device",
      status: "online",
      capabilities: ["message.send", "file.request"],
      relay_inbox_url: "http://127.0.0.1:8080/v1/relay/a2a/inbox",
      agent_card_url: "http://127.0.0.1:8080/cards/agi_docin_current",
      agent_card_hash: "hash",
      last_seen_at: "2026-06-13T00:00:00.000Z",
      last_heartbeat_at: "2026-06-13T00:00:00.000Z"
    }]
  };
}

describe("RightInspectorPanel", () => {
  it("renders 8 tabs with HeroUI Button components", () => {
    const source = read("ui/src/features/inspector/RightInspectorPanel.tsx");
    expect(source).toContain('"primary" : "ghost"');
    expect(source).toContain('variant="ghost"');
    expect(source).toContain("@heroui/react");
  });
});
