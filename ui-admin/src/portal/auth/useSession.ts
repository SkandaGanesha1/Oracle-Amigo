import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError } from "../api/client";
import { fetchMe } from "./api";
import type { AdminSessionUser, LoginResponse, RecoveryVerifyResponse, SetupCompleteResponse } from "./types";

export type SessionStatus = "loading" | "unauthenticated" | "authenticated" | "error";

export interface SessionState {
  status: SessionStatus;
  user: AdminSessionUser | null;
  idleExpiresAt: number | null;
  absoluteExpiresAt: number | null;
  lastError: string | null;
  refresh: () => Promise<void>;
  applyLogin: (user: AdminSessionUser) => void;
  clear: (reason?: string) => void;
  setError: (message: string) => void;
}

const IDLE_MS = 60 * 60 * 1000;
const ABSOLUTE_MS = 8 * 60 * 60 * 1000;

function defaultExpiry(now: number, ms: number): number {
  return now + ms;
}

export function useSession(): SessionState {
  const [status, setStatus] = useState<SessionStatus>("loading");
  const [user, setUser] = useState<AdminSessionUser | null>(null);
  const [idleExpiresAt, setIdleExpiresAt] = useState<number | null>(null);
  const [absoluteExpiresAt, setAbsoluteExpiresAt] = useState<number | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);
  const idleTimerRef = useRef<number | null>(null);
  const absoluteTimerRef = useRef<number | null>(null);

  const clearIdleTimer = () => {
    if (idleTimerRef.current !== null) {
      window.clearTimeout(idleTimerRef.current);
      idleTimerRef.current = null;
    }
  };
  const clearAbsoluteTimer = () => {
    if (absoluteTimerRef.current !== null) {
      window.clearTimeout(absoluteTimerRef.current);
      absoluteTimerRef.current = null;
    }
  };

  const handleExpiry = useCallback((kind: "idle" | "absolute") => {
    setLastError(`Session expired (${kind}). Please sign in again.`);
    setStatus("unauthenticated");
    setUser(null);
    setIdleExpiresAt(null);
    setAbsoluteExpiresAt(null);
  }, []);

  const scheduleIdleExpiry = useCallback(
    (ms: number) => {
      clearIdleTimer();
      if (ms <= 0) {
        handleExpiry("idle");
        return;
      }
      idleTimerRef.current = window.setTimeout(() => handleExpiry("idle"), ms);
    },
    [handleExpiry]
  );

  const scheduleAbsoluteExpiry = useCallback(
    (ms: number) => {
      clearAbsoluteTimer();
      if (ms <= 0) {
        handleExpiry("absolute");
        return;
      }
      absoluteTimerRef.current = window.setTimeout(() => handleExpiry("absolute"), ms);
    },
    [handleExpiry]
  );

  const refresh = useCallback(async () => {
    try {
      const res = await fetchMe();
      const now = Date.now();
      setUser(res.user);
      setStatus("authenticated");
      setLastError(null);
      setIdleExpiresAt(defaultExpiry(now, IDLE_MS));
      setAbsoluteExpiresAt(defaultExpiry(now, ABSOLUTE_MS));
      scheduleIdleExpiry(IDLE_MS);
      scheduleAbsoluteExpiry(ABSOLUTE_MS);
    } catch (err) {
      if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
        setStatus("unauthenticated");
        setUser(null);
        setIdleExpiresAt(null);
        setAbsoluteExpiresAt(null);
      } else if (err instanceof ApiError && err.status === 0) {
        setStatus("unauthenticated");
        setLastError(err.message);
      } else {
        setStatus("unauthenticated");
        setLastError(err instanceof Error ? err.message : String(err));
      }
    }
  }, [scheduleIdleExpiry, scheduleAbsoluteExpiry]);

  useEffect(() => {
    void refresh();
    return () => {
      clearIdleTimer();
      clearAbsoluteTimer();
    };
  }, [refresh]);

  useEffect(() => {
    const onApiError = (event: Event) => {
      const detail = (event as CustomEvent<{ status: number; message: string }>).detail;
      if (!detail) return;
      if (detail.status === 401 || detail.status === 403) {
        setStatus("unauthenticated");
        setUser(null);
        setIdleExpiresAt(null);
        setAbsoluteExpiresAt(null);
        setLastError(detail.message ?? "Session expired.");
        clearIdleTimer();
        clearAbsoluteTimer();
      }
    };
    window.addEventListener("oracle-amigo.admin.api-error", onApiError as EventListener);
    return () => window.removeEventListener("oracle-amigo.admin.api-error", onApiError as EventListener);
  }, []);

  const applyLogin = useCallback(
    (loggedInUser: AdminSessionUser) => {
      const now = Date.now();
      setUser(loggedInUser);
      setStatus("authenticated");
      setIdleExpiresAt(defaultExpiry(now, IDLE_MS));
      setAbsoluteExpiresAt(defaultExpiry(now, ABSOLUTE_MS));
      setLastError(null);
      scheduleIdleExpiry(IDLE_MS);
      scheduleAbsoluteExpiry(ABSOLUTE_MS);
    },
    [scheduleIdleExpiry, scheduleAbsoluteExpiry]
  );

  const clear = useCallback((reason?: string) => {
    setStatus("unauthenticated");
    setUser(null);
    setIdleExpiresAt(null);
    setAbsoluteExpiresAt(null);
    if (reason) setLastError(reason);
    clearIdleTimer();
    clearAbsoluteTimer();
  }, []);

  const setError = useCallback((message: string) => {
    setStatus("error");
    setLastError(message);
  }, []);

  return { status, user, idleExpiresAt, absoluteExpiresAt, lastError, refresh, applyLogin, clear, setError };
}
