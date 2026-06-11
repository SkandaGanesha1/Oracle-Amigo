import { AlertTriangle, ShieldCheck, Info } from "lucide-react";
import type { RiskScore } from "../../types";

interface RiskHeatmapProps {
  matchScore: number; // 0-1
  sensitivity: "low" | "medium" | "high" | "critical";
  fileSize: number; // bytes
  requesterVerified: boolean;
}

/**
 * Calculate risk score based on multiple factors
 * - Higher match score = lower risk
 * - Higher sensitivity = higher risk
 * - Larger file size = higher risk
 * - Unverified requester = higher risk
 */
function calculateRiskScore(props: RiskHeatmapProps): RiskScore {
  const { matchScore, sensitivity, fileSize, requesterVerified } = props;

  // Match score contribution (0-25 points): lower score = higher risk
  const matchRisk = (1 - matchScore) * 25;

  // Sensitivity contribution (0-30 points)
  const sensitivityRisk = ({
    low: 0,
    medium: 10,
    high: 20,
    critical: 30,
  } as const)[sensitivity] ?? 0;

  // File size contribution (0-25 points): log scale for large files
  const sizeRisk = Math.min(25, Math.log10(fileSize + 1) * 2);

  // Trust level contribution (0-20 points)
  const trustRisk = requesterVerified ? 0 : 20;

  const overall = Math.min(100, Math.round(matchRisk + sensitivityRisk + sizeRisk + trustRisk));

  const level: RiskScore["level"] = overall < 30 ? "low" : overall < 60 ? "medium" : "high";

  return {
    overall,
    factors: {
      matchScore: Math.round(matchRisk),
      sensitivity: sensitivityRisk,
      fileSize: Math.round(sizeRisk),
      trustLevel: trustRisk,
    },
    level,
  };
}

const levelConfig = {
  low: {
    color: "text-oa-green",
    bg: "bg-oa-green/10",
    bar: "bg-oa-green",
    icon: ShieldCheck,
    label: "Low risk",
  },
  medium: {
    color: "text-oa-amber",
    bg: "bg-oa-amber/10",
    bar: "bg-oa-amber",
    icon: AlertTriangle,
    label: "Medium risk",
  },
  high: {
    color: "text-oa-red",
    bg: "bg-oa-red/10",
    bar: "bg-oa-red",
    icon: AlertTriangle,
    label: "High risk",
  },
};

export function RiskHeatmap(props: RiskHeatmapProps) {
  const risk = calculateRiskScore(props);
  const config = levelConfig[risk.level];
  const Icon = config.icon;

  return (
    <div className="rounded-lg border border-oa-border bg-oa-bg-elevated/60 p-3">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <div className={`flex h-6 w-6 items-center justify-center rounded ${config.bg}`}>
            <Icon className={`h-3.5 w-3.5 ${config.color}`} />
          </div>
          <span className={`text-xs font-semibold ${config.color}`}>{config.label}</span>
        </div>
        <span className="text-[10px] text-oa-text-muted">Risk score: {risk.overall}/100</span>
      </div>

      {/* Risk gauge */}
      <div className="mb-3">
        <div className="h-2 w-full overflow-hidden rounded-full bg-oa-surface-2">
          <div
            className={`h-full rounded-full ${config.bar} transition-all duration-500`}
            style={{ width: `${risk.overall}%` }}
            role="progressbar"
            aria-valuenow={risk.overall}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={`Risk score: ${risk.overall} out of 100`}
          />
        </div>
      </div>

      {/* Risk factors breakdown */}
      <div className="space-y-1.5">
        <div className="flex items-center gap-2 text-[10px]">
          <span className="text-oa-text-muted w-20">Match score:</span>
          <div className="flex-1 h-1.5 rounded-full bg-oa-surface-2 overflow-hidden">
            <div
              className="h-full bg-oa-blue rounded-full"
              style={{ width: `${(1 - props.matchScore) * 100}%` }}
              role="presentation"
            />
          </div>
          <span className="text-oa-text-muted w-8 text-right">{risk.factors.matchScore}</span>
        </div>
        <div className="flex items-center gap-2 text-[10px]">
          <span className="text-oa-text-muted w-20">Sensitivity:</span>
          <div className="flex-1 h-1.5 rounded-full bg-oa-surface-2 overflow-hidden">
            <div
              className="h-full bg-oa-purple rounded-full"
              style={{ width: `${(risk.factors.sensitivity / 30) * 100}%` }}
              role="presentation"
            />
          </div>
          <span className="text-oa-text-muted w-8 text-right">{risk.factors.sensitivity}</span>
        </div>
        <div className="flex items-center gap-2 text-[10px]">
          <span className="text-oa-text-muted w-20">File size:</span>
          <div className="flex-1 h-1.5 rounded-full bg-oa-surface-2 overflow-hidden">
            <div
              className="h-full bg-oa-cyan rounded-full"
              style={{ width: `${(risk.factors.fileSize / 25) * 100}%` }}
              role="presentation"
            />
          </div>
          <span className="text-oa-text-muted w-8 text-right">{risk.factors.fileSize}</span>
        </div>
        <div className="flex items-center gap-2 text-[10px]">
          <span className="text-oa-text-muted w-20">Trust level:</span>
          <div className="flex-1 h-1.5 rounded-full bg-oa-surface-2 overflow-hidden">
            <div
              className="h-full bg-oa-amber rounded-full"
              style={{ width: `${(risk.factors.trustLevel / 20) * 100}%` }}
              role="presentation"
            />
          </div>
          <span className="text-oa-text-muted w-8 text-right">{risk.factors.trustLevel}</span>
        </div>
      </div>

      {/* Recommendation based on risk level */}
      {risk.level === "high" && (
        <div className="mt-2 flex items-start gap-1.5 rounded bg-oa-red/5 px-2 py-1.5">
          <AlertTriangle className="h-3 w-3 text-oa-red shrink-0 mt-0.5" />
          <p className="text-[10px] text-oa-red">
            Consider rejecting this request or requesting additional verification.
          </p>
        </div>
      )}
      {risk.level === "medium" && (
        <div className="mt-2 flex items-start gap-1.5 rounded bg-oa-amber/5 px-2 py-1.5">
          <Info className="h-3 w-3 text-oa-amber shrink-0 mt-0.5" />
          <p className="text-[10px] text-oa-amber">
            Review the file details and requester before approving.
          </p>
        </div>
      )}
    </div>
  );
}
