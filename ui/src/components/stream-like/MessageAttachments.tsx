import { SafeMediaPreview } from "./SafeMediaPreview";

interface MessageAttachment {
  url?: string;
  preview_url?: string;
  href?: string;
  name?: string;
  file_name?: string;
  mime_type?: string;
  mimeType?: string;
  type?: string;
}

function normalizeAttachment(value: Record<string, unknown>): MessageAttachment {
  return {
    url: typeof value.url === "string" ? value.url : undefined,
    preview_url: typeof value.preview_url === "string" ? value.preview_url : undefined,
    href: typeof value.href === "string" ? value.href : undefined,
    name: typeof value.name === "string" ? value.name : undefined,
    file_name: typeof value.file_name === "string" ? value.file_name : undefined,
    mime_type: typeof value.mime_type === "string" ? value.mime_type : undefined,
    mimeType: typeof value.mimeType === "string" ? value.mimeType : undefined,
    type: typeof value.type === "string" ? value.type : undefined,
  };
}

export function MessageAttachments({ attachments }: { attachments?: Array<Record<string, unknown>> }) {
  if (!attachments?.length) return null;

  return (
    <div className="mt-2 flex flex-col gap-2">
      {attachments.map((attachment, index) => {
        const item = normalizeAttachment(attachment);
        return (
          <SafeMediaPreview
            key={`${item.url ?? item.preview_url ?? item.href ?? item.name ?? index}`}
            url={item.preview_url ?? item.url ?? item.href}
            mimeType={item.mime_type ?? item.mimeType ?? item.type}
            label={item.file_name ?? item.name}
          />
        );
      })}
    </div>
  );
}
