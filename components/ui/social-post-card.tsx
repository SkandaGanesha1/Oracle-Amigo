import type { ReactNode } from "react";
import { Bookmark, FileText } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export interface SocialPostCardAction {
  key: string;
  label: string;
  icon: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  tone?: "primary" | "danger" | "neutral";
}

export interface SocialPostCardDocument {
  title: string;
  description?: string;
  icon?: ReactNode;
}

export interface SocialPostCardAuthor {
  name: string;
  username?: string;
  avatarSeed?: string;
  initials?: string;
  timeAgo?: string;
}

export interface SocialPostCardProps {
  author: SocialPostCardAuthor;
  contentText: string;
  document: SocialPostCardDocument;
  actions: [SocialPostCardAction, SocialPostCardAction, SocialPostCardAction];
  bookmarkedLabel?: string;
  className?: string;
}

const avatarGradients = [
  "from-sky-300 via-blue-500 to-violet-700",
  "from-cyan-300 via-teal-500 to-blue-700",
  "from-fuchsia-300 via-rose-500 to-orange-600",
  "from-amber-200 via-indigo-500 to-slate-800",
];

function gradientForSeed(seed: string) {
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash * 31 + seed.charCodeAt(index)) % avatarGradients.length;
  }
  return avatarGradients[Math.abs(hash)];
}

function initialsForAuthor(author: SocialPostCardAuthor) {
  if (author.initials) return author.initials;

  return (
    author.name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join("") || "AG"
  );
}

export default function SocialPostCard({
  author,
  contentText,
  document,
  actions,
  bookmarkedLabel = "Approval request",
  className,
}: SocialPostCardProps) {
  return (
    <article
      className={cn(
        "mx-auto w-full max-w-lg overflow-hidden rounded-3xl border border-white/[0.08] bg-[#18181d] text-zinc-100 shadow-[0_22px_64px_rgba(0,0,0,.42)] backdrop-blur-lg",
        className
      )}
      aria-label={bookmarkedLabel}
    >
      <header className="flex items-center justify-between gap-4 px-7 pt-6">
        <div className="flex min-w-0 items-center gap-4">
          <div
            className={cn(
              "grid h-14 w-14 aspect-square shrink-0 place-items-center overflow-hidden rounded-full border border-white/[0.1] bg-gradient-to-br text-sm font-bold text-white shadow-inner",
              gradientForSeed(author.avatarSeed ?? author.name)
            )}
            aria-hidden="true"
          >
            {initialsForAuthor(author)}
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-white">{author.name}</p>
            <p className="truncate text-xs text-zinc-400">
              {author.username ? `@${author.username}` : "approval"}
              {author.timeAgo ? ` - ${author.timeAgo}` : ""}
            </p>
          </div>
        </div>
        <Bookmark className="h-6 w-6 shrink-0 text-zinc-400" aria-hidden="true" />
      </header>

      <div className="px-7 py-6 text-lg leading-8 text-zinc-300">
        {contentText}
      </div>

      <div className="mx-7 mb-6 rounded-2xl border border-white/[0.06] bg-[#202127] p-5 transition hover:bg-[#25262d]">
        <div className="flex items-start gap-4">
          <div className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-white/[0.07] text-blue-400">
            {document.icon ?? <FileText className="h-5 w-5" aria-hidden="true" />}
          </div>
          <div className="min-w-0">
            <h4 className="truncate text-sm font-semibold text-white" title={document.title}>
              {document.title}
            </h4>
            {document.description && (
              <p className="mt-1 truncate text-xs text-zinc-400" title={document.description}>
                {document.description}
              </p>
            )}
          </div>
        </div>
      </div>

      <footer className="grid grid-cols-3 divide-x divide-white/[0.08] border-t border-white/[0.08] text-center">
        {actions.map((action) => (
          <Tooltip key={action.key}>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={action.onClick}
                disabled={action.disabled}
                aria-label={action.label}
                className={cn(
                  "flex min-h-[64px] w-full items-center justify-center transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-400 disabled:cursor-not-allowed disabled:opacity-45",
                  action.tone === "primary" && "text-blue-400 hover:bg-blue-950/40 hover:text-blue-300",
                  action.tone === "danger" && "text-rose-400 hover:bg-rose-950/40 hover:text-rose-300",
                  (!action.tone || action.tone === "neutral") && "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
                )}
              >
                <span className="grid h-9 w-9 place-items-center rounded-full">
                  {action.icon}
                </span>
              </button>
            </TooltipTrigger>
            <TooltipContent side="top">
              {action.label}
            </TooltipContent>
          </Tooltip>
        ))}
      </footer>
    </article>
  );
}
