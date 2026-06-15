import { useMessageReactions } from "../../lib/messageReactions";

interface MessageReactionsProps {
  messageId: string;
}

const REACTIONS = [
  { id: "👍", label: "Thumbs up" },
  { id: "❤️", label: "Heart" },
  { id: "😀", label: "Smile" },
  { id: "🙏", label: "Pray" }
];

export function MessageReactions({ messageId }: MessageReactionsProps) {
  const { reactions, toggleReaction } = useMessageReactions(messageId);
  return (
    <div className="flex items-center gap-1" aria-label="Message reactions">
      {REACTIONS.map(({ id, label }) => {
        const active = reactions.has(id);
        return (
          <button
            key={id}
            type="button"
            onClick={() => toggleReaction(id)}
            className={`inline-flex min-h-[36px] min-w-[36px] items-center justify-center rounded-full border text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-oa-blue focus-visible:ring-offset-2 ${
              active ? "border-oa-blue/30 bg-oa-blue/10 text-oa-blue" : "border-oa-border bg-oa-surface/80 text-oa-text-muted hover:text-oa-text"
            }`}
            aria-label={active ? `Remove ${label} reaction` : `React with ${label}`}
            aria-pressed={active}
          >
            <span aria-hidden="true">{id}</span>
          </button>
        );
      })}
    </div>
  );
}
