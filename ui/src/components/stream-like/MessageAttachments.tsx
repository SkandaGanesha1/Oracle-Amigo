import { SafeMediaPreview } from "./SafeMediaPreview";
import type { MessageAttachment } from "../../api/types";
import { PdfMessageCard, isPdfAttachment } from "../../features/files/PdfMessageCard";

function attachmentKey(attachment: MessageAttachment, index: number): string {
  return attachment.id || attachment.url || attachment.file_name || String(index);
}

export function MessageAttachments({ attachments }: { attachments?: MessageAttachment[] }) {
  if (!attachments?.length) return null;

  return (
    <div className="mt-2 flex flex-col gap-2">
      {attachments.map((attachment, index) => (
        isPdfAttachment(attachment) ? (
          <PdfMessageCard key={attachmentKey(attachment, index)} attachment={attachment} />
        ) : (
          <SafeMediaPreview
            key={attachmentKey(attachment, index)}
            url={attachment.thumbnail_url ?? attachment.url}
            mimeType={attachment.mime_type}
            label={attachment.file_name}
            scanState={attachment.scan_state}
            sizeBytes={attachment.size_bytes}
          />
        )
      ))}
    </div>
  );
}
