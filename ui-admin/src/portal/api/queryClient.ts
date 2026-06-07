import { QueryClient } from "@tanstack/react-query";
import { ApiError } from "./client";

export function createAdminQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: (count, error) => {
          if (error instanceof ApiError) {
            if (error.status === 401 || error.status === 403 || error.status === 503) return false;
          }
          return count < 2;
        },
        staleTime: 5_000,
        gcTime: 5 * 60_000,
        refetchOnWindowFocus: false
      }
    }
  });
}
