import { useSyncExternalStore } from "react";
import type { CloudStatus } from "./types";

export type CloudUserSessionStatus = "checking" | "ready" | "blocked";
export type CloudUserAuthIssue = "required" | "expired" | null;

export interface CloudUserSessionSnapshot {
  status: CloudUserSessionStatus;
  issue: CloudUserAuthIssue;
  message: string | null;
  generation: number;
}

const DEFAULT_EXPIRED_MESSAGE = "Cloud login expired. Please sign in again.";
const DEFAULT_REQUIRED_MESSAGE = "Please sign in to continue.";

let snapshot: CloudUserSessionSnapshot = {
  status: "checking",
  issue: null,
  message: null,
  generation: 0
};

const listeners = new Set<() => void>();

function emit(next: CloudUserSessionSnapshot): void {
  if (
    snapshot.status === next.status &&
    snapshot.issue === next.issue &&
    snapshot.message === next.message
  ) {
    return;
  }
  snapshot = { ...next, generation: snapshot.generation + 1 };
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): CloudUserSessionSnapshot {
  return snapshot;
}

export function useCloudUserSession(): CloudUserSessionSnapshot {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export function getCloudUserSessionSnapshot(): CloudUserSessionSnapshot {
  return snapshot;
}

export function isCloudUserSessionReady(status: CloudUserSessionStatus): boolean {
  return status === "ready";
}

export function markCloudUserReady(): void {
  emit({ status: "ready", issue: null, message: null, generation: snapshot.generation });
}

export function markCloudUserBlocked(issue: Exclude<CloudUserAuthIssue, null>, message?: string | null): void {
  emit({
    status: "blocked",
    issue,
    message: message ?? (issue === "expired" ? DEFAULT_EXPIRED_MESSAGE : DEFAULT_REQUIRED_MESSAGE),
    generation: snapshot.generation
  });
}

export function resetCloudUserSession(): void {
  emit({ status: "checking", issue: null, message: null, generation: snapshot.generation });
}

export function reconcileCloudUserSessionFromStatus(status: CloudStatus | undefined): void {
  if (!status) return;
  if ((status.cloud.hasUserAccessToken || status.canRecoverUserToken) && status.userAuthIssue == null) {
    markCloudUserReady();
    return;
  }
  markCloudUserBlocked(status.userAuthIssue ?? "required");
}

export function resetCloudUserSessionForTests(): void {
  snapshot = { status: "checking", issue: null, message: null, generation: 0 };
  for (const listener of listeners) listener();
}
