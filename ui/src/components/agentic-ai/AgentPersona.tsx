import { Bot, Globe, Hash, Fingerprint, Shield, Lock, User } from "lucide-react";
import { OracleAvatar } from "../primitives/OracleAvatar";

interface AgentPersonaProps {
  name: string;
  agentId: string;
  agentInstanceId?: string;
  did?: string;
  capabilities?: string[];
  organization?: string;
  description?: string;
  agreedScope?: string;
  dataAccessBoundaries?: string[];
  ownerName?: string;
  className?: string;
}

export function AgentPersona({
  name,
  agentId,
  agentInstanceId,
  did,
  capabilities,
  organization,
  description,
  agreedScope,
  dataAccessBoundaries,
  ownerName,
  className,
}: AgentPersonaProps) {
  return (
    <div className={`rounded-xl border border-oa-border bg-oa-surface p-4 ${className ?? ""}`}>
      <div className="flex items-start gap-3">
        <OracleAvatar
          seed={agentId}
          initials={name.slice(0, 2).toUpperCase()}
          size="md"
          className="h-12 w-12 shrink-0"
        />
        <div className="min-w-0 flex-1">
          <h3 className="text-base font-semibold text-oa-text">{name}</h3>
          {organization && (
            <p className="text-xs text-oa-text-muted">{organization}</p>
          )}
        </div>
      </div>

      {description && (
        <p className="mt-3 text-sm text-oa-text-secondary">{description}</p>
      )}

      <div className="mt-3 space-y-1.5">
        <div className="flex items-center gap-2 text-xs text-oa-text-muted">
          <Hash className="h-3 w-3 shrink-0" />
          <span className="font-mono">{agentId}</span>
        </div>
        {agentInstanceId && (
          <div className="flex items-center gap-2 text-xs text-oa-text-muted">
            <Fingerprint className="h-3 w-3 shrink-0" />
            <span className="font-mono text-[10px]">{agentInstanceId}</span>
          </div>
        )}
        {did && (
          <div className="flex items-center gap-2 text-xs text-oa-text-muted">
            <Globe className="h-3 w-3 shrink-0" />
            <span className="font-mono text-[10px]">{did}</span>
          </div>
        )}
        {ownerName && (
          <div className="flex items-center gap-2 text-xs text-oa-text-muted">
            <User className="h-3 w-3 shrink-0" />
            <span>{ownerName}</span>
          </div>
        )}
      </div>

      {agreedScope && (
        <div className="mt-3 rounded-md border border-oa-blue/10 bg-oa-blue/5 px-3 py-2">
          <div className="flex items-center gap-1.5 mb-1">
            <Shield className="h-3.5 w-3.5 text-oa-blue" />
            <span className="text-[10px] font-medium text-oa-blue uppercase tracking-wider">Agreed Scope</span>
          </div>
          <p className="text-xs text-oa-text-secondary">{agreedScope}</p>
        </div>
      )}

      {dataAccessBoundaries && dataAccessBoundaries.length > 0 && (
        <div className="mt-2">
          <div className="flex items-center gap-1.5 mb-1.5">
            <Lock className="h-3 w-3 text-oa-text-muted" />
            <span className="text-[10px] font-medium text-oa-text-muted uppercase tracking-wider">Data Access Boundaries</span>
          </div>
          <ul className="space-y-1">
            {dataAccessBoundaries.map((boundary) => (
              <li key={boundary} className="flex items-start gap-1.5 text-[11px] text-oa-text-muted">
                <span className="mt-0.5 h-1 w-1 shrink-0 rounded-full bg-oa-text-disabled" />
                {boundary}
              </li>
            ))}
          </ul>
        </div>
      )}

      {capabilities && capabilities.length > 0 && (
        <div className="mt-3">
          <p className="mb-1.5 text-[11px] font-medium text-oa-text-muted uppercase tracking-wider">Capabilities</p>
          <div className="flex flex-wrap gap-1.5">
            {capabilities.map((cap) => (
              <span
                key={cap}
                className="rounded-md border border-oa-border bg-oa-bg-elevated px-2 py-0.5 text-[10px] font-medium text-oa-text-secondary"
              >
                {cap}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
