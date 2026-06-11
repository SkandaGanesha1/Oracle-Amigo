/// <reference types="vitest/globals" />
import { describe, expect, it } from "vitest";

describe("MessageComposer source contract", () => {
  it("exports MessageComposer", async () => {
    const mod = await import("../components/stream-like/MessageComposer");
    expect(mod.MessageComposer).toBeDefined();
    expect(typeof mod.MessageComposer).toBe("function");
  });

  it("has aria-label on send button", () => {
    const source = require("fs").readFileSync(
      require("path").resolve(__dirname, "../components/stream-like/MessageComposer.tsx"),
      "utf8"
    );
    expect(source).toContain("aria-label");
  });

  it("has keyboard event handling for Enter key", () => {
    const source = require("fs").readFileSync(
      require("path").resolve(__dirname, "../components/stream-like/MessageComposer.tsx"),
      "utf8"
    );
    expect(source).toContain("handleKeyDown");
  });
});

describe("ComposerDock source contract", () => {
  it("exports ComposerDock", async () => {
    const mod = await import("../features/chat/ComposerDock");
    expect(mod.ComposerDock).toBeDefined();
    expect(typeof mod.ComposerDock).toBe("function");
  });
});

describe("ChatWindow source contract", () => {
  it("exports ChatWindow", async () => {
    const mod = await import("../features/chat/ChatWindow");
    expect(mod.ChatWindow).toBeDefined();
    expect(typeof mod.ChatWindow).toBe("function");
  });

  it("uses SendConfirmation component", () => {
    const source = require("fs").readFileSync(
      require("path").resolve(__dirname, "../features/chat/ChatWindow.tsx"),
      "utf8"
    );
    expect(source).toContain("SendConfirmation");
    expect(source).toContain("pendingSend");
  });
});
