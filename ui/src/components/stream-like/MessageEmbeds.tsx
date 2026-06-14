import { safeExternalHref } from "../../lib/safeUrl";
import { SafeMediaPreview } from "./SafeMediaPreview";

interface MessageEmbed {
  url?: string;
  image_url?: string;
  thumbnail_url?: string;
  title?: string;
  description?: string;
  mime_type?: string;
}

function normalizeEmbed(value: Record<string, unknown>): MessageEmbed {
  return {
    url: typeof value.url === "string" ? value.url : undefined,
    image_url: typeof value.image_url === "string" ? value.image_url : undefined,
    thumbnail_url: typeof value.thumbnail_url === "string" ? value.thumbnail_url : undefined,
    title: typeof value.title === "string" ? value.title : undefined,
    description: typeof value.description === "string" ? value.description : undefined,
    mime_type: typeof value.mime_type === "string" ? value.mime_type : undefined,
  };
}

export function MessageEmbeds({ embeds }: { embeds?: Array<Record<string, unknown>> }) {
  if (!embeds?.length) return null;

  return (
    <div className="mt-2 flex flex-col gap-2">
      {embeds.map((embed, index) => {
        const item = normalizeEmbed(embed);
        const href = safeExternalHref(item.url);
        const title = item.title?.trim() || item.url || "Embedded content";
        return (
          <div key={`${item.url ?? item.image_url ?? item.thumbnail_url ?? index}`} className="max-w-xl rounded-lg border border-oa-border bg-oa-surface/50 p-3">
            {href ? (
              <a href={href} target="_blank" rel="noreferrer" className="text-xs font-medium text-oa-cyan underline-offset-2 hover:underline">
                {title}
              </a>
            ) : (
              <p className="text-xs font-medium text-oa-text-secondary">{title}</p>
            )}
            {item.description && (
              <p className="mt-1 line-clamp-3 text-xs text-oa-text-muted">{item.description}</p>
            )}
            <div className="mt-2">
              <SafeMediaPreview
                url={item.image_url ?? item.thumbnail_url}
                mimeType={item.mime_type ?? "image/*"}
                label={title}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
