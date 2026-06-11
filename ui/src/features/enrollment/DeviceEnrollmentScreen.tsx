import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { ApiRequestError } from "../../api/localAgentClient";
import { api } from "../../api/client";
import { queryKeys, useCloudStatus, useResetDeviceIdentity } from "../../hooks/queries";
import { OracleButton } from "../../components/primitives/OracleButton";
import { OracleSurface } from "../../components/primitives/OracleSurface";
import { DeviceFingerprintCard } from "./DeviceFingerprintCard";
import { AgentRegistrationCard } from "./AgentRegistrationCard";
import { CapabilitiesReview } from "./CapabilitiesReview";
import { HeartbeatStatusCard } from "./HeartbeatStatusCard";
import { LogoutButton } from "../auth/LogoutButton";

type EnrollmentState = "idle" | "enrolling" | "success" | "error";

export function DeviceEnrollmentScreen() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: cloudStatus } = useCloudStatus();
  const resetDeviceIdentity = useResetDeviceIdentity();
  const [agentDisplayName, setAgentDisplayName] = useState("Oracle Amigo Local Agent");
  const [enrollmentState, setEnrollmentState] = useState<EnrollmentState>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [conflictFingerprint, setConflictFingerprint] = useState<string | null>(null);
  const [heartbeatRunning, setHeartbeatRunning] = useState(false);
  const [relayPolling, setRelayPolling] = useState(false);
  const [enrolled, setEnrolled] = useState(false);

  const deviceName = typeof navigator !== "undefined" ? navigator.platform || "Local Device" : "Unknown";
  const os = typeof navigator !== "undefined" ? navigator.userAgent.includes("Windows") ? "Windows" : navigator.userAgent.includes("Mac") ? "macOS" : "Linux" : "Unknown";
  const fingerprint = "pending...";
  const did = undefined;

  async function handleEnroll() {
    setEnrollmentState("enrolling");
    setErrorMessage(null);
    setErrorCode(null);
    setConflictFingerprint(null);
    try {
      await api.enroll({
        device_name: deviceName,
        agent_display_name: agentDisplayName,
        capabilities: ["a2a.v1", "file.request.search", "file.transfer.offer", "file.transfer.receive", "human.approval.request"],
      });
      setEnrolled(true);
      setHeartbeatRunning(true);
      setRelayPolling(true);
      setEnrollmentState("success");

      const status = await api.cloudStatus();
      queryClient.setQueryData(queryKeys.cloudStatus, status);
      setHeartbeatRunning(status.heartbeat.running);
      setRelayPolling(status.inbox.running);
      navigate("/inbox", { replace: true });
    } catch (err) {
      setEnrollmentState("error");
      setErrorMessage(err instanceof Error ? err.message : "Enrollment failed. Please try again.");
      if (err instanceof ApiRequestError && err.details && typeof err.details === "object") {
        const details = err.details as Record<string, unknown>;
        setErrorCode(typeof details.error === "string" ? details.error : null);
        const recovery = details.recovery && typeof details.recovery === "object" ? details.recovery as Record<string, unknown> : null;
        setConflictFingerprint(typeof recovery?.localPublicKeyFingerprint === "string" ? recovery.localPublicKeyFingerprint : null);
      }
    }
  }

  async function handleResetAndEnroll() {
    setEnrollmentState("enrolling");
    setErrorMessage(null);
    try {
      await resetDeviceIdentity.mutateAsync();
      await handleEnroll();
    } catch (err) {
      setEnrollmentState("error");
      setErrorMessage(err instanceof Error ? err.message : "Unable to reset this local device identity.");
    }
  }

  const hasDeviceKeyConflict = errorCode === "DEVICE_KEY_OWNED_BY_OTHER_USER";

  return (
    <div className="mx-auto flex min-h-full w-full max-w-2xl flex-col gap-6 px-6 py-8">
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1.5">
          <h1 className="text-xl font-bold text-oa-text">Enroll Device</h1>
          <p className="text-sm text-oa-text-muted">
            Register this device and agent with the control plane
          </p>
        </div>
        <LogoutButton />
      </div>

      <DeviceFingerprintCard
        deviceName={deviceName}
        os={os}
        fingerprint={fingerprint}
        did={did}
      />

      <AgentRegistrationCard
        displayName={agentDisplayName}
        onDisplayNameChange={setAgentDisplayName}
      />

      <CapabilitiesReview />

      {enrollmentState === "error" && (
        <OracleSurface elevation="card" className="space-y-3 border-oa-red/30 bg-oa-red/10 p-3">
          <div className="space-y-1">
            <p className="text-xs text-oa-red">{errorMessage}</p>
            {hasDeviceKeyConflict && (
              <p className="text-xs text-oa-text-muted">
                This local device key is already bound to another account on {cloudStatus?.cloud.controlPlaneUrl ?? "the control plane"}.
                {conflictFingerprint ? ` Fingerprint: ${conflictFingerprint}.` : ""}
              </p>
            )}
          </div>
          {hasDeviceKeyConflict && (
            <OracleButton
              oaVariant="secondary"
              className="h-9"
              isPending={resetDeviceIdentity.isPending}
              isDisabled={resetDeviceIdentity.isPending}
              onPress={handleResetAndEnroll}
            >
              Reset local device identity and enroll
            </OracleButton>
          )}
        </OracleSurface>
      )}

      {enrollmentState === "success" && (
        <HeartbeatStatusCard
          heartbeatRunning={heartbeatRunning}
          relayPolling={relayPolling}
          enrolled={enrolled}
        />
      )}

      <div className="sticky bottom-0 -mx-6 mt-auto border-t border-oa-border bg-oa-bg/90 px-6 py-4 backdrop-blur">
        <OracleButton
          oaVariant="primary"
          className="h-10 w-full"
          isDisabled={enrollmentState === "enrolling" || enrollmentState === "success"}
          isPending={enrollmentState === "enrolling"}
          onPress={handleEnroll}
        >
          {enrollmentState === "success" ? "Enrolled" : "Enroll Device"}
        </OracleButton>
      </div>

      {enrollmentState === "success" && (
        <p className="text-center text-xs text-oa-text-muted">
          Device enrolled successfully. Your agent is now visible in the directory.
        </p>
      )}
    </div>
  );
}
