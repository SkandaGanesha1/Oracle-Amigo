import "./instrument";
import React from "react";
import ReactDOM from "react-dom/client";
import * as Sentry from "@sentry/react";
import { App } from "./App";
import { bootstrapLocalUiSession } from "./api/localUiSessionStore";
import { BOOTSTRAP_TIMEOUT_MS, bootstrapLocalUiSessionWithTimeout } from "./app/bootstrapLocalUiSession";
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@fontsource/inter/700.css";
import "./styles.css";

// Proactively refresh the local UI session cookie every 6 hours so it never
// expires mid-session (the server issues 12-hour cookies).
const SESSION_RENEWAL_INTERVAL_MS = 6 * 60 * 60 * 1000;

function scheduleSessionRenewal(): void {
  // Renew every 6 hours while the tab is open.
  setInterval(() => void bootstrapLocalUiSession(), SESSION_RENEWAL_INTERVAL_MS);

  // Also renew immediately when the user returns to a tab left open for a long
  // time (e.g., overnight), because the session cookie may have expired.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      void bootstrapLocalUiSession();
    }
  });
}

function renderBootstrapRecovery(reason: "failed" | "timeout"): void {
  const root = document.getElementById("root");
  if (!root) return;
  const title = reason === "timeout" ? "Local agent session timed out" : "Local agent session failed";
  const description =
    reason === "timeout"
      ? "The app could not refresh the local UI session within 8 seconds."
      : "The app could not refresh the local UI session before startup.";
  root.innerHTML = `
    <main class="flex min-h-screen items-center justify-center bg-oa-bg p-6 text-oa-text" role="alert">
      <section class="w-full max-w-md rounded-lg border border-oa-amber/30 bg-oa-surface p-5 shadow-xl">
        <h1 class="text-base font-semibold text-oa-text">${title}</h1>
        <p class="mt-2 text-sm text-oa-text-muted">${description}</p>
        <div class="mt-4 flex flex-wrap gap-2">
          <button type="button" id="oa-bootstrap-reload" class="inline-flex min-h-[40px] items-center rounded-md bg-oa-blue px-3 py-2 text-sm font-medium text-white">Reload app</button>
          <a href="/health" class="inline-flex min-h-[40px] items-center rounded-md border border-oa-border bg-oa-bg-elevated px-3 py-2 text-sm font-medium text-oa-text">Open health</a>
        </div>
      </section>
    </main>
  `;
  document.getElementById("oa-bootstrap-reload")?.addEventListener("click", () => window.location.reload());
}

void bootstrapLocalUiSessionWithTimeout().then((status) => {
  if (status === "timeout") {
    console.error("Local UI session bootstrap timed out", { timeoutMs: BOOTSTRAP_TIMEOUT_MS });
    Sentry.captureMessage("Local UI session bootstrap timed out", {
      level: "error",
      contexts: { bootstrap: { timeoutMs: BOOTSTRAP_TIMEOUT_MS } },
    });
    renderBootstrapRecovery("timeout");
    return;
  }
  if (status === "failed") {
    console.error("Local UI session bootstrap failed");
    Sentry.captureMessage("Local UI session bootstrap failed", { level: "warning" });
  }
  scheduleSessionRenewal();
  ReactDOM.createRoot(document.getElementById("root")!, {
    onUncaughtError: Sentry.reactErrorHandler(),
    onCaughtError: Sentry.reactErrorHandler(),
    onRecoverableError: Sentry.reactErrorHandler(),
  }).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
});
