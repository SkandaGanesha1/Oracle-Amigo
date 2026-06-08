import { expect, test } from "@playwright/test";

const now = new Date("2026-06-08T00:00:00.000Z").toISOString();

test.describe("Oracle Amigo chat frontend", () => {
  test("renders the auth screen with accessible login controls", async ({ page }) => {
    await page.goto("/");

    await expect(page.getByRole("region", { name: "Agentic Chat" })).toBeVisible();
    await expect(page.getByRole("tablist", { name: "Authentication mode" })).toBeVisible();
    await expect(page.getByRole("textbox", { name: "Email" })).toBeVisible();
    await expect(page.getByRole("textbox", { name: "Password" })).toBeVisible();
    await expect(page.getByRole("textbox", { name: "Control-plane URL" })).toBeVisible();
  });

  test("renders the enrolled chat shell with accessible regions", async ({ page }) => {
    await mockEnrolledAgent(page);
    await page.goto("/");

    await expect(page.getByLabel("Oracle Amigo agentic chat application")).toBeVisible();
    await expect(page.getByLabel("Connection status")).toBeVisible();
    await expect(page.getByLabel("Contacts and conversations")).toBeVisible();
    await expect(page.getByLabel("Message composer")).toBeVisible();
    await expect(page.getByLabel("Conversation details")).toBeVisible();
  });

  test("detects and sends a file request from the composer", async ({ page }) => {
    await mockEnrolledAgent(page);
    await page.goto("/");

    const textbox = page.getByPlaceholder(/message a person or agent/i);
    await textbox.fill("Can you send me the API design document?");

    await expect(page.getByText(/file-request detected/i)).toBeVisible();
    await page.getByRole("button", { name: /send message/i }).click();

    const chat = page.getByLabel("Conversation with My local agent");
    await expect(chat.getByText(/API design document/i)).toBeVisible();
    await expect(chat.getByText(/local pending|sent|delivered/i)).toBeVisible();
  });
});

async function mockEnrolledAgent(page) {
  const status = {
    cloud: {
      profileId: "playwright",
      controlPlaneUrl: "http://127.0.0.1:8080",
      orgId: "org-test",
      userId: "user-alice",
      userEmail: "alice@example.com",
      displayName: "Alice",
      deviceId: "device-a",
      agentId: "agent-a",
      agentInstanceId: "agent-instance-a",
      relayInboxUrl: "http://127.0.0.1:8080/v1/relay/a2a/inbox",
      status: "enrolled",
      hasUserAccessToken: true,
      hasDeviceAccessToken: true,
      hasRefreshToken: true,
      updatedAt: now
    },
    heartbeat: { running: true, lastResult: { ok: true }, lastError: null },
    inbox: { running: true, lastItemCount: 0, lastError: null },
    relayMode: "polling"
  };

  await page.route("**/cloud/status", (route) => route.fulfill({ json: status }));
  await page.route("**/health", (route) => route.fulfill({ json: { status: "ok", dryRun: true } }));
  await page.route("**/relay/inbox/status", (route) => route.fulfill({ json: { running: true, lastItemCount: 0, lastError: null } }));
  await page.route("**/cloud/contacts", (route) => route.fulfill({ json: { contacts: [] } }));
  await page.route("**/approvals/pending", (route) => route.fulfill({ json: { approvals: [] } }));
  await page.route("**/storage/files", (route) => route.fulfill({ json: { files: [] } }));
  await page.route("**/audit/events", (route) => route.fulfill({ json: { events: [], chainValid: { valid: true } } }));
  await page.route("**/relay/send-message", (route) => route.fulfill({ json: { relay_task_id: "relay-msg-1", status: "sent" } }));
  await page.route("**/relay/send-file-request", (route) => route.fulfill({ json: { relay_task_id: "relay-file-1", status: "sent" } }));
}
