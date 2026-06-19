import type { InboxItem } from "../../api/types";
import type { ReactNode } from "react";
import { InboxEmptyState } from "./InboxEmptyState";
import { InboxItemRow } from "./InboxItemRow";
import { AnimatePresence, listContainerVariants, listItemVariants, m, motionTransition } from "../primitives/MotionPrimitives";

export function InboxItemList({
  isLoading,
  items,
  selectedId,
  onSelect,
  onQuickAction,
  emptyState
}: {
  isLoading: boolean;
  items: InboxItem[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onQuickAction: (action: string, item: InboxItem) => void;
  emptyState?: ReactNode;
}) {
  if (isLoading) {
    return (
      <m.div className="space-y-2 p-4" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={motionTransition.quick}>
        {Array.from({ length: 6 }, (_, index) => (
          <div key={index} className="h-[78px] animate-pulse rounded-xl bg-oa-surface/70" />
        ))}
      </m.div>
    );
  }

  if (items.length === 0) return <>{emptyState ?? <InboxEmptyState />}</>;

  return (
    <m.div
      layout
      className="space-y-1 p-3"
      role="list"
      aria-label="Inbox items"
      variants={listContainerVariants}
      initial={false}
      animate="animate"
    >
      <AnimatePresence initial={false}>
        {items.map((item) => (
          <m.div
            layout="position"
            key={item.id}
            role="listitem"
            variants={listItemVariants}
            initial="initial"
            animate="animate"
            exit="exit"
            transition={motionTransition.quick}
          >
            <InboxItemRow
              item={item}
              selected={item.id === selectedId}
              onSelect={() => onSelect(item.id)}
              onQuickAction={onQuickAction}
            />
          </m.div>
        ))}
      </AnimatePresence>
    </m.div>
  );
}
