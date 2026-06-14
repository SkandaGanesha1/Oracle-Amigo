import type { InboxItem } from "../../api/types";
import { InboxEmptyState } from "./InboxEmptyState";
import { InboxItemRow } from "./InboxItemRow";

export function InboxItemList({
  isLoading,
  items,
  selectedId,
  onSelect,
  onQuickAction
}: {
  isLoading: boolean;
  items: InboxItem[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onQuickAction: (action: string, item: InboxItem) => void;
}) {
  if (isLoading) {
    return (
      <div className="space-y-2 p-4">
        {Array.from({ length: 6 }, (_, index) => (
          <div key={index} className="h-[78px] animate-pulse rounded-xl bg-oa-surface/70" />
        ))}
      </div>
    );
  }

  if (items.length === 0) return <InboxEmptyState />;

  return (
    <div className="space-y-1 p-3" role="list" aria-label="Inbox items">
      {items.map((item) => (
        <div key={item.id} role="listitem">
          <InboxItemRow
            item={item}
            selected={item.id === selectedId}
            onSelect={() => onSelect(item.id)}
            onQuickAction={onQuickAction}
          />
        </div>
      ))}
    </div>
  );
}
