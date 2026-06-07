import { QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { PortalApp } from "./portal/PortalApp";
import { createAdminQueryClient } from "./portal/api/queryClient";
import { RootErrorBoundary } from "./portal/RootErrorBoundary";
import "./styles.css";

const root = document.getElementById("root");
if (!root) {
  throw new Error("Admin portal: #root element not found in index.html");
}

const queryClient = createAdminQueryClient();

createRoot(root).render(
  <StrictMode>
    <RootErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <PortalApp />
      </QueryClientProvider>
    </RootErrorBoundary>
  </StrictMode>
);
