import type { TriageGroup } from "../../types/agentic";

export function TriageRail({ groups, onSelect }: { groups: TriageGroup[]; onSelect: (group: TriageGroup) => void }) {
  return (
    <aside className="rounded-2xl border border-oa-border bg-oa-surface p-3 shadow-sm">
      <h3 className="px-1 text-xs font-semibold uppercase tracking-[0.2em] text-oa-text-muted">Triage</h3>
      <div className="mt-3 space-y-2">
        {groups.map((group) => {
          const Icon = group.icon;
          return (
            <button
              key={group.id}
              type="button"
              onClick={() => onSelect(group)}
              className="flex w-full items-center gap-3 rounded-xl border border-oa-border bg-oa-bg-elevated px-3 py-3 text-left hover:border-oa-border-strong"
            >
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-oa-blue/10 text-oa-blue"><Icon className="h-4 w-4" /></div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-oa-text">{group.label}</p>
                <p className="text-[11px] text-oa-text-muted">{group.count} items</p>
              </div>
              <span className="rounded-full bg-oa-amber/10 px-2 py-1 text-[10px] font-semibold text-oa-amber">{group.count}</span>
            </button>
          );
        })}
      </div>
    </aside>
  );
}
