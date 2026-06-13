import { expect, test } from "@playwright/test";

const now = new Date("2026-06-08T00:00:00.000Z").toISOString();

test.describe("Oracle Amigo routed chat frontend", () => {
  test("redirects disconnected users to login", async ({ page }) => {
    await mockCloudStatus(page, cloudStatus("disconnected"));
    await page.goto("/");

    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole("heading", { name: "Oracle Amigo" })).toBeVisible();
    await expect(page.getByRole("tablist", { name: "Auth mode" })).toBeVisible();
    await expect(page.getByLabel("Email")).toBeVisible();
    await expect(page.getByRole("textbox", { name: "Password" })).toBeVisible();
  });

  test("redirects authenticated users without an enrolled device to enrollment", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await mockCloudStatus(page, cloudStatus("authenticated"));
    await page.goto("/");

    await expect(page).toHaveURL(/\/enroll$/);
    await expect(page.getByRole("heading", { name: "Enroll Device" })).toBeVisible();
    await expect(page.getByLabel("Agent Display Name")).toBeVisible();
    await expect(page.getByRole("button", { name: "Log out" })).toBeVisible();
    await expect(page.getByRole("button", { name: /enroll device/i })).toBeVisible();
    const canScrollEnrollment = await page.getByTestId("auth-route-scroll").evaluate((node) => {
      node.scrollTop = node.scrollHeight;
      return node.scrollTop > 0 && node.scrollHeight > node.clientHeight;
    });
    expect(canScrollEnrollment).toBe(true);
  });

  test("renders enrolled chat shell with active routed regions", async ({ page }) => {
    await mockEnrolledAgent(page);
    await page.goto("/");

    await expect(page).toHaveURL(/\/inbox$/);
    await expect(page.getByRole("button", { name: "Oracle Amigo" })).toBeVisible();
    await expect(page.getByRole("banner")).not.toContainText("Inbox");
    await expect(page.getByRole("banner")).not.toContainText("Chats");
    await expect(page.getByRole("banner")).not.toContainText("Settings");
    await expect(page.getByRole("navigation", { name: "Intent Inbox" })).toBeVisible();
    await expect(page.getByRole("main", { name: "Main content" })).toBeVisible();
    await expect(page.getByRole("main", { name: "Main content" })).toContainText("Intent Inbox");

    const rail = page.getByLabel("People and inbox rail");
    await expect(rail).toBeVisible();
    const oracleButton = rail.getByRole("button", { name: "Oracle Amigo" });
    const oracleLogo = oracleButton.getByRole("img", { name: "Oracle" });
    await expect(oracleLogo).toBeVisible();
    const oracleButtonBox = await oracleButton.boundingBox();
    const oracleLogoBox = await oracleLogo.boundingBox();
    expect(oracleButtonBox?.width).toBeGreaterThanOrEqual(48);
    expect(oracleLogoBox?.width).toBeLessThanOrEqual(48);
    expect(oracleLogoBox?.height).toBeLessThanOrEqual(48);
    const railBox = await rail.boundingBox();
    expect(railBox?.width).toBeGreaterThanOrEqual(70);
    expect(railBox?.width).toBeLessThanOrEqual(74);

    const avatar = rail.locator(".oa-rail-avatar").first();
    await expect(avatar).toBeVisible();
    const avatarBox = await avatar.boundingBox();
    expect(avatarBox?.width).toBeGreaterThanOrEqual(32);
    expect(avatarBox?.width).toBeLessThanOrEqual(48);
    expect(avatarBox?.width).toBeGreaterThanOrEqual(38);
    expect(avatarBox?.width).toBeLessThanOrEqual(42);
    const avatarStyle = await avatar.evaluate((node) => {
      const style = window.getComputedStyle(node);
      return { borderRadius: style.borderRadius };
    });
    expect(avatarStyle.borderRadius).not.toBe("0px");
    const presenceBadge = rail.locator(".oa-rail-presence-badge").first();
    await expect(presenceBadge).toBeVisible();
    const badgeBox = await presenceBadge.boundingBox();
    expect(badgeBox?.width).toBeGreaterThanOrEqual(10);
    expect(badgeBox?.width).toBeLessThanOrEqual(16);
    if (!avatarBox || !badgeBox) throw new Error("Rail avatar and badge geometry was not available");
    expect(badgeBox.x).toBeGreaterThan(avatarBox.x + avatarBox.width * 0.65);
    expect(badgeBox.y).toBeGreaterThan(avatarBox.y + avatarBox.height * 0.65);
    const badgeStyle = await presenceBadge.evaluate((node) => {
      const style = window.getComputedStyle(node);
      return { backgroundColor: style.backgroundColor, borderRadius: style.borderRadius };
    });
    expect(badgeStyle.borderRadius).not.toBe("0px");
    expect(badgeStyle.backgroundColor).not.toBe("rgba(0, 0, 0, 0)");
    expect(badgeStyle.backgroundColor).toBe("rgb(34, 197, 94)");

    await oracleButton.click();
    await expect(page).toHaveURL(/\/chats$/);
  });

  test("logs out from the active shell and returns to login", async ({ page }) => {
    let status = "enrolled";
    await mockEnrolledAgent(page, { statusProvider: () => cloudStatus(status) });
    await page.route("**/cloud/logout", async (route) => {
      status = "disconnected";
      await route.fulfill({ json: { ok: true, remoteRevoked: true } });
    });

    await page.goto("/");
    await expect(page).toHaveURL(/\/inbox$/);
    await page.getByRole("button", { name: "Log out" }).click();

    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole("heading", { name: "Oracle Amigo" })).toBeVisible();
    await expect(page.getByRole("tablist", { name: "Auth mode" })).toBeVisible();
  });

  test("primary tabs render functional routed content", async ({ page }) => {
    await mockEnrolledAgent(page);
    await page.goto("/");

    const tabs = [
      { name: "Agents", url: /\/agents$/, text: "Agents" },
      { name: "Approvals", url: /\/approvals$/, text: "No pending approvals" },
      { name: "Vault", url: /\/files$/, text: "Vault" },
      { name: "Missions", url: /\/tasks$/, text: "Missions" },
      { name: "Audit", url: /\/audit$/, text: "Activity Log" },
    ];

    for (const tab of tabs) {
      await page.getByRole("button", { name: tab.name }).first().click();
      await expect(page).toHaveURL(tab.url);
      const main = page.getByRole("main", { name: "Main content" });
      await expect(main).toContainText(tab.text);
      await expect(main).not.toContainText(/coming soon/i);
    }

    await page.getByRole("button", { name: "Settings" }).click();
    await expect(page).toHaveURL(/\/settings$/);
    await expect(page.getByRole("main", { name: "Main content" })).toContainText("Account");
  });

  test("detects and sends a file request from the active composer", async ({ page }) => {
    await mockEnrolledAgent(page);
    await page.goto("/");
    await page.getByLabel("People and inbox rail").getByRole("button", { name: "Oracle Amigo" }).click();
    await page.getByRole("button", { name: "Open chat with My local agent" }).click();

    const textbox = page.getByPlaceholder("Type a message or / for commands...");
    await textbox.fill("Can you send me the API design document?");

    await expect(page.getByText("Sending as file request")).toBeVisible();
    await page.getByRole("button", { name: "Send message" }).click();
    await expect(page.getByText("Send file request?")).toBeVisible();
    await page.getByRole("button", { name: "Approve" }).click();

    const timeline = page.getByRole("log", { name: "Message timeline" });
    await expect(timeline.getByText("Can you send me the API design document?")).toBeVisible();
    await expect(timeline.getByText(/queued at relay|delivered|sending/i)).toBeVisible();
  });

  test("mocked release flow reaches approval and receipt pages", async ({ page }) => {
    await mockReleaseFlow(page);
    await page.goto("/");
    await page.getByRole("link", { name: "Sign up" }).click();

    await page.getByRole("textbox", { name: "Display Name" }).fill("Alice Release");
    await page.getByLabel("Email").fill("alice.release@example.com");
    await page.getByRole("textbox", { name: "Password" }).fill("correctHorseBatteryStaple-9!");
    await page.getByRole("button", { name: /create account/i }).click();

    await expect(page).toHaveURL(/\/enroll$/);
    await expect(page.getByRole("heading", { name: "Enroll Device" })).toBeVisible();
    await page.getByLabel("Agent Display Name").fill("Alice release agent");
    await page.getByRole("button", { name: /enroll device/i }).click();

    await expect(page).toHaveURL(/\/inbox$/);
    await page.getByLabel("People and inbox rail").getByRole("button", { name: "Oracle Amigo" }).click();
    await page.getByRole("button", { name: "Open chat with My local agent" }).click();
    await page.getByPlaceholder("Type a message or / for commands...").fill("Please send the release checklist document");
    await page.getByRole("button", { name: "Send message" }).click();
    await page.getByRole("button", { name: "Approve" }).click();

    await page.getByRole("button", { name: "Approvals" }).click();
    await expect(page.getByRole("button", { name: /release-checklist\.pdf Local/ })).toBeVisible();
    await page.getByRole("button", { name: /Approve/i }).click();

    await page.getByRole("button", { name: "Vault" }).click();
    await expect(page.getByRole("main", { name: "Main content" }).getByText("release-checklist.pdf")).toBeVisible();
  });
});

async function mockCloudStatus(page, status) {
  await page.route("**/cloud/status", (route) => route.fulfill({
    json: status,
    headers: { "Cache-Control": "no-store" }
  }));
}

function cloudStatus(status) {
  return {
    cloud: {
      profileId: `playwright-${status}`,
      controlPlaneUrl: "http://127.0.0.1:8080",
      orgId: status === "disconnected" ? null : "org-test",
      userId: status === "disconnected" ? null : "user-alice",
      userEmail: status === "disconnected" ? null : "alice@example.com",
      displayName: status === "disconnected" ? null : "Alice",
      deviceId: status === "enrolled" ? "device-a" : null,
      agentId: status === "enrolled" ? "agent-a" : null,
      agentInstanceId: status === "enrolled" ? "agent-instance-a" : null,
      relayInboxUrl: status === "enrolled" ? "http://127.0.0.1:8080/v1/relay/a2a/inbox" : null,
      status,
      hasUserAccessToken: status !== "disconnected",
      hasDeviceAccessToken: status === "enrolled",
      hasRefreshToken: status !== "disconnected",
      updatedAt: now
    },
    heartbeat: { running: status === "enrolled", lastResult: status === "enrolled" ? { ok: true } : null, lastError: null },
    inbox: { running: status === "enrolled", lastItemCount: 0, lastError: null },
    relayMode: "polling",
    defaults: {
      localAgentUrl: "http://127.0.0.1:3427",
      controlPlaneUrl: "http://127.0.0.1:8080",
      orgSlug: "local-dev"
    }
  };
}

async function mockEnrolledAgent(page, options = {}) {
  if (options.statusProvider) {
    await page.route("**/cloud/status", (route) => route.fulfill({
      json: options.statusProvider(),
      headers: { "Cache-Control": "no-store" }
    }));
  } else {
    await mockCloudStatus(page, cloudStatus("enrolled"));
  }
  await page.route("**/health", (route) => route.fulfill({ json: { status: "ok", dryRun: true } }));
  await page.route("**/relay/inbox/status", (route) => route.fulfill({ json: { running: true, lastItemCount: 0, lastError: null } }));
  await page.route("**/cloud/contacts", (route) => route.fulfill({ json: { contacts: [] } }));
  await page.route("**/cloud/directory/users**", (route) => route.fulfill({ json: { users: [] } }));
  await page.route("**/approvals/pending", (route) => route.fulfill({ json: { approvals: [] } }));
  await page.route("**/storage/files", (route) => route.fulfill({ json: { files: [] } }));
  await page.route("**/audit/events", (route) => route.fulfill({ json: { events: [], chainValid: { valid: true } } }));
  await mockV1Routes(page);
  await mockChatRoutes(page, () => []);
}

async function mockV1Routes(page) {
  await page.route("**/agent/runs", (route) => route.fulfill({ json: { runs: [] } }));
  await page.route("**/a2a/tasks", (route) => route.fulfill({ json: { tasks: [] } }));
  await page.route("**/transfers", (route) => route.fulfill({ json: { transfers: [] } }));
  await page.route("**/files/index-roots", (route) => route.fulfill({ json: { roots: [] } }));
  await page.route("**/files/indexed**", (route) => route.fulfill({ json: { items: [], total: 0, limit: 100, offset: 0 } }));
  await page.route("**/files/search", (route) => route.fulfill({ json: [] }));
  await page.route("**/registry", (route) => route.fulfill({ json: { count: 0, agents: [] } }));
  await page.route("**/skills", (route) => route.fulfill({ json: { count: 0, skills: [] } }));
  await page.route("**/memory/conversations", (route) => route.fulfill({ json: { conversations: [], limit: 25, offset: 0 } }));
  await page.route("**/memory/conversations/*/window**", (route) => route.fulfill({ json: { conversationId: "local-agent", messages: [], maxChars: 8000, maxMessages: 80 } }));
  await page.route("**/memory/episodic**", (route) => route.fulfill({ json: { events: [], limit: 5 } }));
  await page.route("**/memory/long-term**", (route) => route.fulfill({ json: { namespace: "default", memories: [], limit: 5, offset: 0 } }));
  await page.route("**/policy/summary", (route) => route.fulfill({
    json: {
      command: { maxCommandLength: 4000, maxTimeoutMs: 120000, enforcedRules: ["destructive filesystem"] },
      network: { profiles: [] },
      secrets: { redactionEnabled: true, configuredSecretCount: 0, scopedSecretNames: [] }
    }
  }));
  await page.route("**/policy/command/evaluate", (route) => route.fulfill({
    json: { allowed: true, reason: "Command allowed by policy", classification: "test", cappedTimeoutMs: 30000, redactedCommand: "npm test", containsSecret: false }
  }));
  await page.route("**/audit/verify", (route) => route.fulfill({ json: { valid: true } }));
}

async function mockChatRoutes(page, messagesProvider) {
  const sentMessages = [];
  await page.route("**/chat/conversations", (route) => route.fulfill({
    json: {
      conversations: [{
        id: "local-agent",
        title: "My local agent",
        subtitle: "Local chat",
        agentInstanceId: null,
        presence: "online",
        unread: 0,
        lastMessage: "No messages yet",
          pendingApprovals: 0,
          transferCount: 0,
          messages: [seedHumanMessage()]
        }]
    }
  }));
  await page.route("**/chat/conversations/*/messages", (route) => {
    if (route.request().method() === "POST") {
      const body = route.request().postDataJSON();
      sentMessages.push({
        kind: "human",
        id: body.client_message_id ?? "playwright-message",
        conversation_id: "local-agent",
        sender_user_id: "user-alice",
        sender_agent_instance_id: null,
        receiver_agent_instance_id: null,
        text: body.text,
        created_at: now,
        delivery_status: "queued_at_relay",
        relay_task_id: "relay-file-1"
      });
      return route.fulfill({
        json: {
          ok: true,
          conversation_id: "local-agent",
          message_id: "playwright-message",
          relay_task_id: "relay-file-1",
          task_id: "task-release-checklist",
          type: "file_request",
          delivery_status: "queued_at_relay"
        }
      });
    }
    return route.fulfill({ json: { conversationId: "local-agent", messages: [...messagesProvider(), ...sentMessages] } });
  });
}

async function mockReleaseFlow(page) {
  let phase = "signed-out";
  let approvalPending = false;
  let approved = false;

  await page.route("**/cloud/status", (route) => route.fulfill({
    json: phase === "signed-out" ? cloudStatus("disconnected") : cloudStatus(phase === "enrolled" ? "enrolled" : "authenticated"),
    headers: { "Cache-Control": "no-store" }
  }));
  await page.route("**/cloud/signup", async (route) => {
    phase = "authenticated";
    await route.fulfill({ json: { ok: true } });
  });
  await page.route("**/cloud/login", async (route) => {
    phase = "authenticated";
    await route.fulfill({ json: { ok: true } });
  });
  await page.route("**/cloud/enroll", async (route) => {
    phase = "enrolled";
    await route.fulfill({ json: { ok: true, agent_instance_id: "agent-instance-release" } });
  });
  await page.route("**/health", (route) => route.fulfill({ json: { status: "ok", dryRun: true } }));
  await page.route("**/relay/inbox/status", (route) => route.fulfill({ json: { running: phase === "enrolled", lastItemCount: 0, lastError: null } }));
  await page.route("**/cloud/contacts", (route) => route.fulfill({ json: { contacts: [] } }));
  await page.route("**/cloud/directory/users**", (route) => route.fulfill({ json: { users: [] } }));
  await page.route("**/audit/events", (route) => route.fulfill({ json: { events: [], chainValid: { valid: true } } }));
  await mockV1Routes(page);
  await page.route("**/storage/files", (route) => route.fulfill({
    json: {
      files: approved ? [{
        id: "stored-release-checklist",
        originalFileName: "release-checklist.pdf",
        storedPath: "Local path hidden",
        sizeBytes: 2048,
        sha256: "abc123abc123abc123abc123abc123abc123abc123abc123abc123abc123abcd",
        receivedAt: now
      }] : []
    }
  }));
  await page.route("**/approvals/pending", (route) => route.fulfill({
    json: {
      approvals: approvalPending && !approved ? [{
        id: "approval-release-checklist",
        task_id: "task-release-checklist",
        requester_agent_id: "agent-remote",
        request_text: "Please send the release checklist document",
        status: "pending",
        expires_at: now,
        selected_file_id: "candidate-release-checklist",
        bound_file_path: "C:\\Users\\Alice\\Documents\\release-checklist.pdf",
        bound_size_bytes: 2048,
        candidates: [{
          candidate_id: "candidate-release-checklist",
          file_name: "release-checklist.pdf",
          display_path: "Local path hidden from recipient",
          extension: ".pdf",
          mime_type: "application/pdf",
          size_bytes: 2048,
          modified_at: now,
          match_score: 0.98,
          match_reason: "Best release document match",
          safety_labels: ["Approval required", "Local path hidden"]
        }]
      }] : []
    }
  }));
  await page.route("**/approvals/approval-release-checklist/approve", async (route) => {
    approved = true;
    approvalPending = false;
    await route.fulfill({ json: { id: "approval-release-checklist", status: "approved" } });
  });
  await page.route("**/chat/conversations", (route) => route.fulfill({
    json: {
      conversations: [{
        id: "local-agent",
        title: "My local agent",
        subtitle: "Local chat",
        agentInstanceId: null,
        presence: "online",
        unread: 0,
        lastMessage: "No messages yet",
        pendingApprovals: approvalPending && !approved ? 1 : 0,
        transferCount: approved ? 1 : 0,
        messages: [seedHumanMessage()]
      }]
    }
  }));
  await page.route("**/chat/conversations/*/messages", (route) => {
    if (route.request().method() === "POST") {
      approvalPending = true;
      return route.fulfill({
        json: {
          ok: true,
          conversation_id: "local-agent",
          message_id: "release-message",
          task_id: "task-release-checklist",
          type: "file_request",
          delivery_status: "queued_at_relay"
        }
      });
    }
    return route.fulfill({ json: { conversationId: "local-agent", messages: [] } });
  });
}

function seedHumanMessage() {
  return {
    kind: "human",
    id: "seed-message",
    conversation_id: "local-agent",
    sender_user_id: "user-alice",
    sender_agent_instance_id: null,
    receiver_agent_instance_id: null,
    text: "Ready",
    created_at: now,
    delivery_status: "delivered"
  };
}
