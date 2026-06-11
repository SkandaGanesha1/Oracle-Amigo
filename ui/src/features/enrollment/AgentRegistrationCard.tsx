import { Input } from "@heroui/react";
import { OracleSurface } from "../../components/primitives/OracleSurface";

interface AgentRegistrationCardProps {
  displayName: string;
  onDisplayNameChange: (value: string) => void;
}

export function AgentRegistrationCard({ displayName, onDisplayNameChange }: AgentRegistrationCardProps) {
  return (
    <OracleSurface elevation="card" className="space-y-3 p-4">
      <h3 className="text-sm font-semibold text-oa-text">Personal Agent</h3>
      <p className="text-xs text-oa-text-muted">
        This agent will be visible to other users in the directory and can handle file requests and transfers.
      </p>
      <div className="flex flex-col gap-1">
        <label className="text-xs text-oa-text-muted" htmlFor="agent-display-name">Agent Display Name</label>
        <Input
          id="agent-display-name"
          placeholder="Oracle Amigo Local Agent"
          value={displayName}
          onChange={(e) => onDisplayNameChange(e.currentTarget.value)}
        />
      </div>
    </OracleSurface>
  );
}
