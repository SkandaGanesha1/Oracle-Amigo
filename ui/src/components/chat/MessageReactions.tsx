import { Heart, Laugh, Sparkles, ThumbsUp } from "lucide-react";
import { useMessageReactions } from "../../lib/messageReactions";

interface MessageReactionsProps {
  messageId: string;
}

const REACTIONS = [
  { id: "like", icon: ThumbsUp, label: "Like" },
  { id: "love", icon: Heart, label: "Love" },
  { id: "smile", icon: Laugh, label: "Smile" },
  { id: "celebrate", icon: Sparkles, label: "Celebrate" }
];

export function MessageReactions({ messageId }: MessageReactionsProps) {
  const { reactions, toggleReaction } = useMessageReactions(messageId);
  return (
    <div className="flex items-center gap-1" aria-label="Message reactions">
      {REACTIONS.map(({ id, icon: Icon, label }) => {
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
            <Icon className="h-3.5 w-3.5" />
          </button>
        );
      })}
    </div>
  );
}
