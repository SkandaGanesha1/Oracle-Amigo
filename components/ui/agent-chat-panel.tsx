import { useCallback, useEffect, useRef, useState, type FC } from "react";
import { ApprovalCard, type PersonalApproval } from "./approval-card";

type ChatMessage = {
  role: "user" | "agent";
  content: string;
  approval?: PersonalApproval;
};

type StoredFile = {
  id: string;
  storedPath: string;
  originalFileName: string;
  sha256: string;
  sizeBytes: number;
  receivedAt: string;
};

export const AgentChatPanel: FC = () => {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [storedFiles, setStoredFiles] = useState<StoredFile[]>([]);
  const [showFiles, setShowFiles] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const refreshStoredFiles = useCallback(async () => {
    try {
      const res = await fetch("/storage/files");
      if (res.ok) {
        const body = (await res.json()) as { files: StoredFile[] };
        setStoredFiles(body.files);
      }
    } catch { /* ignore */ }
  }, []);

  const sendMessage = useCallback(async (text: string) => {
    if (!text.trim() || loading) return;
    setLoading(true);
    setMessages((prev) => [...prev, { role: "user", content: text }]);

    try {
      const res = await fetch("/chat/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as {
        type: string;
        conversationId: string;
        text?: string;
        taskId?: string;
        approvalId?: string;
        candidates?: Array<{
          id: number; fileName: string; displayPath: string;
          extension: string; sizeBytes: number; modifiedAt: string;
          score: number; reason: string;
        }>;
      };

      if (body.type === "chat") {
        setMessages((prev) => [...prev, { role: "agent", content: body.text ?? "" }]);
      } else if (body.type === "approval_required" && body.candidates) {
        const cands = body.candidates;
        setMessages((prev) => [
          ...prev,
          {
            role: "agent",
            content: `Found ${cands.length} candidate file(s).`,
            approval: {
              approvalId: body.approvalId!,
              taskId: body.taskId!,
              requesterName: "You",
              requestText: text,
              candidates: cands.map((c) => ({
                ...c,
                id: c.id,
              })),
              status: "pending",
            },
          },
        ]);
      }
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        { role: "agent", content: `Error: ${err instanceof Error ? err.message : "Request failed"}` },
      ]);
    } finally {
      setLoading(false);
    }
  }, [loading]);

  const handleReject = useCallback(async (approvalId: string) => {
    try {
      const res = await fetch(`/approvals/${approvalId}/reject`, { method: "POST" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setMessages((prev) => [...prev, { role: "agent", content: "Request rejected. ❌" }]);
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        { role: "agent", content: `Rejection failed: ${err instanceof Error ? err.message : "Unknown error"}` },
      ]);
    }
  }, []);

  const handleFeedback = useCallback(async (approvalId: string, feedback: string) => {
    try {
      const res = await fetch(`/approvals/${approvalId}/feedback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ feedback }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as {
        candidates?: Array<{
          id: number; fileName: string; displayPath: string;
          extension: string; sizeBytes: number; modifiedAt: string;
          score: number; reason: string;
        }>;
        newApproval?: { id: string; taskId: string };
      };
      if (body.candidates && body.newApproval) {
        const taskId = body.newApproval.taskId;
        const newApprovalId = body.newApproval.id;
        setMessages((prev) => {
          // Replace the old approval card with the new one bound to the new approvalId
          return prev.map((m) => {
            if (m.approval?.approvalId === approvalId) {
              return {
                ...m,
                approval: {
                  approvalId: newApprovalId,
                  taskId,
                  requesterName: "You",
                  requestText: feedback,
                  candidates: body.candidates!.map((c) => ({ ...c, id: c.id })),
                  status: "pending",
                },
              };
            }
            return m;
          }).concat([{ role: "agent", content: `Refined search with feedback. Found ${body.candidates!.length} candidate(s).` }]);
        });
      }
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        { role: "agent", content: `Feedback failed: ${err instanceof Error ? err.message : "Unknown error"}` },
      ]);
    }
  }, []);

  const handleSearchAgain = useCallback(async (approvalId: string) => {
    // Re-run search with the original query, with a small perturbation (no terms).
    // We treat "Search Again" as "give me the next-best top candidates, drop the previous top".
    try {
      const oldMsg = messages.find((m) => m.approval?.approvalId === approvalId);
      const originalText = oldMsg?.approval?.requestText ?? "";
      const topId = oldMsg?.approval?.candidates[0]?.id;
      const res = await fetch(`/approvals/${approvalId}/feedback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          feedback: originalText,
          rejectedFileIds: topId != null ? [topId] : [],
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as {
        candidates?: Array<{
          id: number; fileName: string; displayPath: string;
          extension: string; sizeBytes: number; modifiedAt: string;
          score: number; reason: string;
        }>;
        newApproval?: { id: string; taskId: string };
      };
      if (body.candidates && body.newApproval) {
        const newApprovalId = body.newApproval.id;
        const taskId = body.newApproval.taskId;
        setMessages((prev) => prev.map((m) => {
          if (m.approval?.approvalId === approvalId) {
            return {
              ...m,
              approval: {
                approvalId: newApprovalId,
                taskId,
                requesterName: "You",
                requestText: `Search again: ${originalText}`,
                candidates: body.candidates!.map((c) => ({ ...c, id: c.id })),
                status: "pending",
              },
            };
          }
          return m;
        }).concat([{ role: "agent", content: `Searched again. ${body.candidates!.length} candidate(s) remain.` }]));
      }
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        { role: "agent", content: `Search again failed: ${err instanceof Error ? err.message : "Unknown error"}` },
      ]);
    }
  }, [messages]);

  const handleChooseManually = useCallback(async (approvalId: string) => {
    // Fetch the full index and replace the candidate list
    try {
      const res = await fetch(`/files/indexed?limit=200`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as { items: Array<{
        id: number; fileName: string; displayPath: string; extension: string;
        sizeBytes: number; modifiedAt: string; filePath: string;
      }>; total: number };
      // Mark a flag in chat so the user knows they can pick from the full index.
      setMessages((prev) => prev.map((m) => {
        if (m.approval?.approvalId === approvalId) {
          return {
            ...m,
            approval: {
              ...m.approval,
              requestText: `${m.approval.requestText} — choose from all ${body.total} indexed files:`,
              candidates: body.items.map((c) => ({
                id: c.id,
                fileName: c.fileName,
                displayPath: c.displayPath,
                extension: c.extension,
                sizeBytes: c.sizeBytes,
                modifiedAt: c.modifiedAt,
                score: 0,
                reason: "manual-pick",
              })),
            },
          };
        }
        return m;
      }).concat([{ role: "agent", content: `Browse mode: showing all ${body.total} indexed files. Pick one and approve.` }]));
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        { role: "agent", content: `Choose manually failed: ${err instanceof Error ? err.message : "Unknown error"}` },
      ]);
    }
  }, []);

  const handleApprove = useCallback(async (approvalId: string, fileId: number) => {
    try {
      // If the picked file is not the bound one (manual pick), rebind first
      const oldMsg = messages.find((m) => m.approval?.approvalId === approvalId);
      const pickedCandidate = oldMsg?.approval?.candidates.find((c) => c.id === fileId);
      if (pickedCandidate && pickedCandidate.reason === "manual-pick") {
        // Rebind to the manually picked file
        await fetch(`/approvals/${approvalId}/rebind-file`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ fileId }),
        });
      }
      const res = await fetch(`/approvals/${approvalId}/approve`, { method: "POST" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setMessages((prev) => [
        ...prev,
        { role: "agent", content: `File approved and stored. ✅` },
      ]);
      refreshStoredFiles();
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        { role: "agent", content: `Approval failed: ${err instanceof Error ? err.message : "Unknown error"}` },
      ]);
    }
  }, [messages, refreshStoredFiles]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-white/10 px-4 py-2">
        <h2 className="text-sm font-semibold text-white/80">Agent Chat</h2>
        <button
          type="button"
          onClick={() => { setShowFiles(!showFiles); if (!showFiles) refreshStoredFiles(); }}
          className="rounded border border-white/10 bg-white/10 px-2 py-1 text-[11px] text-white/60 transition hover:bg-white/15"
        >
          {showFiles ? "Hide Files" : `Files (${storedFiles.length})`}
        </button>
      </div>

      {showFiles && storedFiles.length > 0 && (
        <div className="max-h-40 overflow-y-auto border-b border-white/10 bg-black/20 p-3">
          <p className="mb-1 text-[11px] font-medium text-white/40">Stored Files</p>
          <div className="space-y-1">
            {storedFiles.map((f) => (
              <div key={f.id} className="flex items-center justify-between gap-2 rounded border border-white/5 bg-black/20 px-2 py-1">
                <span className="truncate text-xs text-white/70">{f.originalFileName}</span>
                <span className="shrink-0 text-[10px] text-white/30">{formatSize(f.sizeBytes)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="flex-1 space-y-3 overflow-y-auto p-4">
        {messages.map((msg, i) => (
          <div key={i}>
            <div
              className={`rounded px-3 py-2 text-xs ${
                msg.role === "user"
                  ? "ml-8 bg-emerald-500/10 text-emerald-100"
                  : "mr-8 bg-white/5 text-white/80"
              }`}
            >
              {msg.content}
            </div>
            {msg.approval && (
              <div className="mt-2">
                <ApprovalCard
                  approval={msg.approval}
                  onApprove={handleApprove}
                  onReject={handleReject}
                  onFeedback={handleFeedback}
                  onSearchAgain={handleSearchAgain}
                  onChooseManually={handleChooseManually}
                  disabled={loading}
                />
              </div>
            )}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      <div className="border-t border-white/10 p-3">
        <div className="flex gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(input); setInput(""); } }}
            placeholder="Find me a file..."
            disabled={loading}
            className="min-w-0 flex-1 rounded border border-white/10 bg-black/25 px-3 py-2 text-xs text-white placeholder-white/30 outline-none transition focus:border-white/20 disabled:opacity-50"
          />
          <button
            type="button"
            disabled={loading || !input.trim()}
            onClick={() => { sendMessage(input); setInput(""); }}
            className="rounded bg-white/10 px-3 py-2 text-xs text-white transition hover:bg-white/15 disabled:opacity-50"
          >
            {loading ? "..." : "Send"}
          </button>
        </div>
      </div>
    </div>
  );
};

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
