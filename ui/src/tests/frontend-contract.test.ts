/// <reference types="vitest/globals" />
import { describe, expect, it } from "vitest";

describe("Barrel export contracts", () => {
  it("features/approvals/index.ts exports all 10 approval components", async () => {
    const mod = await import("../features/approvals/index");
    expect(mod).toHaveProperty("ApprovalCenter");
    expect(mod).toHaveProperty("ApprovalCard");
    expect(mod).toHaveProperty("CandidateFileCard");
    expect(mod).toHaveProperty("CandidateFileList");
    expect(mod).toHaveProperty("ApprovalExactBinding");
    expect(mod).toHaveProperty("ApprovalRiskHeader");
    expect(mod).toHaveProperty("ApprovalFeedbackBox");
    expect(mod).toHaveProperty("ApprovalTerminalState");
    expect(mod).toHaveProperty("ApprovalPolicyBadge");
    expect(Object.keys(mod).length).toBeGreaterThanOrEqual(9);
  });

  it("features/transfers/index.ts exports all 7 transfer components", async () => {
    const mod = await import("../features/transfers/index");
    expect(mod).toHaveProperty("TransferProgressCard");
    expect(mod).toHaveProperty("TransferStageStepper");
    expect(mod).toHaveProperty("FileReceiptCard");
    expect(mod).toHaveProperty("HashVerifiedBadge");
    expect(mod).toHaveProperty("RelayEncryptedBadge");
    expect(mod).toHaveProperty("LocalPathHiddenBadge");
    expect(Object.keys(mod).length).toBeGreaterThanOrEqual(6);
  });

  it("features/files/index.ts exports all 7 file components", async () => {
    const mod = await import("../features/files/index");
    expect(mod).toHaveProperty("ReceivedFilesPanel");
    expect(mod).toHaveProperty("SentFilesPanel");
    expect(mod).toHaveProperty("FilePreviewDrawer");
    expect(mod).toHaveProperty("FileTypeIcon");
    expect(mod).toHaveProperty("StorageBrowser");
    expect(mod).toHaveProperty("VerifyHashButton");
    expect(Object.keys(mod).length).toBeGreaterThanOrEqual(6);
  });

  it("features/inspector/index.ts exports RightInspectorPanel", async () => {
    const mod = await import("../features/inspector/index");
    expect(mod).toHaveProperty("RightInspectorPanel");
    expect(typeof mod.RightInspectorPanel).toBe("function");
  });
});

describe("Component type contracts", () => {
  it("TransferProgressMessage type has required fields", () => {
    const source = require("fs").readFileSync(
      require("path").resolve(__dirname, "../types.ts"),
      "utf8"
    );
    expect(source).toContain("TransferProgressMessage");
    expect(source).toContain("progress_percent");
    expect(source).toContain("sha256");
    expect(source).toContain('status: "preparing" | "uploading"');
    expect(source).toContain('"stored" | "failed"');
  });

  it("FileReceiptMessage type has file_id for open-file action", () => {
    const source = require("fs").readFileSync(
      require("path").resolve(__dirname, "../types.ts"),
      "utf8"
    );
    expect(source).toContain("FileReceiptMessage");
    expect(source).toContain("file_id");
  });
});

describe("Primitive component exports", () => {
  const primitives = {
    OracleButton: () => import("../components/primitives/OracleButton"),
    OracleBadge: () => import("../components/primitives/OracleBadge"),
    OracleTooltip: () => import("../components/primitives/OracleTooltip"),
    OracleAvatar: () => import("../components/primitives/OracleAvatar"),
    OracleChip: () => import("../components/primitives/OracleChip"),
    OracleSurface: () => import("../components/primitives/OracleSurface"),
    OracleToast: () => import("../components/primitives/OracleToast"),
  };

  for (const [name, load] of Object.entries(primitives)) {
    it(`exports ${name}`, async () => {
      const mod = await load();
      expect((mod as Record<string, unknown>)[name]).toBeDefined();
    });
  }
});
