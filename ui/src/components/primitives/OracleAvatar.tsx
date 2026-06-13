import { Avatar, type AvatarProps } from "@heroui/react";
import { cn } from "~/lib/utils";

const gradientMap: Record<string, string> = {
  aqua: "from-cyan-200 via-sky-400 to-indigo-600",
  violet: "from-purple-200 via-fuchsia-500 to-indigo-700",
  coral: "from-rose-200 via-orange-400 to-red-600",
  blue: "from-sky-200 via-blue-500 to-violet-700",
  rose: "from-pink-200 via-rose-500 to-purple-700",
  mint: "from-emerald-100 via-teal-300 to-cyan-600",
  gold: "from-amber-100 via-yellow-400 to-orange-600",
  slate: "from-slate-200 via-slate-500 to-indigo-700",
};

function hashSeed(value: string): number {
  let total = 0;
  for (const char of value) total = (total * 31 + char.charCodeAt(0)) >>> 0;
  return total;
}

const tones = ["aqua", "violet", "coral", "blue", "rose", "mint", "gold", "slate"];

export function toneForSeed(seed: string): string {
  return tones[hashSeed(seed) % tones.length];
}

interface OracleAvatarProps extends Omit<AvatarProps, "color"> {
  seed?: string;
  tone?: string;
  initials?: string;
}

export function OracleAvatar({ seed, tone, initials, className, ...props }: OracleAvatarProps) {
  const resolvedTone = tone ?? (seed ? toneForSeed(seed) : "violet");
  const gradient = gradientMap[resolvedTone] ?? gradientMap.violet;
  return (
    <Avatar
      className={cn("shrink-0 bg-transparent", className)}
      {...props}
    >
      <Avatar.Fallback className={cn("oa-avatar-fallback flex h-full w-full items-center justify-center rounded-[inherit] border-none bg-gradient-to-br text-sm font-bold text-white", gradient)}>
        {initials ?? "OA"}
      </Avatar.Fallback>
    </Avatar>
  );
}
