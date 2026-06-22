import * as Sentry from "@sentry/react";
import { AppProviders } from "./app/AppProviders";
import { ErrorBoundary } from "./app/ErrorBoundary";
import { AppRoutes } from "./app/routes";
import { ThemeProvider } from "./components/primitives/ThemeProvider";

function SentrySmokeTestButton() {
  if (!import.meta.env.DEV || import.meta.env.VITE_SENTRY_TEST_BUTTON !== "true") return null;
  return (
    <button
      type="button"
      className="fixed bottom-4 right-4 z-50 rounded-md bg-red-600 px-3 py-2 text-sm font-semibold text-white shadow-lg"
      onClick={() => {
        Sentry.captureMessage("Sentry smoke test button clicked");
        throw new Error("This is your first error!");
      }}
    >
      Break the world
    </button>
  );
}

export function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider>
        <AppProviders>
          <AppRoutes />
          <SentrySmokeTestButton />
        </AppProviders>
      </ThemeProvider>
    </ErrorBoundary>
  );
}
