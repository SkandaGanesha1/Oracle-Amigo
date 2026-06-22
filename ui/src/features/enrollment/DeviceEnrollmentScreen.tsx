import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { ApiRequestError } from "../../api/localAgentClient";
import { api } from "../../api/client";
import { queryKeys, useCloudStatus, useResetDeviceIdentity } from "../../hooks/queries";
import { AuthDotMatrixBackground } from "../auth/AuthDotMatrixBackground";
import { MiniNavbar } from "../auth/AuthShellNav";

type EnrollmentState = "idle" | "enrolling" | "success" | "error";

const ENROLLMENT_CAPABILITIES = [
  "a2a.v1",
  "file.request.search",
  "file.transfer.offer",
  "file.transfer.receive",
  "human.approval.request",
];

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

  const deviceName = typeof navigator !== "undefined" ? navigator.platform || "Local Device" : "Unknown";
  const os = typeof navigator !== "undefined" ? navigator.userAgent.includes("Windows") ? "Windows" : navigator.userAgent.includes("Mac") ? "macOS" : "Linux" : "Unknown";
  const fingerprint = "pending...";

  async function handleEnroll() {
    setEnrollmentState("enrolling");
    setErrorMessage(null);
    setErrorCode(null);
    setConflictFingerprint(null);
    try {
      await api.enroll({
        device_name: deviceName,
        agent_display_name: agentDisplayName,
        capabilities: ENROLLMENT_CAPABILITIES,
      });
      setEnrollmentState("success");

      const status = await api.cloudStatus();
      queryClient.setQueryData(queryKeys.cloudStatus, status);
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
  const isEnrolling = enrollmentState === "enrolling";

  return (
    <main className="oa-auth-screen oa-enroll-screen" aria-label="Device enrollment">
      <AuthDotMatrixBackground />
      <MiniNavbar showLogout />

      <section className="oa-enroll-content">
        <motion.form
          className="oa-enroll-panel"
          aria-label="Device enrollment form"
          initial={{ opacity: 0, x: -100 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.4, ease: "easeOut" }}
          onSubmit={(event) => {
            event.preventDefault();
            void handleEnroll();
          }}
        >
          <div className="oa-enroll-heading">
            <h1>Enroll Device</h1>
            <p>Register this device and agent with the control plane</p>
          </div>

          <section className="oa-enroll-section" aria-labelledby="device-identity-heading">
            <div className="oa-enroll-section-header">
              <h2 id="device-identity-heading">Device Identity</h2>
              <span>Local</span>
            </div>
            <dl className="oa-enroll-device-list">
              <div>
                <dt>Device Name</dt>
                <dd>{deviceName}</dd>
              </div>
              <div>
                <dt>OS</dt>
                <dd>{os}</dd>
              </div>
              <div>
                <dt>Public Key Fingerprint</dt>
                <dd>
                  <code>{fingerprint}</code>
                </dd>
              </div>
            </dl>
          </section>

          <section className="oa-enroll-section" aria-labelledby="personal-agent-heading">
            <div className="oa-enroll-section-header">
              <h2 id="personal-agent-heading">Personal Agent</h2>
            </div>
            <p className="oa-enroll-copy">
              This agent will be visible to other users in the directory and can handle file requests and transfers.
            </p>
            <div className="oa-auth-field">
              <label htmlFor="agent-display-name">Agent Display Name</label>
              <div className="oa-auth-input-shell">
                <input
                  id="agent-display-name"
                  className="oa-auth-input oa-enroll-input"
                  type="text"
                  autoComplete="organization-title"
                  value={agentDisplayName}
                  onChange={(event) => setAgentDisplayName(event.currentTarget.value)}
                  disabled={isEnrolling}
                />
              </div>
            </div>
          </section>

          {enrollmentState === "error" && (
            <div className="oa-enroll-feedback" role="alert">
              <p>{errorMessage}</p>
              {hasDeviceKeyConflict && (
                <p>
                  This local device key is already bound to another account on {cloudStatus?.cloud.controlPlaneUrl ?? "the control plane"}.
                  {conflictFingerprint ? ` Fingerprint: ${conflictFingerprint}.` : ""}
                </p>
              )}
              {hasDeviceKeyConflict && (
                <button
                  type="button"
                  className="oa-enroll-secondary-action"
                  disabled={resetDeviceIdentity.isPending || isEnrolling}
                  onClick={() => void handleResetAndEnroll()}
                >
                  {resetDeviceIdentity.isPending ? "Resetting..." : "Reset local device identity and enroll"}
                </button>
              )}
            </div>
          )}

          {enrollmentState === "success" && (
            <p className="oa-enroll-status" role="status" aria-live="polite">
              Device enrolled successfully. Opening Oracle Amigo...
            </p>
          )}

          <button
            type="submit"
            className="oa-auth-submit oa-enroll-submit"
            disabled={isEnrolling || enrollmentState === "success"}
          >
            {isEnrolling ? "Enrolling..." : enrollmentState === "success" ? "Enrolled" : "Enroll Device"}
          </button>
        </motion.form>
      </section>
    </main>
  );
}
