export function generateHumanReadableTitle(rawEvent: Record<string, unknown>): string {
  const text = String(rawEvent?.request_text ?? rawEvent?.title ?? rawEvent?.eventType ?? rawEvent?.status ?? "Inbox item");
  const cleaned = text
    .replace(/\b[A-Fa-f0-9]{8}-[A-Fa-f0-9]{4}-[A-Fa-f0-9]{4}-[A-Fa-f0-9]{4}-[A-Fa-f0-9]{12}\b/g, "")
    .replace(/\b[A-Za-z0-9_-]{20,}\b/g, "")
    .replace(/\s+/g, " ")
    .trim();

  if (/approval|approve|candidate/i.test(text)) return `Approval request: ${cleaned || "Review your latest file request"}`;
  if (/transfer|file/i.test(text)) return `Transfer activity: ${cleaned || "File transfer update"}`;
  return cleaned || "Inbox update";
}
