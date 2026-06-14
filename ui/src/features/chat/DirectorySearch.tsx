import { useEffect, useRef, useState } from "react";
import { Search, Plus, X } from "lucide-react";
import { useDirectorySearch, useStartConversation } from "../../hooks/queries";
import { useNavigate } from "react-router-dom";
import { OracleAvatar } from "../../components/primitives/OracleAvatar";
import type { AgentInstance } from "../../api/types";

export function DirectorySearch() {
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const { data: directoryData } = useDirectorySearch(query);
  const createConversation = useStartConversation();
  const [showResults, setShowResults] = useState(false);

  const users = directoryData?.users ?? [];

  useEffect(() => {
    function focusDirectorySearch() {
      inputRef.current?.focus();
      setShowResults(Boolean(inputRef.current?.value.trim()));
    }

    window.addEventListener("oa-focus-directory-search", focusDirectorySearch);
    return () => window.removeEventListener("oa-focus-directory-search", focusDirectorySearch);
  }, []);

  async function startConversation(userId: string, displayName: string) {
    const selectedUser = users.find((user) => user.user_id === userId);
    const agent = bestDirectoryAgent(selectedUser?.agents ?? []);
    const result = await createConversation.mutateAsync({
      title: displayName,
      peer_user_id: userId,
      peer_agent_instance_id: agent?.agent_instance_id ?? null,
      mode: "cloud_relay",
    });
    const convId = result?.conversation?.id;
    if (convId) {
      setShowResults(false);
      setQuery("");
      navigate(`/chats/${convId}`);
    }
  }

  return (
    <div className="relative px-3 py-2" role="combobox" aria-expanded={showResults} aria-haspopup="listbox">
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-oa-text-muted" />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.currentTarget.value);
            if (e.currentTarget.value.trim()) setShowResults(true);
          }}
          onFocus={() => { if (query.trim()) setShowResults(true); }}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              setShowResults(false);
              e.currentTarget.blur();
            }
          }}
          placeholder="Search directory..."
          className="w-full rounded-lg border border-oa-border bg-oa-bg-elevated py-1.5 pl-8 pr-3 text-xs text-oa-text placeholder-oa-text-disabled transition-colors focus:border-oa-blue focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-oa-blue"
          aria-autocomplete="list"
          aria-controls="directory-search-results"
        />
        {query && (
          <button
            type="button"
            onClick={() => { setQuery(""); setShowResults(false); }}
            className="absolute right-2 top-1/2 -translate-y-1/2 flex min-h-[48px] min-w-[48px] items-center justify-center text-oa-text-muted hover:text-oa-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-oa-blue focus-visible:ring-offset-2"
            aria-label="Clear search"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {showResults && query.trim() && (
        <div id="directory-search-results" className="absolute left-3 right-3 top-full z-50 mt-1 max-h-60 overflow-y-auto rounded-lg border border-oa-border bg-oa-surface-2 p-1 shadow-lg" role="listbox" aria-live="polite">
          {users.length === 0 ? (
            <div className="px-3 py-4 text-center text-xs text-oa-text-muted">
              No users found
            </div>
          ) : (
            users.map((user) => (
              <button
                key={user.user_id}
                type="button"
                role="option"
                onClick={() => void startConversation(user.user_id, user.display_name)}
                className="flex min-h-[48px] w-full items-center gap-2.5 rounded-md px-3 py-2 text-left transition-colors hover:bg-oa-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-oa-blue"
              >
                <OracleAvatar
                  seed={user.email}
                  initials={user.display_name.slice(0, 2).toUpperCase()}
                  size="sm"
                  className="h-7 w-7"
                />
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-sm font-medium text-oa-text">{user.display_name}</span>
                  <span className="truncate text-xs text-oa-text-muted">{user.email}</span>
                </div>
                <Plus className="h-4 w-4 shrink-0 text-oa-text-muted" />
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

function bestDirectoryAgent(agents: AgentInstance[]): AgentInstance | null {
  return agents.find((agent) => agent.status === "online") ?? agents.find((agent) => agent.status === "stale") ?? agents[0] ?? null;
}
