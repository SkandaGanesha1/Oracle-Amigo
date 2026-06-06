// A2A SDK uses lowercase state strings
export type A2ATaskStatus =
  | "submitted"
  | "working"
  | "input-required"
  | "completed"
  | "rejected"
  | "failed"
  | "canceled";

export type InternalState =
  | "REQUEST_RECEIVED"
  | "INTENT_CLASSIFIED"
  | "SEARCH_QUERY_BUILT"
  | "LOCAL_SEARCH_RUNNING"
  | "CANDIDATES_RANKED"
  | "APPROVAL_REQUIRED"
  | "APPROVAL_NOTIFICATION_SENT"
  | "USER_FEEDBACK_RECEIVED"
  | "SEARCH_REFINED"
  | "APPROVED"
  | "REJECTED"
  | "FILE_HASHING"
  | "FILE_STAGED"
  | "TRANSFER_CREATED"
  | "STORED_IN_AGENTIC_STORAGE"
  | "RECEIPT_CREATED"
  | "AUDITED"
  | "COMPLETED"
  | "FAILED";

export const A2A_STATE_MAP: Record<InternalState, A2ATaskStatus> = {
  REQUEST_RECEIVED: "submitted",
  INTENT_CLASSIFIED: "working",
  SEARCH_QUERY_BUILT: "working",
  LOCAL_SEARCH_RUNNING: "working",
  CANDIDATES_RANKED: "working",
  APPROVAL_REQUIRED: "input-required",
  APPROVAL_NOTIFICATION_SENT: "input-required",
  USER_FEEDBACK_RECEIVED: "input-required",
  SEARCH_REFINED: "working",
  APPROVED: "working",
  REJECTED: "rejected",
  FILE_HASHING: "working",
  FILE_STAGED: "working",
  TRANSFER_CREATED: "working",
  STORED_IN_AGENTIC_STORAGE: "working",
  RECEIPT_CREATED: "working",
  AUDITED: "working",
  COMPLETED: "completed",
  FAILED: "failed",
};

export const VALID_TRANSITIONS = new Map<InternalState, Set<InternalState>>([
  ["REQUEST_RECEIVED",           new Set(["INTENT_CLASSIFIED", "FAILED"])],
  ["INTENT_CLASSIFIED",          new Set(["SEARCH_QUERY_BUILT", "FAILED"])],
  ["SEARCH_QUERY_BUILT",         new Set(["LOCAL_SEARCH_RUNNING", "FAILED"])],
  ["LOCAL_SEARCH_RUNNING",       new Set(["CANDIDATES_RANKED", "FAILED"])],
  ["CANDIDATES_RANKED",          new Set(["APPROVAL_REQUIRED", "FAILED"])],
  ["APPROVAL_REQUIRED",          new Set(["APPROVAL_NOTIFICATION_SENT", "APPROVED", "REJECTED", "USER_FEEDBACK_RECEIVED", "FAILED"])],
  ["APPROVAL_NOTIFICATION_SENT", new Set(["APPROVED", "REJECTED", "USER_FEEDBACK_RECEIVED", "FAILED"])],
  ["USER_FEEDBACK_RECEIVED",     new Set(["SEARCH_REFINED", "REJECTED", "FAILED"])],
  ["SEARCH_REFINED",             new Set(["LOCAL_SEARCH_RUNNING", "FAILED"])],
  ["APPROVED",                   new Set(["FILE_HASHING", "FAILED"])],
  ["REJECTED",                   new Set([])],
  ["FILE_HASHING",               new Set(["FILE_STAGED", "FAILED"])],
  ["FILE_STAGED",                new Set(["TRANSFER_CREATED", "FAILED"])],
  ["TRANSFER_CREATED",           new Set(["STORED_IN_AGENTIC_STORAGE", "FAILED"])],
  ["STORED_IN_AGENTIC_STORAGE",  new Set(["RECEIPT_CREATED", "FAILED"])],
  ["RECEIPT_CREATED",            new Set(["AUDITED", "FAILED"])],
  ["AUDITED",                    new Set(["COMPLETED", "FAILED"])],
  ["COMPLETED",                  new Set([])],
  ["FAILED",                     new Set([])],
]);

export class InvalidTransitionError extends Error {
  constructor(from: InternalState, to: InternalState) {
    super(`Invalid state transition: ${from} → ${to}`);
    this.name = "InvalidTransitionError";
  }
}
