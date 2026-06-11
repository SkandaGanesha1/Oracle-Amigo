import { useState, useCallback } from "react";
import { Search, X } from "lucide-react";

interface SearchPanelProps {
  onSearch?: (query: string) => void;
  placeholder?: string;
}

export function SearchPanel({ onSearch, placeholder = "Search conversations..." }: SearchPanelProps) {
  const [query, setQuery] = useState("");

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const value = e.target.value;
      setQuery(value);
      onSearch?.(value);
    },
    [onSearch],
  );

  const handleClear = useCallback(() => {
    setQuery("");
    onSearch?.("");
  }, [onSearch]);

  return (
    <div className="relative px-3 py-2.5">
      <Search className="pointer-events-none absolute left-6 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-oa-text-muted" />
      <input
        type="text"
        value={query}
        onChange={handleChange}
        placeholder={placeholder}
        aria-label={placeholder}
        className="w-full rounded-lg border border-oa-border bg-oa-surface py-1.5 pl-8 pr-8 text-sm text-oa-text placeholder-oa-text-disabled transition-colors focus:border-oa-blue focus:outline-none focus:ring-1 focus:ring-oa-blue"
      />
      {query && (
        <button
          type="button"
          onClick={handleClear}
          aria-label="Clear search"
          className="absolute right-4 top-1/2 -translate-y-1/2 text-oa-text-muted hover:text-oa-text"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}
