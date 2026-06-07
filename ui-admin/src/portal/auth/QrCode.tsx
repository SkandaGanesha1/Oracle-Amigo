import { useEffect, useState, type FC } from "react";

interface Props {
  value: string;
  size?: number;
  className?: string;
}

export const QrCode: FC<Props> = ({ value, size = 192, className }) => {
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    import("qrcode")
      .then((mod) => mod.toDataURL(value, { errorCorrectionLevel: "M", margin: 1, width: size }))
      .then((url) => {
        if (!cancelled) setDataUrl(url);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "QR render failed");
      });
    return () => {
      cancelled = true;
    };
  }, [value, size]);

  if (error) {
    return (
      <div className={`flex items-center justify-center text-xs text-rose-200 ${className ?? ""}`}>
        {error}
      </div>
    );
  }
  if (!dataUrl) {
    return (
      <div
        className={`flex animate-pulse items-center justify-center rounded-md bg-white/5 ${className ?? ""}`}
        style={{ width: size, height: size }}
      >
        <span className="text-[10px] text-white/40">Rendering QR…</span>
      </div>
    );
  }
  return <img src={dataUrl} alt="TOTP provisioning QR" width={size} height={size} className={className} />;
};
