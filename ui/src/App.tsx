import { AppProviders } from "./app/AppProviders";
import { ErrorBoundary } from "./app/ErrorBoundary";
import { AppRoutes } from "./app/routes";
import { ThemeProvider } from "./components/primitives/ThemeProvider";

export function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider>
        <AppProviders>
          <AppRoutes />
        </AppProviders>
      </ThemeProvider>
    </ErrorBoundary>
  );
}
