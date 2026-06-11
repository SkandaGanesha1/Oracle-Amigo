import { OracleSurface } from "../../components/primitives/OracleSurface";

interface DeviceFingerprintCardProps {
  deviceName: string;
  os: string;
  fingerprint: string;
  did?: string;
}

export function DeviceFingerprintCard({ deviceName, os, fingerprint, did }: DeviceFingerprintCardProps) {
  return (
    <OracleSurface elevation="card" className="space-y-3 p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-oa-text">Device Identity</h3>
        <span className="inline-flex items-center rounded-full bg-oa-surface-2 px-2.5 py-0.5 text-xs font-medium text-oa-text-muted">Local</span>
      </div>
      <div className="space-y-2">
        <div className="flex justify-between">
          <span className="text-xs text-oa-text-muted">Device Name</span>
          <span className="text-xs text-oa-text">{deviceName}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-xs text-oa-text-muted">OS</span>
          <span className="text-xs text-oa-text">{os}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-xs text-oa-text-muted">Public Key Fingerprint</span>
          <code className="max-w-[180px] truncate text-xs text-oa-cyan">{fingerprint}</code>
        </div>
        {did && (
          <div className="flex justify-between">
            <span className="text-xs text-oa-text-muted">DID</span>
            <code className="max-w-[180px] truncate text-xs text-oa-text-secondary">{did}</code>
          </div>
        )}
      </div>
    </OracleSurface>
  );
}
