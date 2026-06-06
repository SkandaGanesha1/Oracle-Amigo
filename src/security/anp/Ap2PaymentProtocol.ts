import { createHash, randomUUID } from "node:crypto";

export const AP2_PROTOCOL_VERSION = "1.0";
export const AP2_PROTOCOL_ID = "ap2/payment/v1";

export type Ap2PaymentStatus =
  | "draft"
  | "issued"
  | "authorized"
  | "settled"
  | "cancelled"
  | "expired"
  | "rejected"
  | "refunded";

export interface Ap2LineItem {
  id: string;
  description: string;
  quantity: number;
  unitPrice: number;
  currency: string;
  metadata?: Record<string, unknown>;
}

export interface Ap2PaymentIntent {
  id: string;
  version: string;
  type: "Ap2PaymentIntent";
  fromDid: string;
  toDid: string;
  lineItems: Ap2LineItem[];
  totalAmount: number;
  currency: string;
  description: string;
  metadata?: Record<string, unknown>;
  expiresAt: string;
  createdAt: string;
  humanApprovalRequired: boolean;
  status: Ap2PaymentStatus;
}

export interface Ap2Authorization {
  intentId: string;
  authorizedBy: string;
  authorizedDid: string;
  authorizedAt: string;
  signature: {
    type: "DataIntegrityProof";
    cryptosuite: "eddsa-jcs-2022";
    verificationMethod: string;
    created: string;
    proofPurpose: "assertionMethod";
    proofValue: string;
  };
}

export interface Ap2Settlement {
  intentId: string;
  settledBy: string;
  settledAt: string;
  transactionHash?: string;
  receipt: {
    totalAmount: number;
    currency: string;
    lineItems: Ap2LineItem[];
  };
  status: "settled" | "failed";
  failureReason?: string;
}

export interface BuildPaymentIntentInput {
  fromDid: string;
  toDid: string;
  lineItems: Ap2LineItem[];
  description: string;
  ttlSeconds?: number;
  humanApprovalRequired?: boolean;
  metadata?: Record<string, unknown>;
}

export function buildPaymentIntent(input: BuildPaymentIntentInput): Ap2PaymentIntent {
  if (input.lineItems.length === 0) {
    throw new Error("At least one line item is required");
  }
  const totalAmount = input.lineItems.reduce(
    (sum, item) => sum + item.unitPrice * item.quantity,
    0,
  );
  const currency = input.lineItems[0].currency;
  for (const item of input.lineItems) {
    if (item.currency !== currency) {
      throw new Error("All line items must use the same currency");
    }
  }
  if (totalAmount <= 0) {
    throw new Error("Total amount must be positive");
  }
  return {
    id: randomUUID(),
    version: AP2_PROTOCOL_VERSION,
    type: "Ap2PaymentIntent",
    fromDid: input.fromDid,
    toDid: input.toDid,
    lineItems: input.lineItems,
    totalAmount,
    currency,
    description: input.description,
    metadata: input.metadata,
    expiresAt: new Date(
      Date.now() + (input.ttlSeconds ?? 3600) * 1000,
    ).toISOString(),
    createdAt: new Date().toISOString(),
    humanApprovalRequired: input.humanApprovalRequired ?? true,
    status: "draft",
  };
}

export function issueIntent(intent: Ap2PaymentIntent): Ap2PaymentIntent {
  if (intent.status !== "draft") {
    throw new Error(`Cannot issue intent in status: ${intent.status}`);
  }
  return { ...intent, status: "issued" };
}

export function authorizeIntent(
  intent: Ap2PaymentIntent,
  authorization: Ap2Authorization,
): Ap2PaymentIntent {
  if (intent.status !== "issued") {
    throw new Error(`Cannot authorize intent in status: ${intent.status}`);
  }
  if (authorization.intentId !== intent.id) {
    throw new Error("Authorization intentId mismatch");
  }
  if (intent.humanApprovalRequired && !authorization.authorizedBy) {
    throw new Error("Human approval required for this intent");
  }
  return { ...intent, status: "authorized" };
}

export function settleIntent(
  intent: Ap2PaymentIntent,
  settlement: Ap2Settlement,
): Ap2PaymentIntent {
  if (intent.status !== "authorized") {
    throw new Error(`Cannot settle intent in status: ${intent.status}`);
  }
  if (settlement.intentId !== intent.id) {
    throw new Error("Settlement intentId mismatch");
  }
  if (settlement.status === "failed") {
    return { ...intent, status: "rejected" };
  }
  return { ...intent, status: "settled" };
}

export function cancelIntent(
  intent: Ap2PaymentIntent,
  reason: string,
): Ap2PaymentIntent {
  if (intent.status === "settled" || intent.status === "refunded") {
    throw new Error(`Cannot cancel intent in terminal status: ${intent.status}`);
  }
  return {
    ...intent,
    status: "cancelled",
    metadata: { ...intent.metadata, cancellationReason: reason },
  };
}

export function refundIntent(
  intent: Ap2PaymentIntent,
  reason: string,
): Ap2PaymentIntent {
  if (intent.status !== "settled") {
    throw new Error(`Cannot refund intent in status: ${intent.status}`);
  }
  return {
    ...intent,
    status: "refunded",
    metadata: { ...intent.metadata, refundReason: reason },
  };
}

export function isIntentExpired(
  intent: Ap2PaymentIntent,
  now: number = Date.now(),
): boolean {
  return now > new Date(intent.expiresAt).getTime();
}

export function intentFingerprint(intent: Ap2PaymentIntent): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        id: intent.id,
        fromDid: intent.fromDid,
        toDid: intent.toDid,
        totalAmount: intent.totalAmount,
        currency: intent.currency,
        lineItems: intent.lineItems,
      }),
    )
    .digest("hex");
}
