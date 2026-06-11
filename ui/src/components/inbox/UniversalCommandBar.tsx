import { Search } from "lucide-react";
import { useMemo, useState } from "react";
import { useUniversalSearch } from "../../hooks/queries";

export function UniversalCommandBar() {
  const [query, setQuery] = useState("");
  const results = useUniversalSearch(query);
  const items = results.data?.results ?? [];
  const chips = useMemo(() => ["approvals", "files", "missions", "policy"], []);

  return (
    <section className="rounded-2xl border border-oa-border bg-oa-surface p-4 shadow-sm">
      <div className="flex items-center gap-3 rounded-xl border border-oa-border bg-oa-bg-elevated px-3 py-3">
        <Search className="h-4 w-4 text-oa-text-muted" />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Cmd+K: search approvals, files, missions, policy..."
          className="w-full bg-transparent text-sm text-oa-text outline-none placeholder:text-oa-text-muted"
        />
      </div>
      <div className="mt-3 flex flex-wrap gap-2 text-[10px] text-oa-text-muted">
        {chips.map((chip) => <span key={chip} className="rounded-full bg-oa-blue/10 px-2 py-1">{chip}</span>)}
      </div>
      {query && items.length > 0 && (
        <div className="mt-3 rounded-xl border border-oa-border bg-oa-bg-elevated p-3 text-sm text-oa-text">
          {items.slice(0, 4).map((item) => <p key={item.id} className="py-1">- {item.title}</p>)}
        </div>
      )}
    </section>
  );
}
