import { useEffect, useRef, useState, type ReactNode } from "react";
import { Check, Copy, Fingerprint, IdCard, Loader2, Mail, Smartphone, User, Wifi } from "lucide-react";
import { useCloudStatus, useCurrentProfile } from "../../hooks/queries";

interface ProfileDetailsProps {
  header?: ReactNode;
  className?: string;
}

export function ProfileDetails({ header, className = "p-3" }: ProfileDetailsProps) {
  const { data: profile, isLoading: profileLoading } = useCurrentProfile();
  const { data: cloudStatus, isLoading: cloudLoading } = useCloudStatus();
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const copyTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (copyTimerRef.current !== null) {
        window.clearTimeout(copyTimerRef.current);
      }
    };
  }, []);

  if (profileLoading || cloudLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-5 w-5 animate-spin text-oa-text-muted" />
      </div>
    );
  }

  const user = profile?.user;
  const cloud = cloudStatus?.cloud;

  function copyToClipboard(value: string, id: string) {
    navigator.clipboard.writeText(value);
    setCopiedId(id);
    if (copyTimerRef.current !== null) {
      window.clearTimeout(copyTimerRef.current);
    }
    copyTimerRef.current = window.setTimeout(() => {
      copyTimerRef.current = null;
      setCopiedId(null);
    }, 1500);
  }

  return (
    <div className={`flex flex-col gap-3 ${className}`}>
      {header}

      <h3 className="text-xs font-semibold uppercase tracking-wider text-oa-text-muted">User Profile</h3>

      {user && (
        <div className="space-y-2">
          <ProfileRow icon={User} label="Name" value={user.display_name} />
          <ProfileRow icon={Mail} label="Email" value={user.email} />
          <ProfileRowCopy
            icon={IdCard}
            label="User ID"
            value={user.user_id}
            copiedId={copiedId}
            onCopy={copyToClipboard}
          />
          <ProfileRow
            icon={Wifi}
            label="Status"
            value={user.status === "enrolled" ? "Enrolled (cloud connected)" : user.status === "authenticated" ? "Connected - Needs enrollment" : user.status}
            color={user.status === "enrolled" ? "text-oa-green" : "text-oa-amber"}
          />
        </div>
      )}

      {cloud && (
        <>
          <h3 className="mt-2 text-xs font-semibold uppercase tracking-wider text-oa-text-muted">Device & Agent</h3>
          <div className="space-y-2">
            <ProfileRowCopy icon={Smartphone} label="Device ID" value={cloud.deviceId ?? "-"} copiedId={copiedId} onCopy={copyToClipboard} />
            <ProfileRowCopy icon={Fingerprint} label="Agent ID" value={cloud.agentId ?? "-"} copiedId={copiedId} onCopy={copyToClipboard} />
            <ProfileRowCopy icon={Fingerprint} label="Agent Instance" value={cloud.agentInstanceId ?? "-"} copiedId={copiedId} onCopy={copyToClipboard} />
            <ProfileRow
              icon={Wifi}
              label="Connection"
              value={cloud.status === "enrolled" ? "Online" : cloud.status === "authenticated" ? "Authenticated" : "Disconnected"}
              color={cloud.status === "enrolled" ? "text-oa-green" : cloud.status === "authenticated" ? "text-oa-blue" : "text-oa-amber"}
            />
          </div>
        </>
      )}

      {!user && !cloud && (
        <p className="text-xs text-oa-text-disabled">No profile data available</p>
      )}
    </div>
  );
}

function ProfileRow({ icon: Icon, label, value, color }: { icon: typeof User; label: string; value: string; color?: string }) {
  return (
    <div className="flex items-center gap-2.5 rounded-md bg-oa-surface px-2.5 py-1.5">
      <Icon className="h-3.5 w-3.5 shrink-0 text-oa-text-muted" />
      <div className="flex min-w-0 flex-1 items-center justify-between gap-2">
        <span className="text-[11px] text-oa-text-muted">{label}</span>
        <span className={`truncate text-[11px] font-medium ${color ?? "text-oa-text"}`}>
          {value}
        </span>
      </div>
    </div>
  );
}

function ProfileRowCopy({ icon: Icon, label, value, copiedId, onCopy }: { icon: typeof User; label: string; value: string; copiedId: string | null; onCopy: (value: string, id: string) => void }) {
  const isCopied = copiedId === label;
  return (
    <div className="flex items-center gap-2.5 rounded-md bg-oa-surface px-2.5 py-1.5">
      <Icon className="h-3.5 w-3.5 shrink-0 text-oa-text-muted" />
      <div className="flex min-w-0 flex-1 items-center justify-between gap-2">
        <span className="text-[11px] text-oa-text-muted">{label}</span>
        <span className="flex items-center gap-1.5">
          <span className="max-w-[120px] truncate text-[11px] font-mono text-oa-text">
            {value.length > 14 ? `${value.slice(0, 6)}...${value.slice(-4)}` : value}
          </span>
          <button
            type="button"
            onClick={() => onCopy(value, label)}
            className="shrink-0 rounded p-0.5 text-oa-text-muted transition-colors hover:bg-oa-surface-2 hover:text-oa-text"
            title={`Copy ${label}`}
            aria-label={`Copy ${label}`}
          >
            {isCopied ? <Check className="h-3 w-3 text-oa-green" /> : <Copy className="h-3 w-3" />}
          </button>
        </span>
      </div>
    </div>
  );
}
