import { type PropsWithChildren } from "react";
import { BrowserRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toast } from "@heroui/react/toast";
import { TooltipProvider } from "@/components/ui/tooltip";
import { MotionConfig } from "motion/react";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

export function AppProviders({ children }: PropsWithChildren) {
  return (
    <BrowserRouter>
      <QueryClientProvider client={queryClient}>
        <MotionConfig reducedMotion="user" transition={{ type: "spring", stiffness: 420, damping: 34, mass: 0.8 }}>
          <TooltipProvider>
            <Toast.Provider placement="bottom end" />
            {children}
          </TooltipProvider>
        </MotionConfig>
      </QueryClientProvider>
    </BrowserRouter>
  );
}
