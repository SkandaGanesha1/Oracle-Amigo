import { FileSearch, ShieldCheck } from "lucide-react";

interface FileRequestIntentChipProps {
  visible: boolean;
}

const FILE_REQUEST_PATTERN = /(?:^\/(?:request-file|send-file)\b|(?:find|get|search|show|send|fetch|locate|open)\s+(?:(?:me|us)\s+)?(?:the\s+)?(?:[\w-]+\s+){0,6}(?:file|document|pdf|spreadsheet|invoice|report|image))/i;

export function matchFileRequestIntent(text: string): boolean {
  return FILE_REQUEST_PATTERN.test(text.trim());
}

export function FileRequestIntentChip({ visible }: FileRequestIntentChipProps) {
  if (!visible) return null;

  return (
    <span className="oa-file-request-chip" aria-label="Sending as file request">
      <FileSearch className="h-3 w-3" aria-hidden="true" />
      Sending as file request
      <ShieldCheck className="h-3 w-3" aria-hidden="true" />
    </span>
  );
}
