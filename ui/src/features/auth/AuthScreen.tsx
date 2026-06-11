import { useState, useCallback, useEffect } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { Bot, Wifi } from "lucide-react";
import { api } from "../../api/client";
import { useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "../../hooks/queries";
import { SignupForm } from "./SignupForm";
import { LoginForm } from "./LoginForm";
import type { SignupInput, LoginInput } from "./schemas";

type AuthMode = "signup" | "login";
type AuthFlowState = "idle" | "connecting" | "signed_up" | "logging_in" | "enrolled" | "redirect_to_chat";

export function AuthScreen() {
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<AuthMode>(location.pathname === "/signup" ? "signup" : "login");
  const [flowState, setFlowState] = useState<AuthFlowState>("idle");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setMode(location.pathname === "/signup" ? "signup" : "login");
    setError(null);
    setFlowState("idle");
  }, [location.pathname]);

  const handleSignup = useCallback(async (input: SignupInput) => {
    setFlowState("connecting");
    setError(null);
    try {
      const signupBody: { email: string; password: string; display_name: string; control_plane_url?: string } = {
        email: input.email,
        password: input.password,
        display_name: input.displayName,
      };
      if (input.controlPlaneUrl) signupBody.control_plane_url = input.controlPlaneUrl;

      await api.signup(signupBody);
      setFlowState("signed_up");
      void queryClient.invalidateQueries({ queryKey: queryKeys.cloudStatus });

      await handleLogin({ email: input.email, password: input.password, controlPlaneUrl: input.controlPlaneUrl });
    } catch (err) {
      setFlowState("idle");
      setError(err instanceof Error ? err.message : "Signup failed. Please try again.");
    }
  }, [queryClient]);

  const handleLogin = useCallback(async (input: LoginInput) => {
    setFlowState("logging_in");
    setError(null);
    try {
      const loginBody: { email: string; password: string; control_plane_url?: string } = {
        email: input.email,
        password: input.password,
      };
      if (input.controlPlaneUrl) loginBody.control_plane_url = input.controlPlaneUrl;

      await api.login(loginBody);
      const status = await api.cloudStatus();
      queryClient.setQueryData(queryKeys.cloudStatus, status);
      setFlowState("enrolled");
      void queryClient.invalidateQueries({ queryKey: queryKeys.cloudStatus });

      navigate("/enroll");
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
    <div className="mx-auto flex min-h-full w-full max-w-sm flex-col items-center justify-center gap-8 p-6">
      <div className="flex flex-col items-center gap-3">
        <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-oa-blue/20 to-oa-purple/20 ring-1 ring-oa-blue/30">
          <Bot className="h-6 w-6 text-oa-blue" />
        </span>
        <h1 className="text-2xl font-bold text-oa-text">Oracle Amigo</h1>
        <p className="text-center text-sm text-oa-text-muted">
          {mode === "login" ? "Log in to your control plane" : "Create a control plane account"}
        </p>
      </div>

      <div className="flex w-full rounded-lg border border-oa-border bg-oa-surface p-0.5" role="tablist" aria-label="Auth mode">
        <button
          role="tab"
          aria-selected={mode === "login"}
          type="button"
          onClick={() => mode !== "login" && switchMode()}
          className={`flex-1 rounded-md px-4 py-2 text-sm font-medium transition-colors ${
            mode === "login"
              ? "bg-oa-blue text-white shadow-sm"
              : "text-oa-text-muted hover:text-oa-text"
          }`}
        >
          Log In
        </button>
        <button
          role="tab"
          aria-selected={mode === "signup"}
          type="button"
          onClick={() => mode !== "signup" && switchMode()}
          className={`flex-1 rounded-md px-4 py-2 text-sm font-medium transition-colors ${
            mode === "signup"
              ? "bg-oa-blue text-white shadow-sm"
              : "text-oa-text-muted hover:text-oa-text"
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

      <div className="flex items-center gap-2 text-xs text-oa-text-muted">
        <Wifi className={`h-3 w-3 ${isProcessing ? "text-oa-cyan animate-pulse" : ""}`} />
        <span>
          {flowState === "idle" && "Ready to connect"}
          {flowState === "connecting" && "Connecting to control plane..."}
          {flowState === "signed_up" && "Account created, logging in..."}
          {flowState === "logging_in" && "Authenticating..."}
          {flowState === "enrolled" && "Redirecting to device enrollment..."}
        </span>
      </div>
    </div>
  );
}
