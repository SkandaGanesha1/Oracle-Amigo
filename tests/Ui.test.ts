import { describe, expect, it } from "vitest";
import { buildServer } from "../src/server.js";

describe("static UI", () => {
  it("serves the centered AI prompt box shell", async () => {
    const server = buildServer();
    const response = await server.inject({ method: "GET", url: "/" });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("text/html");
    expect(response.body).toContain("Oracle Amigo Sandbox");
    expect(response.body).toContain("/assets/");
    expect(response.body).not.toContain("plan-list");
    await server.close();
  });

  it("serves UI assets with content types", async () => {
    const server = buildServer();
    const html = await server.inject({ method: "GET", url: "/" });
    const cssPath = html.body.match(/href="([^"]+\.css)"/)?.[1];
    const jsPath = html.body.match(/src="([^"]+\.js)"/)?.[1];

    expect(cssPath).toBeDefined();
    expect(jsPath).toBeDefined();

    const css = await server.inject({ method: "GET", url: cssPath! });
    const js = await server.inject({ method: "GET", url: jsPath! });

    expect(css.statusCode).toBe(200);
    expect(css.headers["content-type"]).toContain("text/css");
    expect(js.statusCode).toBe(200);
    expect(js.headers["content-type"]).toContain("text/javascript");
    expect(js.body).toContain("PromptInputBox");
    expect(js.body).toContain("Agent Runner");
    expect(js.body).toContain("Agent Chat");
    await server.close();
  });

  it("rejects public asset path traversal", async () => {
    const server = buildServer();
    const response = await server.inject({ method: "GET", url: "/assets/..%2Fpackage.json" });

    expect(response.statusCode).not.toBe(200);
    await server.close();
  });
});
