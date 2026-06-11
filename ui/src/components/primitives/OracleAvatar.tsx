import { Avatar, type AvatarProps } from "@heroui/react";
import { cn } from "~/lib/utils";

const gradientMap: Record<string, string> = {
  aqua: "from-cyan-400 via-purple-500 to-purple-800",
  violet: "from-purple-300 via-purple-600 to-purple-900",
  coral: "from-orange-200 via-red-400 to-red-700",
  blue: "from-cyan-200 via-blue-500 to-blue-800",
  rose: "from-pink-200 via-pink-500 to-purple-800",
};

function hashSeed(value: string): number {
  let total = 0;
  for (const char of value) total += char.charCodeAt(0);
  return total % 5;
}

const tones = ["aqua", "violet", "coral", "blue", "rose"];

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
      className={cn(`bg-gradient-to-br ${gradient} shrink-0`, className)}
      {...props}
    >
      <Avatar.Fallback className="text-white font-semibold text-sm">
        {initials ?? "OA"}
      </Avatar.Fallback>
    </Avatar>
  );
}
