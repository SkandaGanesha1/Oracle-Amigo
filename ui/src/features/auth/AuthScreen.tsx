import { useState, useCallback, useEffect } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { api } from "../../api/client";
import { useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "../../hooks/queries";
import { SignupForm } from "./SignupForm";
import { LoginForm } from "./LoginForm";
import { AuthDotMatrixBackground } from "./AuthDotMatrixBackground";
import { MiniNavbar } from "./AuthShellNav";
import type { SignupInput, LoginInput } from "./schemas";
import { markCloudUserReady, resetCloudUserSession, useCloudUserSession } from "../../api/cloudUserSessionStore";

type AuthMode = "signup" | "login";
type AuthFlowState = "idle" | "connecting" | "signed_up" | "logging_in" | "enrolled";

export function AuthScreen() {
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const cloudSession = useCloudUserSession();
  const routeState = location.state as { cloudAuthMessage?: string } | null;
  const [mode, setMode] = useState<AuthMode>(location.pathname === "/signup" ? "signup" : "login");
  const [flowState, setFlowState] = useState<AuthFlowState>("idle");
  const [error, setError] = useState<string | null>(routeState?.cloudAuthMessage ?? cloudSession.message);

  useEffect(() => {
    setMode(location.pathname === "/signup" ? "signup" : "login");
    setError(routeState?.cloudAuthMessage ?? cloudSession.message);
    setFlowState("idle");
  }, [cloudSession.message, location.pathname, routeState?.cloudAuthMessage]);

  const handleSignup = useCallback(async (input: SignupInput) => {
    setFlowState("connecting");
    setError(null);
    try {
      const signupBody: { email: string; password: string; display_name: string } = {
        email: input.email,
        password: input.password,
        display_name: input.displayName,
      };

      await api.signup(signupBody);
      setFlowState("signed_up");
      void queryClient.invalidateQueries({ queryKey: queryKeys.cloudStatus });

      await handleLogin({ email: input.email, password: input.password });
    } catch (err) {
      setFlowState("idle");
      setError(err instanceof Error ? err.message : "Signup failed. Please try again.");
    }
  }, [queryClient]);

  const handleLogin = useCallback(async (input: LoginInput) => {
    setFlowState("logging_in");
    setError(null);
    try {
      const loginBody: { email: string; password: string } = {
        email: input.email,
        password: input.password,
      };

      resetCloudUserSession();
      await api.login(loginBody);
      const status = await api.cloudStatus();
      queryClient.setQueryData(queryKeys.cloudStatus, status);
      if (status.cloud.hasUserAccessToken && status.userAuthIssue == null) markCloudUserReady();
      setFlowState("enrolled");
      void queryClient.invalidateQueries({ queryKey: queryKeys.cloudStatus });

      const hasDeviceSession = Boolean(status.cloud.status === "enrolled" && status.cloud.hasDeviceAccessToken && status.tokenIssue !== "expired");
      navigate(hasDeviceSession ? "/inbox" : "/enroll", { replace: true });
    } catch (err) {
      setFlowState("idle");
      setError(err instanceof Error ? err.message : "Login failed. Please try again.");
    }
  }, [navigate, queryClient]);

  function switchMode(next: AuthMode = mode === "login" ? "signup" : "login") {
    if (next === mode) return;
    setError(null);
    setFlowState("idle");
    navigate(next === "signup" ? "/signup" : "/login", { replace: true });
  }

  const isProcessing = flowState !== "idle";

  return (
    <main className="oa-auth-screen" aria-label="Authentication and enrollment">
      <AuthDotMatrixBackground />
      <MiniNavbar mode={mode} onModeChange={switchMode} />

      <section className="oa-auth-content">
        <div className="oa-auth-card">
          <div className="oa-auth-heading">
            <h1>Welcome to Oracle Amigo</h1>
            <p>{mode === "login" ? "Sign in to continue" : "Create your account"}</p>
          </div>

          <AnimatePresence mode="wait">
            <motion.div
              key={mode}
              initial={{ opacity: 0, x: mode === "login" ? -100 : 100 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: mode === "login" ? -100 : 100 }}
              transition={{ duration: 0.4, ease: "easeOut" }}
              className="oa-auth-form-motion"
            >
              {mode === "signup" ? (
                <SignupForm onSubmit={handleSignup} isLoading={isProcessing} error={error} />
              ) : (
                <LoginForm onSubmit={handleLogin} isLoading={isProcessing} error={error} />
              )}
            </motion.div>
          </AnimatePresence>

          {flowState !== "idle" && (
            <p className="oa-auth-status" role="status" aria-live="polite">
              {flowState === "connecting" && "Creating your account..."}
              {flowState === "signed_up" && "Account created. Signing you in..."}
              {flowState === "logging_in" && "Authenticating..."}
              {flowState === "enrolled" && "Opening Oracle Amigo..."}
            </p>
          )}
        </div>
      </section>
    </main>
  );
}
