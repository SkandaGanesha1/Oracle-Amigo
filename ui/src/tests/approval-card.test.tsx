/// <reference types="vitest/globals" />
import { describe, expect, it } from "vitest";

describe("ApprovalCard source contract", () => {
  it("exports ApprovalCard", async () => {
    const mod = await import("../features/approvals/ApprovalCard");
    expect(mod.ApprovalCard).toBeDefined();
    expect(typeof mod.ApprovalCard).toBe("function");
  }, 120_000);

  it("uses TanStack Query mutations for approve/reject", () => {
    const source = require("fs").readFileSync(
      require("path").resolve(__dirname, "../features/approvals/ApprovalCard.tsx"),
      "utf8"
    );
    expect(source).toContain("useApproveFileRequest");
    expect(source).toContain("useRejectFileRequest");
    expect(source).toContain("useSubmitApprovalFeedback");
    expect(source).toContain("isPending");
  });

  it("has approve and reject buttons with OracleButton", () => {
    const source = require("fs").readFileSync(
      require("path").resolve(__dirname, "../features/approvals/ApprovalCard.tsx"),
      "utf8"
    );
    expect(source).toContain("OracleButton");
    expect(source).toContain("oaVariant=\"approve\"");
    expect(source).toContain("oaVariant=\"reject\"");
    expect(source).toContain("handleApprove");
    expect(source).toContain("handleReject");
    expect(source).toContain("!isBound");
    expect(source).toContain("card.is_bound");
  });

  it("uses risk and terminal sub-components without candidate-list clutter", () => {
    const source = require("fs").readFileSync(
      require("path").resolve(__dirname, "../features/approvals/ApprovalCard.tsx"),
      "utf8"
    );
    expect(source).not.toContain("CandidateFileList");
    expect(source).not.toContain("Choose indexed file");
    expect(source).not.toContain("No matching files found");
    expect(source).toContain("ApprovalRiskHeader");
    expect(source).toContain("ApprovalTerminalState");
  });
});

describe("ApprovalCard props contract", () => {
  it("accepts FileCandidateApprovalCard via card prop", () => {
    const source = require("fs").readFileSync(
      require("path").resolve(__dirname, "../features/approvals/ApprovalCard.tsx"),
      "utf8"
    );
    expect(source).toContain("FileCandidateApprovalCard");
    expect(source).toContain("requester_display_name");
    expect(source).toContain("target_display_name");
    expect(source).not.toContain("low_confidence_candidates");
  });
});

describe("Approval sub-components export contract", () => {
  it("CandidateFileList exports", async () => {
    const mod = await import("../features/approvals/CandidateFileList");
    expect(mod.CandidateFileList).toBeDefined();
  });

  it("ApprovalRiskHeader exports", async () => {
    const mod = await import("../features/approvals/ApprovalRiskHeader");
    expect(mod.ApprovalRiskHeader).toBeDefined();
  });

  it("ApprovalTerminalState exports", async () => {
    const mod = await import("../features/approvals/ApprovalTerminalState");
    expect(mod.ApprovalTerminalState).toBeDefined();
  });

  it("AI Elements confirmation exports", async () => {
    const mod = await import("../../../components/ai-elements/confirmation");
    expect(mod.Confirmation).toBeDefined();
    expect(mod.ConfirmationAccepted).toBeDefined();
    expect(mod.ConfirmationRejected).toBeDefined();
    expect(mod.ConfirmationRequest).toBeDefined();
    expect(mod.ConfirmationTitle).toBeDefined();
  }, 120_000);
});
