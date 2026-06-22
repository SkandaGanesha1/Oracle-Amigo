# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: chat-frontend.spec.js >> Oracle Amigo routed chat frontend >> redirects authenticated users without an enrolled device to enrollment
- Location: tests\e2e\chat-frontend.spec.js:17:3

# Error details

```
Error: expect(received).toBe(expected) // Object.is equality

Expected: true
Received: false
```

# Page snapshot

```yaml
- main "Authentication and enrollment" [ref=e4]:
  - main "Device enrollment" [ref=e5]:
    - generic "Enrollment" [ref=e6]:
      - heading "Oracle Amigo" [level=2] [ref=e12]
      - button "Log out" [ref=e14] [cursor=pointer]:
        - img [ref=e15]
        - generic [ref=e18]: Log out
    - form "Device enrollment form" [ref=e20]:
      - generic [ref=e21]:
        - heading "Enroll Device" [level=1] [ref=e22]
        - paragraph [ref=e23]: Register this device and agent with the control plane
      - region "Device Identity" [ref=e24]:
        - generic [ref=e25]:
          - heading "Device Identity" [level=2] [ref=e26]
          - generic [ref=e27]: Local
        - generic [ref=e28]:
          - generic [ref=e29]:
            - term [ref=e30]: Device Name
            - definition [ref=e31]: Win32
          - generic [ref=e32]:
            - term [ref=e33]: OS
            - definition [ref=e34]: Windows
          - generic [ref=e35]:
            - term [ref=e36]: Public Key Fingerprint
            - definition [ref=e37]:
              - code [ref=e38]: pending...
      - region "Personal Agent" [ref=e39]:
        - heading "Personal Agent" [level=2] [ref=e41]
        - paragraph [ref=e42]: This agent will be visible to other users in the directory and can handle file requests and transfers.
        - generic [ref=e43]:
          - generic [ref=e44]: Agent Display Name
          - textbox "Agent Display Name" [ref=e46]: Oracle Amigo Local Agent
      - button "Enroll Device" [ref=e47] [cursor=pointer]
```

# Test source

```ts
  1   | import { expect, test } from "@playwright/test";
  2   | 
  3   | const now = new Date("2026-06-08T00:00:00.000Z").toISOString();
  4   | 
  5   | test.describe("Oracle Amigo routed chat frontend", () => {
  6   |   test("redirects disconnected users to login", async ({ page }) => {
  7   |     await mockCloudStatus(page, cloudStatus("disconnected"));
  8   |     await page.goto("/");
  9   | 
  10  |     await expect(page).toHaveURL(/\/login$/);
  11  |     await expect(page.getByRole("heading", { name: "Oracle Amigo" })).toBeVisible();
  12  |     await expect(page.getByRole("tablist", { name: "Auth mode" })).toBeVisible();
  13  |     await expect(page.getByLabel("Email")).toBeVisible();
  14  |     await expect(page.getByRole("textbox", { name: "Password" })).toBeVisible();
  15  |   });
  16  | 
  17  |   test("redirects authenticated users without an enrolled device to enrollment", async ({ page }) => {
  18  |     await page.setViewportSize({ width: 1280, height: 720 });
  19  |     await mockCloudStatus(page, cloudStatus("authenticated"));
  20  |     await page.goto("/");
  21  | 
  22  |     await expect(page).toHaveURL(/\/enroll$/);
  23  |     await expect(page.getByRole("heading", { name: "Enroll Device" })).toBeVisible();
  24  |     await expect(page.getByLabel("Agent Display Name")).toBeVisible();
  25  |     await expect(page.getByRole("button", { name: "Log out" })).toBeVisible();
  26  |     await expect(page.getByRole("button", { name: /enroll device/i })).toBeVisible();
  27  |     const canScrollEnrollment = await page.getByTestId("auth-route-scroll").evaluate((node) => {
  28  |       node.scrollTop = node.scrollHeight;
  29  |       return node.scrollTop > 0 && node.scrollHeight > node.clientHeight;
  30  |     });
> 31  |     expect(canScrollEnrollment).toBe(true);
      |                                 ^ Error: expect(received).toBe(expected) // Object.is equality
  32  |   });
  33  | 
  34  |   test("renders enrolled chat shell with active routed regions", async ({ page }) => {
  35  |     await mockEnrolledAgent(page);
  36  |     await page.goto("/");
  37  | 
  38  |     await expect(page).toHaveURL(/\/inbox$/);
  39  |     await expect(page.getByRole("button", { name: "Oracle Amigo" })).toBeVisible();
  40  |     await expect(page.getByRole("banner")).toHaveCount(0);
  41  |     await expect(page.getByRole("navigation", { name: "Intent Inbox" })).toHaveCount(0);
  42  |     await expect(page.getByRole("main", { name: "Main content" })).toBeVisible();
  43  |     await expect(page.getByRole("main", { name: "Main content" })).toContainText("Action Center");
  44  |     await expect(page.getByRole("main", { name: "Main content" })).toContainText("Inbox");
  45  | 
  46  |     const rail = page.getByLabel("People and inbox rail");
  47  |     await expect(rail).toBeVisible();
  48  |     const oracleButton = rail.getByRole("button", { name: "Oracle Amigo" });
  49  |     const oracleLogo = oracleButton.getByRole("img", { name: "Oracle" });
  50  |     await expect(oracleLogo).toBeVisible();
  51  |     const oracleButtonBox = await oracleButton.boundingBox();
  52  |     const oracleLogoBox = await oracleLogo.boundingBox();
  53  |     expect(oracleButtonBox?.width).toBeGreaterThanOrEqual(48);
  54  |     expect(oracleLogoBox?.width).toBeLessThanOrEqual(48);
  55  |     expect(oracleLogoBox?.height).toBeLessThanOrEqual(48);
  56  |     const railBox = await rail.boundingBox();
  57  |     expect(railBox?.width).toBeGreaterThanOrEqual(70);
  58  |     expect(railBox?.width).toBeLessThanOrEqual(74);
  59  | 
  60  |     const avatar = rail.locator(".oa-rail-avatar").first();
  61  |     await expect(avatar).toBeVisible();
  62  |     const avatarBox = await avatar.boundingBox();
  63  |     expect(avatarBox?.width).toBeGreaterThanOrEqual(32);
  64  |     expect(avatarBox?.width).toBeLessThanOrEqual(48);
  65  |     expect(avatarBox?.width).toBeGreaterThanOrEqual(38);
  66  |     expect(avatarBox?.width).toBeLessThanOrEqual(42);
  67  |     const avatarStyle = await avatar.evaluate((node) => {
  68  |       const style = window.getComputedStyle(node);
  69  |       return { borderRadius: style.borderRadius };
  70  |     });
  71  |     expect(avatarStyle.borderRadius).not.toBe("0px");
  72  |     const presenceBadge = rail.locator(".oa-rail-presence-badge").first();
  73  |     await expect(presenceBadge).toBeVisible();
  74  |     const badgeBox = await presenceBadge.boundingBox();
  75  |     expect(badgeBox?.width).toBeGreaterThanOrEqual(10);
  76  |     expect(badgeBox?.width).toBeLessThanOrEqual(16);
  77  |     if (!avatarBox || !badgeBox) throw new Error("Rail avatar and badge geometry was not available");
  78  |     expect(badgeBox.x).toBeGreaterThan(avatarBox.x + avatarBox.width * 0.65);
  79  |     expect(badgeBox.y).toBeGreaterThan(avatarBox.y + avatarBox.height * 0.65);
  80  |     const badgeStyle = await presenceBadge.evaluate((node) => {
  81  |       const style = window.getComputedStyle(node);
  82  |       return { backgroundColor: style.backgroundColor, borderRadius: style.borderRadius };
  83  |     });
  84  |     expect(badgeStyle.borderRadius).not.toBe("0px");
  85  |     expect(badgeStyle.backgroundColor).not.toBe("rgba(0, 0, 0, 0)");
  86  |     expect(badgeStyle.backgroundColor).toBe("rgb(34, 197, 94)");
  87  | 
  88  |     await openAccountDropdown(page);
  89  |     await page.getByRole("menuitem", { name: "Profile" }).click();
  90  |     const profileDrawer = page.getByRole("dialog", { name: "Account profile drawer" });
  91  |     await expect(profileDrawer).toBeVisible();
  92  |     await expect(profileDrawer).toContainText("User Profile");
  93  |     await expect(profileDrawer).toContainText("Device & Agent");
  94  |     for (const label of ["Name", "Email", "User ID", "Device ID", "Agent ID", "Agent Instance", "Connection"]) {
  95  |       await expect(profileDrawer).toContainText(label);
  96  |     }
  97  |     await profileDrawer.getByRole("button", { name: "Close profile drawer" }).click();
  98  |     await expect(profileDrawer).toBeHidden();
  99  | 
  100 |     await oracleButton.click();
  101 |     await expect(page).toHaveURL(/\/chats(?:\/local-agent)?$/);
  102 |   });
  103 | 
  104 |   test("logs out from the active shell and returns to login", async ({ page }) => {
  105 |     let status = "enrolled";
  106 |     await mockEnrolledAgent(page, { statusProvider: () => cloudStatus(status) });
  107 |     await page.route("**/cloud/logout", async (route) => {
  108 |       status = "disconnected";
  109 |       await route.fulfill({ json: { ok: true, remoteRevoked: true } });
  110 |     });
  111 | 
  112 |     await page.goto("/");
  113 |     await expect(page).toHaveURL(/\/inbox$/);
  114 |     await openAccountDropdown(page);
  115 |     await page.getByRole("menuitem", { name: "Log out" }).click();
  116 | 
  117 |     await expect(page).toHaveURL(/\/login$/);
  118 |     await expect(page.getByRole("heading", { name: "Oracle Amigo" })).toBeVisible();
  119 |     await expect(page.getByRole("tablist", { name: "Auth mode" })).toBeVisible();
  120 |   });
  121 | 
  122 |   test("primary tabs render functional routed content", async ({ page }) => {
  123 |     await mockEnrolledAgent(page);
  124 |     await page.goto("/");
  125 | 
  126 |     const tabs = [
  127 |       { name: "Agents", url: /\/agents$/, text: "Agents" },
  128 |       { name: "Approvals", url: /\/approvals$/, text: "No pending approvals" },
  129 |       { name: "Vault", url: /\/files$/, text: "Vault" },
  130 |       { name: "Missions", url: /\/tasks$/, text: "Missions" },
  131 |       { name: "Audit", url: /\/audit$/, text: "Activity Log" },
```