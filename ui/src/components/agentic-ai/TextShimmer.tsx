import { useState, useEffect, useRef } from "react";
import { Loader2 } from "lucide-react";

interface TextShimmerProps {
  text?: string;
  streaming?: boolean;
  speed?: number;
  className?: string;
}

export function TextShimmer({ text, streaming = false, speed = 30, className }: TextShimmerProps) {
  const [displayedLength, setDisplayedLength] = useState(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!text || !streaming) {
      setDisplayedLength(text?.length ?? 0);
      return;
    }
    setDisplayedLength(0);
    intervalRef.current = setInterval(() => {
      setDisplayedLength((prev) => {
        const next = prev + 1;
        if (next >= (text?.length ?? 0)) {
          if (intervalRef.current) clearInterval(intervalRef.current);
          return text?.length ?? 0;
        }
        return next;
      });
    }, speed);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [text, streaming, speed]);

  if (!text) {
    return (
      <span className={`inline-flex items-center gap-1 ${className ?? ""}`} aria-live="polite" aria-label="Generating response">
        <span className="h-3 w-0.5 animate-pulse bg-oa-blue" />
        <span className="h-3 w-0.5 animate-pulse bg-oa-blue" style={{ animationDelay: "200ms" }} />
        <span className="h-3 w-0.5 animate-pulse bg-oa-blue" style={{ animationDelay: "400ms" }} />
      </span>
    );
  }

  if (!streaming) {
    return <span className={className}>{text}</span>;
  }

  return (
    <span className={className}>
      {text.slice(0, displayedLength)}
      {displayedLength < text.length && (
        <span className="inline-block h-4 w-0.5 animate-pulse bg-oa-blue align-text-bottom ml-0.5" />
      )}
    </span>
  );
}
