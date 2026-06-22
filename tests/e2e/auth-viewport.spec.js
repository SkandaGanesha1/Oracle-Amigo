import { expect, test } from "@playwright/test";

const viewports = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "tablet", width: 1024, height: 900 },
  { name: "mobile", width: 390, height: 844 },
];

for (const viewport of viewports) {
  for (const route of ["/login", "/signup"]) {
    test(`auth screen ${route} has no overflow at ${viewport.name}`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.route("**/cloud/status", (route) =>
        route.fulfill({
          json: cloudStatus("disconnected"),
          headers: { "Cache-Control": "no-store" },
        })
      );
      await page.goto("/");
      await expect(page).toHaveURL(/\/login$/);
      if (route === "/signup") {
        await page.getByRole("link", { name: "Sign up" }).click();
        await expect(page).toHaveURL(/\/signup$/);
      }

      await expect(page.locator(".oa-auth-card")).toBeVisible();
      await expect(page.locator(".oa-auth-submit")).toBeVisible();

      const metrics = await page.evaluate(() => {
        const doc = document.documentElement;
        const card = document.querySelector(".oa-auth-card")?.getBoundingClientRect();
        const submit = document.querySelector(".oa-auth-submit")?.getBoundingClientRect();
        const inputs = Array.from(document.querySelectorAll(".oa-auth-input")).map((input) =>
          input.getBoundingClientRect()
        );
        return {
          overflowX: doc.scrollWidth > doc.clientWidth,
          cardFits: Boolean(card && card.left >= 0 && card.right <= window.innerWidth),
          submitFits: Boolean(submit && submit.bottom <= window.innerHeight),
          minInputHeight: Math.min(...inputs.map((input) => input.height)),
        };
      });

      expect(metrics.overflowX).toBe(false);
      expect(metrics.cardFits).toBe(true);
      expect(metrics.submitFits).toBe(true);
      expect(metrics.minInputHeight).toBeGreaterThanOrEqual(44);
    });
  }
}

function cloudStatus(status) {
  return {
    cloud: {
      profileId: `playwright-${status}`,
      controlPlaneUrl: "http://127.0.0.1:8080",
      orgId: null,
      userId: null,
      userEmail: null,
      displayName: null,
      deviceId: null,
      agentId: null,
      agentInstanceId: null,
      relayInboxUrl: null,
      status,
      hasUserAccessToken: false,
      hasDeviceAccessToken: false,
      hasRefreshToken: false,
      updatedAt: new Date("2026-06-08T00:00:00.000Z").toISOString(),
    },
    heartbeat: { running: false, lastResult: null, lastError: null },
    inbox: { running: false, lastItemCount: 0, lastError: null },
    tokenIssue: null,
    userAuthIssue: "required",
    canRecoverUserToken: false,
    relayMode: "polling",
    defaults: {
      localAgentUrl: "http://127.0.0.1:3427",
      controlPlaneUrl: "http://127.0.0.1:8080",
      orgSlug: "local-dev",
    },
  };
}
