import type { CSSProperties } from "react";

interface WaveformProps {
  active: boolean;
  level: number;
}

const BAR_COUNT = 21;

export function Waveform({ active, level }: WaveformProps) {
  const normalizedLevel = Math.max(0, Math.min(1, level));

  return (
    <div
      className={active ? "voice-wave-loader is-speaking" : "voice-wave-loader"}
      style={{ "--voice-level": normalizedLevel.toFixed(3) } as CSSProperties & Record<"--voice-level", string>}
      aria-hidden="true"
    >
      {Array.from({ length: BAR_COUNT }, (_, index) => {
        const centerDistance = Math.abs(index - Math.floor(BAR_COUNT / 2));
        return (
          <div
            key={index}
            className="voice-wave-bar"
            style={{ "--bar-index": String(centerDistance) } as CSSProperties & Record<"--bar-index", string>}
          />
        );
      })}
    </div>
  );
}
