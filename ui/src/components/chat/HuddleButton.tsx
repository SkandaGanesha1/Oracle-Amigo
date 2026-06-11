import { Mic } from "lucide-react";

interface HuddleButtonProps {
  onStart?: () => void;
}

export function HuddleButton({ onStart }: HuddleButtonProps) {
  return (
    <button
      type="button"
      onClick={onStart}
      className="inline-flex min-h-[48px] min-w-[48px] items-center justify-center rounded-lg text-oa-text-muted transition-colors hover:bg-oa-surface hover:text-oa-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-oa-blue focus-visible:ring-offset-2"
      aria-label="Start huddle"
      title="Start huddle"
    >
      <Mic className="h-4 w-4" />
    </button>
  );
}
