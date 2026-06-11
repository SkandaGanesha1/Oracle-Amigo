/// <reference types="vitest/globals" />
import { describe, expect, it } from "vitest";

describe("ApprovalCard source contract", () => {
  it("exports ApprovalCard", async () => {
    const mod = await import("../features/approvals/ApprovalCard");
    expect(mod.ApprovalCard).toBeDefined();
    expect(typeof mod.ApprovalCard).toBe("function");
  });

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
  });

  it("uses sub-components CandidateFileList, ApprovalRiskHeader, ApprovalTerminalState", () => {
    const source = require("fs").readFileSync(
      require("path").resolve(__dirname, "../features/approvals/ApprovalCard.tsx"),
      "utf8"
    );
    expect(source).toContain("CandidateFileList");
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
});
