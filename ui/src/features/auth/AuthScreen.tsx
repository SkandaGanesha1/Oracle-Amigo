import { useState, useCallback, useEffect } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { Bot } from "lucide-react";
import { api } from "../../api/client";
import { useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "../../hooks/queries";
import { SignupForm } from "./SignupForm";
import { LoginForm } from "./LoginForm";
import type { SignupInput, LoginInput } from "./schemas";
import { markCloudUserReady, resetCloudUserSession, useCloudUserSession } from "../../api/cloudUserSessionStore";

type AuthMode = "signup" | "login";
type AuthFlowState = "idle" | "connecting" | "signed_up" | "logging_in" | "enrolled" | "redirect_to_chat";

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

  function switchMode() {
    const next = mode === "login" ? "signup" : "login";
    setMode(next);
    setError(null);
    setFlowState("idle");
    navigate(next === "signup" ? "/signup" : "/login", { replace: true });
  }

  const isProcessing = flowState !== "idle";

  return (
    <div className="relative mx-auto flex min-h-full w-full max-w-md flex-col items-center justify-center overflow-hidden px-5 py-10 sm:px-8">
      <div className="pointer-events-none absolute inset-0 opacity-80 [background:radial-gradient(circle_at_50%_12%,rgba(47,109,255,0.14),transparent_30%),radial-gradient(circle_at_50%_90%,rgba(120,75,255,0.1),transparent_34%)]" />
      <div className="relative flex w-full flex-col items-center gap-8">
      <div className="flex flex-col items-center gap-3">
        <span className="flex h-[62px] w-[62px] items-center justify-center rounded-[20px] border border-oa-blue/25 bg-gradient-to-br from-oa-blue/20 to-oa-purple/25 shadow-[0_16px_50px_rgba(49,109,255,0.22)]">
          <Bot className="h-6 w-6 text-oa-blue" />
        </span>
        <h1 className="text-[28px] font-bold leading-tight text-oa-text">Oracle Amigo</h1>
        <p className="text-center text-base text-oa-text-muted">
          {mode === "login" ? "Log in to your control plane" : "Create a control plane account"}
        </p>
      </div>

      <div className="flex w-full rounded-[10px] border border-oa-border-strong bg-oa-surface-2 p-1 shadow-[0_18px_60px_rgba(0,0,0,0.32)]" role="tablist" aria-label="Auth mode">
        <button
          role="tab"
          aria-selected={mode === "login"}
          type="button"
          onClick={() => mode !== "login" && switchMode()}
          className={`flex min-h-11 flex-1 items-center justify-center rounded-[8px] px-4 text-base font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-oa-blue ${
            mode === "login"
              ? "bg-oa-blue text-white shadow-sm"
              : "text-oa-text hover:bg-white/[0.03]"
          }`}
        >
          Log In
        </button>
        <button
          role="tab"
          aria-selected={mode === "signup"}
          type="button"
          onClick={() => mode !== "signup" && switchMode()}
          className={`flex min-h-11 flex-1 items-center justify-center rounded-[8px] px-4 text-base font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-oa-blue ${
            mode === "signup"
              ? "bg-oa-blue text-white shadow-sm"
              : "text-oa-text hover:bg-white/[0.03]"
          }`}
        >
          Sign Up
        </button>
      </div>

        {mode === "signup" && (
          <SignupForm onSubmit={handleSignup} isLoading={isProcessing} error={error} />
        )}

        {mode === "login" && (
          <LoginForm onSubmit={handleLogin} isLoading={isProcessing} error={error} />
        )}

        {flowState !== "idle" && (
          <p className="text-center text-xs text-oa-text-muted" role="status" aria-live="polite">
            {flowState === "connecting" && "Creating your account..."}
            {flowState === "signed_up" && "Account created. Signing you in..."}
            {flowState === "logging_in" && "Authenticating..."}
            {flowState === "enrolled" && "Opening Oracle Amigo..."}
          </p>
        )}
      </div>
    </div>
  );
}
