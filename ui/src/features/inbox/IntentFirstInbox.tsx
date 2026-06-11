import { useState } from "react";
import { useInboxTriage } from "../../hooks/queries";
import { ActionableCard } from "../../components/inbox/ActionableCard";
import { PrivacyModeToggle } from "../../components/inbox/PrivacyModeToggle";
import { TriageRail } from "../../components/inbox/TriageRail";
import { UniversalCommandBar } from "../../components/inbox/UniversalCommandBar";
import { RightConsentPanel } from "../../components/inbox/RightConsentPanel";
import type { ActionableInboxItem, TriageGroup } from "../../types/agentic";

export function IntentFirstInbox() {
  const groups = useInboxTriage();
  const [selected, setSelected] = useState<ActionableInboxItem | null>(null);
  const [activeGroup, setActiveGroup] = useState<TriageGroup | null>(groups[0] ?? null);

  const items = (activeGroup?.items ?? groups.flatMap((g) => g.items)).slice(0, 8);

  return (
    <div className="grid flex-1 gap-4 xl:grid-cols-[280px_1fr_320px]">
      <div className="space-y-4">
        <TriageRail groups={groups} onSelect={(group) => setActiveGroup(group)} />
        <PrivacyModeToggle />
      </div>
      <div className="space-y-4">
        <UniversalCommandBar />
        <div className="rounded-2xl border border-oa-border bg-oa-surface p-4 shadow-sm">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <p className="text-[11px] uppercase tracking-[0.2em] text-oa-text-muted">Intent-first inbox</p>
              <h2 className="text-lg font-semibold text-oa-text">{activeGroup?.label ?? "Inbox"}</h2>
            </div>
            <span className="rounded-full bg-oa-blue/10 px-2 py-1 text-[10px] font-semibold text-oa-blue">{items.length} ready</span>
          </div>
          <div className="space-y-3">
            {items.map((item) => (
              <button key={item.id} type="button" className="w-full text-left" onClick={() => setSelected(item)}>
                <ActionableCard item={item} onAction={(_action, id) => setSelected(items.find((entry) => entry.id === id) ?? null)} />
              </button>
            ))}
            {items.length === 0 && <p className="rounded-xl border border-dashed border-oa-border bg-oa-bg-elevated p-6 text-sm text-oa-text-muted">No items in this triage group yet.</p>}
          </div>
        </div>
      </div>
      <RightConsentPanel selectedItem={selected} />
    </div>
  );
}
