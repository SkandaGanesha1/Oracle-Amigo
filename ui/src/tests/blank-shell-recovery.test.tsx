/// <reference types="vitest/globals" />
import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppShellContentWatchdog } from "../app/AppShellContentWatchdog";
import { bootstrapLocalUiSessionWithTimeout } from "../app/bootstrapLocalUiSession";
import { resetCloudUserSessionForTests } from "../api/cloudUserSessionStore";
import { resetLocalUiSessionForTests } from "../api/localUiSessionStore";

const sentryMock = vi.hoisted(() => ({
  captureMessage: vi.fn(),
}));

vi.mock("@sentry/react", () => ({
  captureMessage: sentryMock.captureMessage,
}));

function renderWatchdog(
  children: React.ReactNode,
  delayMs = 10,
  options: { mainStyle?: React.CSSProperties; beforeMain?: React.ReactNode; wrapRouteContent?: boolean } = {}
) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const result = render(
    <MemoryRouter initialEntries={["/unknown"]}>
      <QueryClientProvider client={client}>
        <div className="flex h-full">
          <aside className="oa-user-rail" />
          {options.beforeMain}
          <main id="main-content" style={options.mainStyle}>
            {options.wrapRouteContent === false ? (
              <AppShellContentWatchdog section="inbox" delayMs={delayMs}>
                {children}
              </AppShellContentWatchdog>
            ) : (
              <div data-app-route-content>
                <AppShellContentWatchdog section="inbox" delayMs={delayMs}>
                  {children}
                </AppShellContentWatchdog>
              </div>
            )}
          </main>
        </div>
      </QueryClientProvider>
    </MemoryRouter>
  );
  return { ...result, client };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  sentryMock.captureMessage.mockClear();
  resetLocalUiSessionForTests();
  resetCloudUserSessionForTests();
});

describe("blank shell recovery", () => {
  it("reports and renders recovery UI when the shell has no main content", async () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    renderWatchdog(null);

    await act(async () => {
      vi.advanceTimersByTime(15);
    });

    expect(screen.getByText("Main content did not render")).toBeInTheDocument();
    expect(screen.getByText("Copy diagnostics")).toBeInTheDocument();
    expect(warn).toHaveBeenCalledWith("Blank shell content detected", expect.objectContaining({ reason: "main-content-zero-size:main-content-empty" }));
    expect(sentryMock.captureMessage).toHaveBeenCalledWith("Blank shell content detected", expect.objectContaining({ level: "warning" }));
  });

  it("does not report a blank shell when route content is visible", async () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    renderWatchdog(<section>Action Center</section>);

    await act(async () => {
      vi.advanceTimersByTime(15);
    });

    expect(screen.queryByText("Main content did not render")).not.toBeInTheDocument();
    expect(warn).not.toHaveBeenCalledWith("Blank shell content detected", expect.anything());
    expect(sentryMock.captureMessage).not.toHaveBeenCalled();
  });

  it("does not report opacity on main as blank when route content is visible", async () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    renderWatchdog(<section>Local agent chat</section>, 10, { mainStyle: { opacity: 0 } });

    await act(async () => {
      vi.advanceTimersByTime(15);
    });

    expect(screen.queryByText("Main content did not render")).not.toBeInTheDocument();
    expect(warn).not.toHaveBeenCalledWith("Blank shell content detected", expect.anything());
    expect(sentryMock.captureMessage).not.toHaveBeenCalled();
  });

  it("prefers visible route content when duplicate main-content elements exist", async () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    renderWatchdog(<section>Current route</section>, 10, {
      beforeMain: (
        <main id="main-content" style={{ opacity: 0 }}>
          <div />
        </main>
      ),
    });

    await act(async () => {
      vi.advanceTimersByTime(15);
    });

    expect(screen.queryByText("Main content did not render")).not.toBeInTheDocument();
    expect(warn).not.toHaveBeenCalledWith("Blank shell content detected", expect.anything());
    expect(sentryMock.captureMessage).not.toHaveBeenCalled();
  });

  it("redacts identity details from exported blank-shell diagnostics", async () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { client } = renderWatchdog(null, 10);
    client.setQueryData(["cloud-status"], {
      cloud: {
        status: "enrolled",
        userEmail: "person@example.com",
        displayName: "Person Example",
        deviceId: "dev_secret",
        agentId: "agt_secret",
        agentInstanceId: "agi_secret",
        hasUserAccessToken: true,
        hasDeviceAccessToken: true,
        hasRefreshToken: true,
      },
      heartbeat: { running: true, lastError: "token failed for person@example.com" },
      inbox: { running: true, lastItemCount: 7, lastError: null },
      relayMode: "polling",
    });
    client.setQueryData(["chat", "conversation", "usr_secret"], "cached");

    await act(async () => {
      vi.advanceTimersByTime(15);
    });

    const payload = warn.mock.calls.find((call) => call[0] === "Blank shell content detected")?.[1];
    const serialized = JSON.stringify(payload);
    expect(serialized).not.toContain("person@example.com");
    expect(serialized).not.toContain("Person Example");
    expect(serialized).not.toContain("dev_secret");
    expect(serialized).not.toContain("agt_secret");
    expect(serialized).not.toContain("agi_secret");
    expect(serialized).not.toContain("usr_secret");
    expect(serialized).not.toContain("Authorization");
    expect(serialized).not.toContain("bearer");
    expect(serialized).not.toContain("token");
    expect(serialized).toContain("hasUserCredential");
    expect(serialized).toContain("keyGroup");
  });

  it("returns timeout when local UI session bootstrap stalls", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(() => {})));
    const result = bootstrapLocalUiSessionWithTimeout(25);

    await act(async () => {
      vi.advanceTimersByTime(30);
    });

    await expect(result).resolves.toBe("timeout");
  });
});
