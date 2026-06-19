import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import { bootstrapLocalUiSession } from "./api/localUiSessionStore";
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

void bootstrapLocalUiSession().finally(() => {
  scheduleSessionRenewal();
  ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
});
