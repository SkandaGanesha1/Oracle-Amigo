import { EyeOff, Eye } from "lucide-react";
import { useEffect, useState } from "react";

export function PrivacyModeToggle() {
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    const saved = window.localStorage.getItem("oa-privacy-mode") === "true";
    setEnabled(saved);
  }, []);

  useEffect(() => {
    window.localStorage.setItem("oa-privacy-mode", String(enabled));
  }, [enabled]);

  return (
    <button type="button" onClick={() => setEnabled((prev) => !prev)} className="inline-flex items-center gap-2 rounded-xl border border-oa-border bg-oa-surface px-3 py-2 text-xs text-oa-text">
      {enabled ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
      {enabled ? "Privacy mode on" : "Enable privacy mode"}
    </button>
  );
}
