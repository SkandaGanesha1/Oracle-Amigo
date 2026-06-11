import { useState } from "react";
import { FileText } from "lucide-react";

export function RedactionEditor({ fileName }: { fileName?: string }) {
  const [pagesToRemove, setPagesToRemove] = useState("1");
  const [fieldsToRedact, setFieldsToRedact] = useState("signature,account_number");

  return (
    <section className="rounded-2xl border border-oa-border bg-oa-surface p-4 shadow-sm">
      <div className="flex items-center gap-2 text-sm font-semibold text-oa-text"><FileText className="h-4 w-4 text-oa-blue" />Redaction preview</div>
      <p className="mt-1 text-xs text-oa-text-muted">Pages to remove: {pagesToRemove}</p>
      <input className="mt-3 w-full rounded-lg border border-oa-border bg-oa-bg-elevated px-3 py-2 text-xs" value={pagesToRemove} onChange={(e) => setPagesToRemove(e.target.value)} placeholder="1,2" />
      <input className="mt-2 w-full rounded-lg border border-oa-border bg-oa-bg-elevated px-3 py-2 text-xs" value={fieldsToRedact} onChange={(e) => setFieldsToRedact(e.target.value)} placeholder="signature,account_number" />
      <p className="mt-3 text-xs text-oa-text-muted">Preview for {fileName ?? "selected file"} will include watermark and redaction markers before transfer.</p>
    </section>
  );
}
