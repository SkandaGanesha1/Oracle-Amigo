import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import * as Sentry from "@sentry/react";
import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Clipboard, Home, LogIn, RefreshCw } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import { getCloudUserSessionSnapshot } from "../api/cloudUserSessionStore";
import { getLocalUiSessionSnapshot } from "../api/localUiSessionStore";
import { queryKeys } from "../hooks/queries";
import type { AppSection } from "./SectionContext";

const DEFAULT_WATCHDOG_DELAY_MS = 2500;
const ROUTE_CONTENT_SELECTOR = "[data-app-route-content]";

export interface BlankShellDiagnostics {
  detectedAt: string;
  href: string;
  pathname: string;
  section: AppSection;
  reason: string;
  duplicateMainContentCount: number;
  localUiSession: SessionSummary;
  cloudUserSession: SessionSummary;
  cloudStatus: CloudStatusSummary | null;
  mainContent: DomMetrics;
  routeContent: DomMetrics;
  queries: Array<{
    keyGroup: string;
    status: string;
    fetchStatus: string;
    failureCount: number;
    error: string | null;
  }>;
}

interface DomMetrics {
  exists: boolean;
  textLength: number;
  childElementCount: number;
  opacity: string | null;
  width: number;
  height: number;
  display: string | null;
  visibility: string | null;
}

interface SessionSummary {
  status: string;
  issue?: string | null;
  message?: string | null;
  generation?: number;
}

interface CloudStatusSummary {
  cloud: {
    status: string | null;
    hasUserCredential: boolean | null;
    hasDeviceCredential: boolean | null;
    hasRefreshCredential: boolean | null;
  };
  heartbeat: { running: boolean | null; lastError: string | null };
  inbox: { running: boolean | null; lastItemCount: number | null; lastError: string | null };
  credentialIssue?: string | null;
  canRecoverDeviceCredential?: boolean | null;
  userAuthIssue?: string | null;
  canRecoverUserCredential?: boolean | null;
  relayMode?: string | null;
  controlPlane?: {
    reachable: boolean | null;
    status: string | null;
    matchesConfigured: boolean | null;
    message: string | null;
  };
}

interface AppShellContentWatchdogProps {
  children: ReactNode;
  mainContentId?: string;
  section: AppSection;
  delayMs?: number;
}

export function AppShellContentWatchdog({
  children,
  delayMs = DEFAULT_WATCHDOG_DELAY_MS,
  mainContentId = "main-content",
  section,
}: AppShellContentWatchdogProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [diagnostics, setDiagnostics] = useState<BlankShellDiagnostics | null>(null);
  const reportedKeyRef = useRef<string | null>(null);

  useEffect(() => {
    setDiagnostics(null);
    const routeKey = `${location.pathname}${location.search}`;
    const timer = window.setTimeout(() => {
      const next = collectBlankShellDiagnostics({
        location,
        mainContentId,
        queryClient,
        section,
      });
      if (!next) return;

      setDiagnostics(next);
      if (reportedKeyRef.current === routeKey) return;
      reportedKeyRef.current = routeKey;
      console.warn("Blank shell content detected", next);
      Sentry.captureMessage("Blank shell content detected", {
        level: "warning",
        contexts: {
          route: {
            href: next.href,
            pathname: next.pathname,
            section: next.section,
            reason: next.reason,
          },
          localUiSession: { snapshot: next.localUiSession },
          cloudUserSession: { snapshot: next.cloudUserSession },
          mainContent: { ...next.mainContent },
          routeContent: { ...next.routeContent },
          queries: {
            states: next.queries,
          },
        },
      });
    }, delayMs);
    return () => window.clearTimeout(timer);
  }, [delayMs, location, mainContentId, queryClient, section]);

  const diagnosticsText = useMemo(() => {
    if (!diagnostics) return "";
    return JSON.stringify(diagnostics, null, 2);
  }, [diagnostics]);

  async function copyDiagnostics() {
    if (!diagnosticsText) return;
    try {
      await navigator.clipboard.writeText(diagnosticsText);
    } catch {
      console.warn("Unable to copy blank-shell diagnostics; diagnostics follow.", diagnostics);
    }
  }

  return (
    <>
      {children}
      {diagnostics && (
        <section className="flex min-h-0 flex-1 items-center justify-center bg-oa-bg p-6 text-oa-text" role="alert">
          <div className="w-full max-w-xl rounded-lg border border-oa-amber/30 bg-oa-surface p-5 shadow-xl">
            <div className="flex items-start gap-3">
              <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-oa-amber/10 text-oa-amber">
                <AlertTriangle className="h-5 w-5" />
              </span>
              <div className="min-w-0 flex-1">
                <h1 className="text-base font-semibold text-oa-text">Main content did not render</h1>
                <p className="mt-1 text-sm text-oa-text-muted">
                  The app shell is alive, but this route did not produce visible page content. Diagnostics were sent to the browser console and Sentry.
                </p>
                <div className="mt-4 flex flex-wrap gap-2">
                  <button type="button" onClick={() => window.location.reload()} className="inline-flex min-h-[40px] items-center gap-2 rounded-md bg-oa-blue px-3 py-2 text-sm font-medium text-white hover:bg-oa-blue/90">
                    <RefreshCw className="h-4 w-4" />
                    Reload app
                  </button>
                  <button type="button" onClick={() => navigate("/inbox", { replace: true })} className="inline-flex min-h-[40px] items-center gap-2 rounded-md border border-oa-border bg-oa-bg-elevated px-3 py-2 text-sm font-medium text-oa-text hover:bg-oa-surface">
                    <Home className="h-4 w-4" />
                    Go to Inbox
                  </button>
                  <button type="button" onClick={() => navigate("/login", { replace: true })} className="inline-flex min-h-[40px] items-center gap-2 rounded-md border border-oa-border bg-oa-bg-elevated px-3 py-2 text-sm font-medium text-oa-text hover:bg-oa-surface">
                    <LogIn className="h-4 w-4" />
                    Go to Login
                  </button>
                  <button type="button" onClick={() => void copyDiagnostics()} className="inline-flex min-h-[40px] items-center gap-2 rounded-md border border-oa-border bg-oa-bg-elevated px-3 py-2 text-sm font-medium text-oa-text hover:bg-oa-surface">
                    <Clipboard className="h-4 w-4" />
                    Copy diagnostics
                  </button>
                </div>
                <pre className="mt-4 max-h-48 overflow-auto rounded-md bg-oa-bg-elevated p-3 text-xs text-oa-text-muted">
                  {diagnosticsText}
                </pre>
              </div>
            </div>
          </div>
        </section>
      )}
    </>
  );
}

function collectBlankShellDiagnostics({
  location,
  mainContentId,
  queryClient,
  section,
}: {
  location: Location | { pathname: string; search?: string };
  mainContentId: string;
  queryClient: ReturnType<typeof useQueryClient>;
  section: AppSection;
}): BlankShellDiagnostics | null {
  const rail = document.querySelector(".oa-user-rail");
  if (!rail) return null;

  const mainElements = findElementsById(mainContentId);
  const main = selectMainContent(mainElements);
  const routeContent = main?.querySelector(ROUTE_CONTENT_SELECTOR) ?? null;
  const metrics = domMetrics(main);
  const routeMetrics = domMetrics(routeContent);
  const mainReason = blankReason(metrics);
  const routeReason = blankReason(routeMetrics);
  if (!mainReason) return null;
  if (routeContent && !routeReason) return null;
  const reason = routeReason ? `${mainReason}:${routeReason}` : mainReason;
  if (!reason) return null;

  return {
    detectedAt: new Date().toISOString(),
    href: sanitizeHref(typeof window !== "undefined" ? window.location.href : ""),
    pathname: location.pathname,
    section,
    reason,
    duplicateMainContentCount: mainElements.length,
    localUiSession: summarizeSession(getLocalUiSessionSnapshot()),
    cloudUserSession: summarizeSession(getCloudUserSessionSnapshot()),
    cloudStatus: summarizeCloudStatus(queryClient.getQueryData(queryKeys.cloudStatus)),
    mainContent: metrics,
    routeContent: routeMetrics,
    queries: queryClient.getQueryCache().findAll().map((query) => ({
      keyGroup: queryKeyGroup(query.queryKey),
      status: String(query.state.status),
      fetchStatus: String(query.state.fetchStatus),
      failureCount: query.state.fetchFailureCount,
      error: redactDiagnosticText(query.state.error instanceof Error ? query.state.error.message : query.state.error ? String(query.state.error) : null),
    })),
  };
}

function findElementsById(id: string): HTMLElement[] {
  return Array.from(document.querySelectorAll(`[id="${cssAttributeValue(id)}"]`)).filter((element): element is HTMLElement => element instanceof HTMLElement);
}

function cssAttributeValue(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}

function selectMainContent(elements: HTMLElement[]): HTMLElement | null {
  return elements.find((element) => {
    const routeContent = element.querySelector(ROUTE_CONTENT_SELECTOR);
    return routeContent ? blankReason(domMetrics(routeContent)) == null : blankReason(domMetrics(element)) == null;
  }) ?? elements[0] ?? null;
}

function domMetrics(element: Element | null | undefined): DomMetrics {
  const text = (element?.textContent ?? "").replace(/\s+/g, " ").trim();
  const style = element ? window.getComputedStyle(element) : null;
  const rect = element?.getBoundingClientRect();
  return {
    exists: Boolean(element),
    textLength: text.length,
    childElementCount: element?.childElementCount ?? 0,
    opacity: style?.opacity ?? null,
    width: rect?.width ?? 0,
    height: rect?.height ?? 0,
    display: style?.display ?? null,
    visibility: style?.visibility ?? null,
  };
}

function blankReason(metrics: DomMetrics): string | null {
  if (!metrics.exists) return "main-content-missing";
  if (metrics.display === "none" || metrics.visibility === "hidden") return "main-content-hidden";
  if (Number(metrics.opacity) === 0) return "main-content-transparent";
  if (metrics.childElementCount === 0) return "main-content-empty";
  if (metrics.textLength === 0 && (metrics.width === 0 || metrics.height === 0)) return "main-content-zero-size";
  if (metrics.textLength === 0) return "main-content-no-visible-text";
  return null;
}

function summarizeSession(value: unknown): SessionSummary {
  const record = asRecord(value);
  return {
    status: String(record.status ?? "unknown"),
    issue: nullableString(record.issue),
    message: redactDiagnosticText(nullableString(record.message)),
    generation: typeof record.generation === "number" ? record.generation : undefined,
  };
}

function summarizeCloudStatus(value: unknown): CloudStatusSummary | null {
  const record = asRecord(value);
  if (!record || Object.keys(record).length === 0) return null;
  const cloud = asRecord(record.cloud);
  const heartbeat = asRecord(record.heartbeat);
  const inbox = asRecord(record.inbox);
  const controlPlane = asRecord(record.controlPlane);
  return {
    cloud: {
      status: nullableString(cloud.status),
      hasUserCredential: nullableBoolean(cloud.hasUserAccessToken),
      hasDeviceCredential: nullableBoolean(cloud.hasDeviceAccessToken),
      hasRefreshCredential: nullableBoolean(cloud.hasRefreshToken),
    },
    heartbeat: {
      running: nullableBoolean(heartbeat.running),
      lastError: redactDiagnosticText(nullableString(heartbeat.lastError)),
    },
    inbox: {
      running: nullableBoolean(inbox.running),
      lastItemCount: typeof inbox.lastItemCount === "number" ? inbox.lastItemCount : null,
      lastError: redactDiagnosticText(nullableString(inbox.lastError)),
    },
    credentialIssue: nullableString(record.tokenIssue),
    canRecoverDeviceCredential: nullableBoolean(record.canRecoverDeviceToken),
    userAuthIssue: nullableString(record.userAuthIssue),
    canRecoverUserCredential: nullableBoolean(record.canRecoverUserToken),
    relayMode: nullableString(record.relayMode),
    controlPlane: controlPlane && Object.keys(controlPlane).length > 0 ? {
      reachable: nullableBoolean(controlPlane.reachable),
      status: nullableString(controlPlane.status),
      matchesConfigured: nullableBoolean(controlPlane.matchesConfigured),
      message: redactDiagnosticText(nullableString(controlPlane.message)),
    } : undefined,
  };
}

function queryKeyGroup(queryKey: unknown): string {
  if (Array.isArray(queryKey)) return redactDiagnosticText(String(queryKey[0] ?? "unknown")) ?? "unknown";
  return redactDiagnosticText(String(queryKey ?? "unknown")) ?? "unknown";
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function nullableBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function sanitizeHref(href: string): string {
  try {
    const url = new URL(href);
    return `${url.origin}${url.pathname}`;
  } catch {
    return redactDiagnosticText(href) ?? "";
  }
}

function redactDiagnosticText(value: string | null): string | null {
  if (!value) return value;
  return value
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/giu, "[redacted-email]")
    .replace(/\b(?:user|device|agent|org|agt|dev|usr|agi)_[A-Za-z0-9_-]+\b/gu, "[redacted-id]")
    .replace(/\b(?:access|refresh|bearer|authorization|token)([_-]?[A-Za-z0-9]+)*\b/giu, "[redacted-field]")
    .replace(/([?&](?:access_token|refresh_token|token|code|sig)=)[^&\s]+/giu, "$1[redacted]");
}
