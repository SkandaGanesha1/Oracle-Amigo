import { ShieldAlert } from "lucide-react";
import { safeExternalHref } from "../../lib/safeUrl";
import { SafeMediaPreview } from "./SafeMediaPreview";
import type { MessageEmbed } from "../../api/types";

export function MessageEmbeds({ embeds }: { embeds?: MessageEmbed[] }) {
  if (!embeds?.length) return null;

  return (
    <div className="mt-2 flex flex-col gap-2">
      {embeds.map((embed, index) => {
        const href = safeExternalHref(embed.url);
        const title = embed.title?.trim() || embed.url || "Embedded content";
        const key = embed.id || embed.url || embed.image_url || embed.thumbnail_url || String(index);

        if (embed.safety_state === "blocked") {
          return (
            <div key={key} className="max-w-xl rounded-lg border border-oa-red/30 bg-oa-red/10 p-3 text-xs text-oa-red">
              <div className="flex items-center gap-2 font-medium">
                <ShieldAlert className="h-4 w-4" aria-hidden="true" />
                Embed blocked by safety policy
              </div>
            </div>
          );
        }

        return (
          <div key={key} className="max-w-xl rounded-lg border border-oa-border bg-oa-surface/50 p-3">
            {href ? (
              <a href={href} target="_blank" rel="noreferrer noopener" className="text-xs font-medium text-oa-cyan underline-offset-2 hover:underline">
                {title}
              </a>
            ) : (
              <p className="text-xs font-medium text-oa-text-secondary">{title}</p>
            )}
            {embed.provider && (
              <p className="mt-1 text-[10px] uppercase tracking-[0.16em] text-oa-text-disabled">{embed.provider}</p>
            )}
            {embed.description && (
              <p className="mt-1 line-clamp-3 text-xs text-oa-text-muted">{embed.description}</p>
            )}
            {embed.safety_state === "safe" && (embed.image_url || embed.thumbnail_url) && (
              <div className="mt-2">
                <SafeMediaPreview
                  url={embed.image_url ?? embed.thumbnail_url}
                  mimeType="image/*"
                  label={title}
                  safetyState={embed.safety_state}
                />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
