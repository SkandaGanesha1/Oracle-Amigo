import { Search, ShieldCheck } from "lucide-react";
import type { RefObject } from "react";
import type { InboxBucket } from "../../api/types";

export function InboxToolbar({
  activeBucket,
  privacyMode,
  query,
  searchRef,
  onPrivacyModeChange,
  onQueryChange
}: {
  activeBucket: InboxBucket;
  privacyMode: boolean;
  query: string;
  searchRef: RefObject<HTMLInputElement | null>;
  onPrivacyModeChange: (enabled: boolean) => void;
  onQueryChange: (value: string) => void;
}) {
  return (
    <header className="sticky top-0 z-20 border-b border-oa-border bg-oa-bg/95 px-4 py-4 backdrop-blur">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-oa-text">Inbox</h1>
          <p className="mt-1 text-sm text-oa-text-muted">Review approvals, agent activity, sensitive transfers, and completed work.</p>
        </div>
        <button
          type="button"
          onClick={() => onPrivacyModeChange(!privacyMode)}
          className={`inline-flex min-h-9 items-center gap-2 rounded-lg border px-3 text-xs font-medium ${
            privacyMode ? "border-oa-blue/40 bg-oa-blue/10 text-oa-blue" : "border-oa-border bg-oa-surface text-oa-text-muted hover:text-oa-text"
          }`}
        >
          <ShieldCheck className="h-3.5 w-3.5" />
          {privacyMode ? "Privacy on" : "Privacy off"}
        </button>
      </div>
      <div className="mt-4 flex items-center gap-2 rounded-xl border border-oa-border bg-oa-surface px-3 py-2">
        <Search className="h-4 w-4 text-oa-text-muted" />
        <input
          ref={searchRef}
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder={`Search ${activeBucket.replaceAll("_", " ")}...`}
          className="min-h-8 w-full bg-transparent text-sm text-oa-text outline-none placeholder:text-oa-text-disabled"
        />
        <span className="rounded border border-oa-border px-1.5 py-0.5 text-[10px] text-oa-text-muted">/</span>
      </div>
    </header>
  );
}
