import { OracleSurface } from "../../components/primitives/OracleSurface";
import { OracleBadge } from "../../components/primitives/OracleBadge";

interface HeartbeatStatusCardProps {
  heartbeatRunning: boolean;
  relayPolling: boolean;
  enrolled: boolean;
}

export function HeartbeatStatusCard({ heartbeatRunning, relayPolling, enrolled }: HeartbeatStatusCardProps) {
  return (
    <OracleSurface elevation="card" className="space-y-3 p-4">
      <h3 className="text-sm font-semibold text-oa-text">Connection Status</h3>
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-xs text-oa-text-muted">Enrolled</span>
          <OracleBadge color={enrolled ? "success" : "default"} dot>
            {enrolled ? "Active" : "Pending"}
          </OracleBadge>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-xs text-oa-text-muted">Heartbeat</span>
          <OracleBadge color={heartbeatRunning ? "success" : "default"} dot>
            {heartbeatRunning ? "Running" : "Stopped"}
          </OracleBadge>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-xs text-oa-text-muted">Relay Polling</span>
          <OracleBadge color={relayPolling ? "accent" : "default"} dot>
            {relayPolling ? "Active" : "Inactive"}
          </OracleBadge>
        </div>
      </div>
    </OracleSurface>
  );
}
