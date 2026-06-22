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
  it("renders ConversationHeader and ChatWindow", () => {
    const source = read("ui/src/features/chat/MainChatLayout.tsx");
    expect(source).toContain("ConversationHeader");
    expect(source).toContain("ChatWindow");
    expect(source).not.toContain("RightInspectorPanel");
  });

  it("renders the global UserRail via AppShell", () => {
    const source = read("ui/src/app/AppShell.tsx");
    const providers = read("ui/src/app/AppProviders.tsx");
    expect(source).toContain("UserRail");
    expect(source).not.toContain("NavBar");
    expect(providers).toContain('from "@/components/ui/tooltip"');
    expect(providers).toContain("<TooltipProvider>");
  });

  it("keeps inspector state out of the chat header layout", () => {
    const source = read("ui/src/features/chat/MainChatLayout.tsx");
    expect(source).not.toContain("localStorage");
    expect(source).not.toContain("oa-inspector-open");
    expect(source).not.toContain("useInspectorState");
  });

  it("keeps bare /chats as the neutral chat landing route", () => {
    const source = read("ui/src/features/chat/MainChatLayout.tsx");
    expect(source).not.toContain('navigate(`/chats/${localConversationId ?? "local-agent"}`');
    expect(source).not.toContain('const localConversationId');
    expect(source).toContain("<ChatCanvas");
    expect(source).toContain("emptyState={emptyState}");
    expect(source).toContain("loadingState={loadingState}");
    expect(source).toContain("errorState={errorState}");
    expect(source).toContain('onOpenLocalAgent={isMissingConversation ? () => navigate("/chats/local-agent", { replace: true }) : undefined}');
  });
});

describe("MessageComposer", () => {
  it("has slash command support", () => {
    const main = read("ui/src/main.tsx");
    const source = read("ui/src/components/stream-like/MessageComposer.tsx");
    const styles = read("ui/src/styles.css");
    expect(main).toContain('import "@fontsource/inter/400.css"');
    expect(main).toContain('import "@fontsource/inter/500.css"');
    expect(main).toContain('import "@fontsource/inter/600.css"');
    expect(main).toContain('import "@fontsource/inter/700.css"');
    expect(source).toContain("handleKeyDown");
    expect(source).toContain("onSend");
    expect(source).toContain("aria-label");
    expect(source).toContain("Start file request");
    expect(source).toContain("Open command bar");
    expect(source).toContain("EmojiPicker");
    expect(source).toContain("Paperclip");
    expect(source).toContain("Command");
    expect(source).toContain("Smile");
    expect(source).toContain("Mic");
    expect(source).toContain("StopCircle");
    expect(source).toContain("ArrowUp");
    expect(source).toContain("oa-composer-glow-shell");
    expect(source).toContain("oa-composer-glow-layer");
    expect(source).toContain("ComposerDivider");
    expect(source).toContain("data-oa-composer-input");
    expect(styles).toContain("min-height: 152px");
    expect(styles).toContain("min-height: 204px");
    expect(styles).toContain("min-height: 148px");
    expect(styles).toContain("min-height: 200px");
    expect(styles).toContain("min-height: 64px");
    expect(styles).toContain("width: 48px");
    expect(styles).toContain("height: 48px");
    expect(styles).toContain("height: 34px");
    expect(styles).toContain("width: 2px");
    expect(styles).toContain("width: 2px");
    expect(styles).toContain("height: 40px");
    expect(styles).toContain("--font-sans: Inter");
    expect(styles).toContain("font-family: var(--font-sans)");
    expect(styles).toContain("font-size: 26px");
    expect(styles).toContain("line-height: 32px");
    expect(styles).toContain(".oa-composer-input::placeholder");
    expect(source).not.toContain("SuggestedPrompts");
    expect(source).not.toContain("DEFAULT_SUGGESTED_PROMPTS");
    expect(source).not.toContain("oa-composer-quick-actions");
    expect(source).not.toContain("Globe");
    expect(source).not.toContain("BrainCog");
    expect(source).not.toContain("FolderCode");
    expect(source).not.toContain("showSearch");
    expect(source).not.toContain("showThink");
    expect(source).not.toContain("showCanvas");
    expect(source).not.toContain("AttachmentPreview");
  });
});

describe("Chat timeline card surfaces", () => {
  it("uses the card dark surface without changing black app chrome", () => {
    const styles = read("ui/src/styles.css");

    expect(styles).toMatch(/\.oa-message-surface-card\s*\{[\s\S]*?background: #1C1C21;/);
    expect(styles).toMatch(/\.oa-approval-gradient-border \.oa-social-approval-card\s*\{[\s\S]*?background: #1C1C21;/);
    expect(styles).toMatch(/\.oa-agent-card-panel\s*\{[\s\S]*?background: #1C1C21;/);
    expect(styles).toMatch(/\.oa-connection-strip\s*\{[\s\S]*?background: #1C1C21;/);
    expect(styles).toMatch(/\.oa-user-rail\s*\{[\s\S]*?background-color: #000000;/);
    expect(styles).toMatch(/\.oa-composer-frame\s*\{[\s\S]*?background: #000000;/);
  });
});

describe("ConversationHeader", () => {
  it("renders a minimal identity and search header", () => {
    const source = read("ui/src/features/chat/ConversationHeader.tsx");
    const card = read("ui/src/features/chat/ConversationProfileCard.tsx");
    const styles = read("ui/src/styles.css");
    expect(source).toContain("oa-chat-header-search");
    expect(source).toContain("oa-open-chat-search");
    expect(source).toContain("oa-rail-presence-badge");
    expect(source).toContain("Dialog");
    expect(source).toContain("DialogTrigger");
    expect(source).toContain("DialogContent");
    expect(source).toContain("DialogTitle");
    expect(source).toContain("DialogDescription");
    expect(source).toContain("ConversationProfileCard");
    expect(source).toContain("Open ${displayTitle} profile card");
    expect(source).toContain("Oracle Amigo conversation");
    expect(source).toContain("normalizePeerPresence(conversation)");
    expect(card).toContain("OracleAvatar");
    expect(card).toContain("import { Badge } from \"@heroui/react\"");
    expect(card).toContain("DialogClose");
    expect(card).toContain("Close profile card");
    expect(card).toContain("oa-conversation-profile-close");
    expect(card).not.toContain("oa-conversation-profile-status");
    expect(card).not.toContain("max-w-sm");
    expect(card).not.toContain("h-40");
    expect(card).not.toContain("w-24");
    expect(card).not.toContain("h-24");
    expect(card).toContain("rounded-[2rem]");
    expect(card).toContain("oa-conversation-profile-card");
    expect(card).toContain("oa-conversation-profile-cover");
    expect(card).toContain("oa-conversation-profile-avatar");
    expect(card).toContain("Badge.Anchor");
    expect(card).toContain("oa-conversation-profile-avatar-anchor");
    expect(card).toContain("size=\"md\"");
    expect(card).not.toContain("size=\"lg\"");
    expect(card).toContain("placement=\"bottom-right\"");
    expect(card).toContain("oa-conversation-profile-avatar-image");
    expect(card).toContain("oa-conversation-profile-presence");
    expect(card).toContain("Active");
    expect(card).toContain("local time");
    expect(card).toContain("emailOrDetail");
    expect(card).toContain("Documents");
    expect(card).toContain("Media");
    expect(card).toContain("Links");
    expect(styles).toContain(".oa-conversation-profile-dialog");
    expect(styles).toContain("left: 50% !important");
    expect(styles).toContain("top: 50% !important");
    expect(styles).toContain("transform: translate(-50%, -50%) !important");
    expect(styles).toContain(".oa-conversation-profile-presence");
    expect(styles).toContain("width: 36.625rem !important");
    expect(styles).toContain("max-width: calc(100vw - 16px) !important");
    expect(styles).toContain("min-height: 50.375rem");
    expect(styles).toContain("height: 15.25rem");
    expect(styles).toContain("--oa-conversation-profile-avatar-size: 5rem");
    expect(styles).toContain("width: var(--oa-conversation-profile-avatar-size)");
    expect(styles).toContain("height: var(--oa-conversation-profile-avatar-size)");
    expect(styles).toContain("border: 4px solid #151515");
    expect(styles).toContain(".oa-conversation-profile-avatar-anchor");
    expect(styles).toContain(".oa-conversation-profile-avatar-anchor > .oa-conversation-profile-presence.badge--bottom-right");
    expect(styles).toContain("position: absolute !important");
    expect(styles).toContain("top: auto !important");
    expect(styles).toContain("width: 16px !important");
    expect(styles).toContain("height: 16px !important");
    expect(styles).toContain("right: 4px");
    expect(styles).toContain("bottom: 4px");
    expect(styles).toContain("left: auto !important");
    expect(styles).toContain("transform: none !important");
    expect(styles).toContain(".oa-conversation-profile-meta");
    expect(styles).toContain(".oa-conversation-profile-actions");
    expect(styles).not.toContain(".oa-conversation-profile-status");
    expect(styles).toContain(".oa-conversation-profile-close");
    expect(styles).not.toContain("left: 0.15rem");
    expect(source).not.toContain("PopoverContent");
    expect(source).not.toContain("presence.label");
    expect(source).not.toContain("oa-chat-header-toolbar");
    expect(source).not.toContain("oa-chat-header-subline");
    expect(source).not.toContain("oa-open-pinned-messages");
    expect(source).not.toContain("oa-open-chat-activity");
    expect(source).not.toContain("oa-open-security-context");
    expect(source).not.toContain("oa-open-chat-actions");
    expect(source).not.toContain("onToggleInspector");
    expect(source).not.toContain("aria-controls=\"right-inspector-panel\"");
    expect(card).not.toContain("Follow");
    expect(card).not.toContain("Following");
    expect(card).not.toContain("Likes");
    expect(card).not.toContain("Posts");
    expect(card).not.toContain("Views");
    expect(card).not.toContain("Instagram");
    expect(card).not.toContain("Twitter");
    expect(card).not.toContain("Threads");
    expect(card).not.toContain("exp.");
  });

  it("uses bundled Inter for chat header and message typography without Google Fonts", () => {
    const main = read("ui/src/main.tsx");
    const styles = read("ui/src/styles.css");
    const uiIndex = read("ui/index.html");
    const publicIndex = read("public/index.html");
    const checked = [main, styles, uiIndex, publicIndex].join("\n");

    expect(main).toContain('import "@fontsource/inter/400.css"');
    expect(main).toContain('import "@fontsource/inter/500.css"');
    expect(main).toContain('import "@fontsource/inter/600.css"');
    expect(main).toContain('import "@fontsource/inter/700.css"');
    expect(checked).not.toContain("fonts.googleapis.com");
    expect(checked).not.toContain("fonts.gstatic.com");
    expect(checked).not.toContain("@import url(");
    expect(styles).toContain("--font-sans: Inter");
    expect(styles).toContain(".oa-chat-header");
    expect(styles).toContain(".oa-chat-header-identity");
    expect(styles).toContain(".oa-chat-header-search input");
    expect(styles).toContain(".oa-message-author");
    expect(styles).toContain("font-size: 19px");
    expect(styles).toContain("line-height: 19px");
    expect(styles).toContain(".oa-message-time");
    expect(styles).toContain("font-size: 14px");
    expect(styles).toContain("line-height: 16px");
    expect(styles).toContain(".oa-message-surface-text");
    expect(styles).toContain(".rich-message");
    expect(styles).toContain("font-size: 22px");
    expect(styles).toContain("line-height: 33px");
    expect(styles).toContain(".oa-rail-tooltip");
    expect(styles).toContain(".oa-rail-tooltip-label");
    expect(styles).toContain(".oa-rail-tooltip-user");
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
  it("keeps the routed shell free of the top header while the rail logo opens chats", () => {
    const source = read("ui/src/app/NavBar.tsx");
    const shell = read("ui/src/app/AppShell.tsx");
    const rail = read("ui/src/app/UserRail.tsx");
    expect(shell).not.toContain("NavBar");
    expect(source).not.toContain('id: "chats"');
    expect(source).not.toContain('label: "Chats"');
    expect(source).not.toContain("MessageSquareText");
    expect(rail).toContain('label="Oracle Amigo"');
    expect(rail).toContain('navigate("/chats")');
    expect(rail).toContain('active={location.pathname === "/chats"}');
  });
});

describe("UserRail", () => {
  it("renders inbox, directory search, local agent, and user avatars", () => {
    const source = read("ui/src/app/UserRail.tsx");
    const model = read("ui/src/app/userRailModel.ts");
    const avatar = read("ui/src/components/primitives/OracleAvatar.tsx");
    const css = read("ui/src/styles.css");
    const hooks = read("ui/src/hooks/queries.ts");
    const profileDialog = read("ui/src/app/AccountProfileDialog.tsx");
    expect(source).toContain("Search directory");
    expect(source).toContain("Inbox");
    expect(source).toContain("StatusAvatar");
    expect(source).toContain('from "@/components/ui/tooltip"');
    expect(source).toContain("<Tooltip>");
    expect(source).toContain("<TooltipTrigger asChild>");
    expect(source).toContain('<TooltipContent side="right" sideOffset={10}');
    expect(source).toContain("RailLabelTooltip");
    expect(source).toContain("RailUserTooltip");
    expect(source).toContain("detail={user.email ?? user.presence.label}");
    expect(source).toContain("detail={cloudStatus?.cloud?.userEmail ?? presence.label}");
    expect(source).not.toContain("title={label}");
    expect(source).not.toContain("title={`${user.displayName} - ${user.presence.label}`}");
    expect(source).toContain("../../../UI_images/oracle_logo.png");
    expect(source).toContain("alt=\"Oracle\"");
    expect(source).not.toContain("<Bot");
    expect(source).not.toContain("<Bot");
    expect(source).toContain("from \"@heroui/react\"");
    expect(source).toContain("Popover");
    expect(source).toContain("PopoverTrigger");
    expect(source).toContain("PopoverContent");
    expect(source).not.toContain("DropdownMenu");
    expect(source).not.toContain("open={popoverOpen ? false : undefined}");
    expect(source).toContain("{!popoverOpen && (");
    expect(source).toContain("AccountProfileDialog");
    expect(profileDialog).toContain("<ProfileDetails");
    expect(profileDialog).toContain("useState");
    expect(profileDialog).toContain("readSelectedImage");
    expect(profileDialog).toContain("BIO_MAX_LENGTH");
    expect(profileDialog).toContain("coverImage");
    expect(profileDialog).toContain("avatarImage");
    expect(profileDialog).toContain("Biography");
    expect(profileDialog).toContain("Save changes");
    expect(profileDialog).toContain("Cancel");
    expect(profileDialog).toContain("aria-label=\"Account profile dialog\"");
    expect(profileDialog).toContain("aria-label=\"Upload profile cover image\"");
    expect(profileDialog).toContain("aria-label=\"Upload profile avatar image\"");
    expect(profileDialog).not.toContain("Website");
    expect(profileDialog).not.toContain("website");
    expect(profileDialog).not.toContain("First name");
    expect(profileDialog).not.toContain("Last name");
    expect(profileDialog).not.toContain("Username");
    expect(source).toContain("oa-account-popover");
    expect(source).toContain("oa-account-popover-header");
    expect(source).toContain("oa-account-popover-avatar");
    expect(source).toContain("oa-account-popover-body");
    expect(source).toContain("oa-account-popover-footer");
    expect(source).toContain("oa-account-popover-signout");
    expect(source).toContain("accountDetail");
    expect(css).toContain(".oa-profile-dialog");
    expect(css).toContain("left: 50% !important");
    expect(css).toContain("top: 50% !important");
    expect(css).toContain("transform: translate(-50%, -50%) !important");
    expect(css).toContain("[data-slot=\"dialog-overlay\"]");
    expect(css).toContain("z-index: 130 !important");
    expect(css).toContain(".oa-profile-dialog-cover");
    expect(css).toContain(".oa-profile-dialog-avatar");
    expect(css).toContain(".oa-profile-dialog-bio");
    expect(css).toContain(".oa-account-popover");
    expect(css).toContain(".oa-account-popover-header");
    expect(css).toContain(".oa-account-popover-signout");
    expect(source).toContain("w-[15.5rem]");
    expect(css).toContain("background: #171717");
    expect(css).toContain("backdrop-filter: none");
    expect(source).toContain("id=\"profile\"");
    expect(source).toContain("id=\"settings\"");
    expect(source).toContain("id=\"logout\"");
    expect(source).not.toContain("id=\"agents\"");
    expect(source).not.toContain("id=\"approvals\"");
    expect(source).not.toContain("id=\"files\"");
    expect(source).not.toContain("id=\"tasks\"");
    expect(source).not.toContain("id=\"audit\"");
    const expectedMenuOrder = ["profile", "settings", "logout"];
    for (let index = 0; index < expectedMenuOrder.length - 1; index += 1) {
      expect(source.indexOf(`id="${expectedMenuOrder[index]}"`)).toBeLessThan(source.indexOf(`id="${expectedMenuOrder[index + 1]}"`));
    }
    expect(source).toContain('navigate("/settings")');
    expect(source).not.toContain("closeAndNavigate");
    expect(profileDialog).toContain("<DialogContent");
    expect(profileDialog).toContain("<DialogTitle");
    expect(profileDialog).toContain("<DialogDescription");
    expect(profileDialog).toContain("className=\"oa-profile-dialog p-0\"");
    expect(source.indexOf("<AccountProfileDialog")).toBeLessThan(source.indexOf("function RailProfileButton"));
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
  it("renders readable tab buttons with HeroUI Button components", () => {
    const source = read("ui/src/features/inspector/RightInspectorPanel.tsx");
    expect(source).toContain('variant="ghost"');
    expect(source).toContain("@heroui/react");
    expect(source).toContain("inspectorTabs");
    expect(source).toContain("<button");
    expect(source).toContain("role=\"tablist\"");
    expect(source).toContain("role=\"tab\"");
    expect(source).toContain("oa-inspector-tab");
    expect(source).not.toContain("showMore");
  });
});
