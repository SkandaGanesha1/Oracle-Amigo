import { OracleSurface } from "../../components/primitives/OracleSurface";

interface Capability {
  id: string;
  label: string;
  description: string;
  required?: boolean;
}

const CAPABILITIES: Capability[] = [
  { id: "a2a.v1", label: "A2A v1.0", description: "Agent-to-Agent protocol messaging", required: true },
  { id: "file.request.search", label: "File Search", description: "Search and retrieve local files", required: true },
  { id: "file.transfer.offer", label: "File Transfer (Send)", description: "Send files to other agents", required: true },
  { id: "file.transfer.receive", label: "File Transfer (Receive)", description: "Receive files from other agents", required: true },
  { id: "human.approval.request", label: "Approval Workflow", description: "Request human approval before file transfer", required: true },
];

export function CapabilitiesReview() {
  return (
    <OracleSurface elevation="card" className="space-y-3 p-4">
      <h3 className="text-sm font-semibold text-oa-text">Agent Capabilities</h3>
      <div className="space-y-2">
        {CAPABILITIES.map((cap) => (
          <div key={cap.id} className="flex items-start gap-3 rounded-lg border border-oa-border bg-oa-bg-elevated p-2.5">
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium text-oa-text">{cap.label}</span>
                {cap.required && (
                  <span className="inline-flex items-center rounded-lg bg-oa-blue/15 px-2 py-0.5 text-[10px] font-medium text-oa-blue">Required</span>
                )}
              </div>
              <span className="text-[11px] text-oa-text-muted">{cap.description}</span>
            </div>
          </div>
        ))}
      </div>
    </OracleSurface>
  );
}
