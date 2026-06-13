import { useEffect, useRef, useState, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "../../hooks/queries";
import type { AgentRunResult } from "../../api/types";

interface UseAgentRunEventsOptions {
  runId: string | null;
  enabled?: boolean;
}

export function useAgentRunEvents({ runId, enabled = true }: UseAgentRunEventsOptions) {
  const queryClient = useQueryClient();
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<Event | null>(null);
  const esRef = useRef<EventSource | null>(null);

  const connect = useCallback(() => {
    if (!runId || !enabled) return;
    esRef.current?.close();

    const baseUrl = (window as unknown as Record<string, string>).__API_BASE_URL__ ?? "";
    const url = `${baseUrl}/agent/runs/${encodeURIComponent(runId)}/events`;
    const es = new EventSource(url);
    esRef.current = es;

    es.onopen = () => {
      setConnected(true);
      setError(null);
    };

    const handleSnapshot = (event: MessageEvent<string>) => {
      try {
        const data = JSON.parse(event.data) as AgentRunResult;
        const queryKey = queryKeys.agentRun(runId);
        queryClient.setQueryData(queryKey, data);

        if (data.status !== "running") {
          es.close();
          if (esRef.current === es) esRef.current = null;
          setConnected(false);
        }
      } catch {
        setConnected(false);
        setError(new Event("parseerror"));
        es.close();
        if (esRef.current === es) esRef.current = null;
      }
    };

    es.addEventListener("snapshot", handleSnapshot);
    es.onmessage = handleSnapshot;

    es.onerror = (event) => {
      setConnected(false);
      setError(event);
      es.close();
      if (esRef.current === es) esRef.current = null;
    };
  }, [runId, enabled, queryClient]);

  const disconnect = useCallback(() => {
    if (esRef.current) {
      esRef.current.close();
      esRef.current = null;
      setConnected(false);
    }
  }, []);

  useEffect(() => {
    if (runId && enabled) {
      connect();
    }
    return () => disconnect();
  }, [runId, enabled, connect, disconnect]);

  return { connected, error, disconnect, reconnect: connect };
}
