import * as React from "react";
import * as Sentry from "@sentry/react";
import {
  createRoutesFromChildren,
  matchRoutes,
  useLocation,
  useNavigationType,
} from "react-router-dom";

const SENTRY_DSN = import.meta.env.VITE_SENTRY_DSN?.trim();

function numberFromEnv(value: string | undefined, fallback: number): number {
  if (value == null || value.trim() === "") return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

if (SENTRY_DSN) {
  Sentry.init({
    dsn: SENTRY_DSN,
    environment: import.meta.env.MODE,
    dataCollection: {
      userInfo: false,
      httpBodies: [],
    },
    integrations: [
      Sentry.reactRouterV7BrowserTracingIntegration({
        useEffect: React.useEffect,
        useLocation,
        useNavigationType,
        createRoutesFromChildren,
        matchRoutes,
      }),
    ],
    tracesSampleRate: numberFromEnv(import.meta.env.VITE_SENTRY_TRACES_SAMPLE_RATE, 1.0),
    tracePropagationTargets: [
      "localhost",
      /^http:\/\/127\.0\.0\.1:\d+\//,
      /^https:\/\/yourserver\.io\/api/,
    ],
    replaysSessionSampleRate: numberFromEnv(import.meta.env.VITE_SENTRY_REPLAY_SESSION_SAMPLE_RATE, 0),
    replaysOnErrorSampleRate: numberFromEnv(import.meta.env.VITE_SENTRY_REPLAY_ERROR_SAMPLE_RATE, 0.1),
  });
}
