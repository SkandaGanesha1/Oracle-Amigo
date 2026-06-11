import { Link2 } from "lucide-react";

interface AgentInlineCitationProps {
  index: number;
  label?: string;
  onClick?: () => void;
}

export function AgentInlineCitation({ index, label, onClick }: AgentInlineCitationProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-0.5 rounded bg-oa-blue/10 px-1 py-0.5 text-[10px] font-medium text-oa-blue align-middle transition hover:bg-oa-blue/20"
    >
      <Link2 className="h-2.5 w-2.5" />
      {label ?? `[${index}]`}
    </button>
  );
}
