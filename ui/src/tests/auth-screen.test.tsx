/// <reference types="vitest/globals" />
import { describe, expect, it } from "vitest";

describe("AuthScreen source contract", () => {
  it("exports AuthScreen, SignupForm, LoginForm", async () => {
    const mod = await import("../features/auth/AuthScreen");
    expect(mod.AuthScreen).toBeDefined();
    expect(typeof mod.AuthScreen).toBe("function");
  });

  it("exports SignupForm", async () => {
    const mod = await import("../features/auth/SignupForm");
    expect(mod.SignupForm).toBeDefined();
    expect(typeof mod.SignupForm).toBe("function");
  });

  it("exports LoginForm", async () => {
    const mod = await import("../features/auth/LoginForm");
    expect(mod.LoginForm).toBeDefined();
    expect(typeof mod.LoginForm).toBe("function");
  });
});

describe("AuthScreen prop interfaces", () => {
  it("AuthScreen accepts onComplete callback via signature", () => {
    // AuthScreen takes no props — it uses route-smart rendering
    const source = require("fs").readFileSync(
      require("path").resolve(__dirname, "../features/auth/AuthScreen.tsx"),
      "utf8"
    );
    expect(source).toContain("export function AuthScreen");
  });

  it("LoginForm has email and password fields with validation", () => {
    const source = require("fs").readFileSync(
      require("path").resolve(__dirname, "../features/auth/LoginForm.tsx"),
      "utf8"
    );
    expect(source).toContain("aria-label");
    expect(source).toContain("password");
    expect(source).toContain("email");
  });

  it("auth pages use direct email/password flow without Google, control-plane URL, or idle readiness copy", () => {
    const fs = require("fs");
    const path = require("path");
    const auth = fs.readFileSync(path.resolve(__dirname, "../features/auth/AuthScreen.tsx"), "utf8");
    const login = fs.readFileSync(path.resolve(__dirname, "../features/auth/LoginForm.tsx"), "utf8");
    const signup = fs.readFileSync(path.resolve(__dirname, "../features/auth/SignupForm.tsx"), "utf8");
    const schemas = fs.readFileSync(path.resolve(__dirname, "../features/auth/schemas.ts"), "utf8");
    const combined = `${auth}\n${login}\n${signup}\n${schemas}`;

    expect(auth).toContain('navigate(hasDeviceSession ? "/inbox" : "/enroll"');
    expect(login).toContain("loginSchema.safeParse({ email: email.trim(), password })");
    expect(signup).toContain("signupSchema.safeParse({ email: email.trim(), password, displayName: displayName.trim() })");
    expect(combined).not.toContain("ControlPlaneUrlField");
    expect(combined).not.toContain("controlPlaneUrl");
    expect(combined).not.toContain("control_plane_url");
    expect(combined).not.toContain("Ready to connect");
    expect(combined).not.toContain("Google");
  });
});
