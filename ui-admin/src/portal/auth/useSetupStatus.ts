import { useQuery } from "@tanstack/react-query";
import { fetchSetupStatus } from "./api";
import type { SetupStatus } from "./types";

export function useSetupStatus() {
  return useQuery<SetupStatus, Error>({
    queryKey: ["admin", "auth", "setup-status"],
    queryFn: ({ signal }) => fetchSetupStatus(signal),
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    retry: 1
  });
}
