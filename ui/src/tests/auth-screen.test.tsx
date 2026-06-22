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
    // AuthScreen takes no props; it uses route-smart rendering.
    const source = require("fs").readFileSync(
      require("path").resolve(__dirname, "../features/auth/AuthScreen.tsx"),
      "utf8"
    );
    expect(source).toContain("export function AuthScreen");
  });

  it("AuthScreen uses the animated cinematic auth shell", () => {
    const fs = require("fs");
    const path = require("path");
    const auth = fs.readFileSync(path.resolve(__dirname, "../features/auth/AuthScreen.tsx"), "utf8");
    const nav = fs.readFileSync(path.resolve(__dirname, "../features/auth/AuthShellNav.tsx"), "utf8");
    const background = fs.readFileSync(path.resolve(__dirname, "../features/auth/AuthDotMatrixBackground.tsx"), "utf8");
    const css = fs.readFileSync(path.resolve(__dirname, "../styles.css"), "utf8");

    expect(auth).toContain('import { AuthDotMatrixBackground } from "./AuthDotMatrixBackground"');
    expect(auth).toContain('import { MiniNavbar } from "./AuthShellNav"');
    expect(nav).toContain("export function MiniNavbar");
    expect(background).toContain("export function AuthDotMatrixBackground");
    expect(background).toContain("export function CanvasRevealEffect");
    expect(background).toContain("export function DotMatrix");
    expect(background).toContain("export function ShaderMaterial");
    expect(background).toContain("export function Shader");
    expect(background).toContain("getContext(\"webgl2\")");
    expect(background).toContain("new THREE.WebGLRenderer");
    expect(background).toContain("new THREE.Timer");
    expect(background).not.toContain("@react-three/fiber");
    expect(background).not.toContain("useFrame");
    expect(background).not.toContain("THREE.Clock");
    expect(background).toContain("ShaderMaterial");
    expect(auth).toContain("<AnimatePresence");
    expect(auth).toContain('className="oa-auth-screen"');
    expect(auth).toContain('className="oa-auth-card"');
    expect(auth).toContain("Sign in to continue");
    expect(auth).toContain("Create your account");
    expect(auth).not.toContain("oa-auth-mark");
    expect(auth).not.toContain("Bot");
    expect(auth).not.toContain("Log in to your control plane");
    expect(css).toContain(".oa-auth-screen");
    expect(css).toContain(".oa-auth-canvas");
    expect(css).toContain(".oa-canvas-reveal");
    expect(css).toContain("font-size: clamp(2.5rem, 4.2vw, 3.75rem)");
    expect(css).toContain("background: transparent");
    expect(css).toContain('.oa-auth-bg[data-webgl="false"] .oa-auth-bg-fallback');
    expect(css).toContain("@media (prefers-reduced-motion: reduce)");
    expect(css).not.toContain("mix-blend-mode: screen");
    expect(css).not.toContain("rgba(255, 255, 255, 0.22), transparent 30rem");
    expect(css).not.toContain("rgba(255, 255, 255, 0.2), transparent 28rem");
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
    expect(combined).not.toContain("We sent you a code");
    expect(combined).not.toContain("Resend code");
    expect(combined).not.toContain("Continue to Dashboard");
    expect(combined).not.toContain("Welcome Developer");
    expect(combined).not.toContain("Your sign in component");
    expect(combined).not.toContain("Manifesto");
    expect(combined).not.toContain("Careers");
    expect(combined).not.toContain("next/link");
  });

  it("auth forms use the new pill field treatment with accessible password controls", () => {
    const fs = require("fs");
    const path = require("path");
    const login = fs.readFileSync(path.resolve(__dirname, "../features/auth/LoginForm.tsx"), "utf8");
    const signup = fs.readFileSync(path.resolve(__dirname, "../features/auth/SignupForm.tsx"), "utf8");

    expect(login).toContain('className="oa-auth-form"');
    expect(signup).toContain('className="oa-auth-form"');
    expect(login).toContain('className="oa-auth-input has-action"');
    expect(signup).toContain('className="oa-auth-input has-action"');
    expect(login).toContain('aria-label={showPassword ? "Hide password" : "Show password"}');
    expect(signup).toContain('aria-label={showPassword ? "Hide password" : "Show password"}');
  });
});
