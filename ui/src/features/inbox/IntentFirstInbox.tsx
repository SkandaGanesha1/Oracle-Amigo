import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { InboxBucketRail } from "../../components/inbox/InboxBucketRail";
import { InboxDetailPanel } from "../../components/inbox/InboxDetailPanel";
import { InboxEmptyState } from "../../components/inbox/InboxEmptyState";
import { InboxItemList } from "../../components/inbox/InboxItemList";
import { InboxShell } from "../../components/inbox/InboxShell";
import { InboxToolbar } from "../../components/inbox/InboxToolbar";
import { useInboxItemAction, useInboxItems } from "../../hooks/queries";
import type { InboxActionId, InboxBucket, InboxItem } from "../../api/types";
import type { InboxServerAction } from "../../api/inboxApi";
import { AnimatePresence } from "../../components/primitives/MotionPrimitives";

const DEFAULT_BUCKET: InboxBucket = "needs_my_approval";
const SERVER_ACTIONS = new Set<InboxActionId>(["approve", "deny", "ask_why", "snooze", "archive"]);

export function IntentFirstInbox() {
  const navigate = useNavigate();
  const [bucket, setBucket] = useState<InboxBucket>(DEFAULT_BUCKET);
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [privacyMode, setPrivacyMode] = useState(() => window.localStorage.getItem("oa-privacy-mode") === "true");
  const searchRef = useRef<HTMLInputElement>(null);
  const params = useMemo(() => ({ bucket, q: query, limit: 50 }), [bucket, query]);
  const itemsQuery = useInboxItems(params);
  const inboxAction = useInboxItemAction();
  const items = itemsQuery.data?.items ?? [];
  const counts = itemsQuery.data?.counts ?? emptyCounts();
  const selectedItem = items.find((item) => item.id === selectedId) ?? items[0] ?? null;

  useEffect(() => {
    window.localStorage.setItem("oa-privacy-mode", String(privacyMode));
  }, [privacyMode]);

  useEffect(() => {
    if (selectedItem && selectedItem.id !== selectedId) setSelectedId(selectedItem.id);
    if (!selectedItem && selectedId) setSelectedId(null);
  }, [selectedId, selectedItem]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const editing = target?.tagName === "INPUT" || target?.tagName === "TEXTAREA" || target?.isContentEditable;
      if (event.key === "/" && !editing) {
        event.preventDefault();
        searchRef.current?.focus();
        return;
      }
      if (editing && event.key !== "Escape") return;
      if (event.key === "Escape") {
        if (query) {
          event.preventDefault();
          setQuery("");
        }
        return;
      }
      if (!selectedItem) return;
      if (event.key === "j" || event.key === "k") {
        event.preventDefault();
        const current = items.findIndex((item) => item.id === selectedItem.id);
        const next = event.key === "j" ? Math.min(items.length - 1, current + 1) : Math.max(0, current - 1);
        setSelectedId(items[next]?.id ?? selectedItem.id);
        return;
      }
      const actionByKey: Record<string, InboxActionId> = {
        Enter: "preview",
        a: "approve",
        d: "deny",
        s: "snooze",
        e: "archive",
        o: "open_chat",
        p: "preview"
      };
      const action = actionByKey[event.key];
      if (action) {
        event.preventDefault();
        void handleAction(action, selectedItem);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [items, query, selectedItem]);

  async function handleAction(action: InboxActionId | string, item: InboxItem) {
    if (action === "open_chat") {
      if (item.conversationId) navigate(`/chats/${item.conversationId}`);
      return;
    }
    if (action === "preview" || action === "view_audit") {
      await inboxAction.mutateAsync({ itemId: item.id, action: "read" });
      return;
    }
    if (!SERVER_ACTIONS.has(action as InboxActionId)) return;
    const body = action === "snooze" ? { snoozedUntil: new Date(Date.now() + 60 * 60 * 1000).toISOString() } : undefined;
    await inboxAction.mutateAsync({ itemId: item.id, action: action as InboxServerAction, body });
  }

  return (
    <InboxShell detailOpen={Boolean(selectedItem)}>
      <InboxBucketRail activeBucket={bucket} counts={counts} onBucketChange={(next) => { setBucket(next); setSelectedId(null); }} />
      <main className="oa-inbox-list min-h-0 min-w-0 overflow-y-auto border-r border-oa-border">
        <InboxToolbar
          activeBucket={bucket}
          privacyMode={privacyMode}
          query={query}
          searchRef={searchRef}
          onPrivacyModeChange={setPrivacyMode}
          onQueryChange={setQuery}
        />
        <InboxItemList
          isLoading={itemsQuery.isLoading}
          items={items}
          selectedId={selectedItem?.id ?? null}
          onSelect={setSelectedId}
          onQuickAction={(action, item) => void handleAction(action, item)}
          emptyState={<BucketAwareEmptyState bucket={bucket} />}
        />
      </main>
      <AnimatePresence initial={false}>
        {selectedItem ? (
          <InboxDetailPanel
            key={selectedItem.id}
            item={selectedItem}
            privacyMode={privacyMode}
            onAction={(action, item) => void handleAction(action, item)}
          />
        ) : null}
      </AnimatePresence>
    </InboxShell>
  );
}

function BucketAwareEmptyState({ bucket }: { bucket: InboxBucket }) {
  const copy: Record<InboxBucket, { title: string; message: string }> = {
    needs_my_approval: {
      title: "No approvals pending",
      message: "Nothing needs your approval in this bucket. Completed approvals live in Completed."
    },
    agent_working: {
      title: "No agents working",
      message: "No active agent work is running for this view."
    },
    waiting_on_others: {
      title: "Nothing waiting on others",
      message: "No handoffs or responses are blocking progress."
    },
    risky_sensitive: {
      title: "No risky transfers",
      message: "Sensitive or high-risk work will appear here when it needs attention."
    },
    mentions: {
      title: "No mentions",
      message: "Messages that need your response will appear here."
    },
    completed: {
      title: "No completed work in this filter",
      message: "Completed items may be hidden by the current search."
    },
    failed_blocked: {
      title: "No failed or blocked work",
      message: "Failures and blocked tasks will appear here when they need recovery."
    },
    archived: {
      title: "Archive is empty",
      message: "Archived work will appear here."
    }
  };
  return <InboxEmptyState title={copy[bucket].title} message={copy[bucket].message} />;
}

function emptyCounts(): Record<InboxBucket, number> {
  return {
    needs_my_approval: 0,
    agent_working: 0,
    waiting_on_others: 0,
    risky_sensitive: 0,
    mentions: 0,
    completed: 0,
    failed_blocked: 0,
    archived: 0
  };
}
