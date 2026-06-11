import { CalendarDays } from "lucide-react";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function formatDateLabel(date: Date): string {
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const day = 86400000;

  if (diff < day && date.getDate() === now.getDate()) return "Today";
  if (diff < 2 * day && date.getDate() === now.getDate() - 1) return "Yesterday";
  return `${MONTHS[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()}`;
}

interface DateSeparatorProps {
  date: Date;
}

export function DateSeparator({ date }: DateSeparatorProps) {
  return (
    <div className="flex items-center gap-3 px-4 py-2">
      <div className="flex-1 border-t border-oa-border" />
      <div className="flex items-center gap-1.5 rounded-full bg-oa-surface px-3 py-1 text-[11px] font-medium text-oa-text-muted">
        <CalendarDays className="h-3 w-3" />
        {formatDateLabel(date)}
      </div>
      <div className="flex-1 border-t border-oa-border" />
    </div>
  );
}
