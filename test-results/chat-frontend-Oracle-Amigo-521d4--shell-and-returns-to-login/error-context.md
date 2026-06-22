# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: chat-frontend.spec.js >> Oracle Amigo routed chat frontend >> logs out from the active shell and returns to login
- Location: tests\e2e\chat-frontend.spec.js:104:3

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: getByRole('heading', { name: 'Oracle Amigo' })
Expected: visible
Error: strict mode violation: getByRole('heading', { name: 'Oracle Amigo' }) resolved to 2 elements:
    1) <h2 class="oa-auth-brand">Oracle Amigo</h2> aka getByRole('heading', { name: 'Oracle Amigo', exact: true })
    2) <h1>Welcome to Oracle Amigo</h1> aka getByRole('heading', { name: 'Welcome to Oracle Amigo' })

Call log:
  - Expect "toBeVisible" with timeout 5000ms
  - waiting for getByRole('heading', { name: 'Oracle Amigo' })

```

# Page snapshot

```yaml
- generic [ref=e1]:
  - main "Authentication and enrollment" [ref=e4]:
    - main "Authentication and enrollment" [ref=e5]:
      - generic "Authentication" [ref=e6]:
        - heading "Oracle Amigo" [level=2] [ref=e12]
        - tablist "Auth mode" [ref=e13]:
          - tab "Log in" [selected] [ref=e14] [cursor=pointer]
          - tab "Sign up" [ref=e15] [cursor=pointer]
      - generic [ref=e17]:
        - generic [ref=e18]:
          - heading "Welcome to Oracle Amigo" [level=1] [ref=e19]
          - paragraph [ref=e20]: Sign in to continue
        - generic [ref=e22]:
          - generic [ref=e23]:
            - generic [ref=e24]: Email
            - generic [ref=e25]:
              - img
              - textbox "Email" [active] [ref=e26]:
                - /placeholder: jane@example.com
          - generic [ref=e27]:
            - generic [ref=e28]: Password
            - generic [ref=e29]:
              - img
              - textbox "Password" [ref=e30]:
                - /placeholder: Enter your password
              - button "Show password" [ref=e31] [cursor=pointer]:
                - img [ref=e32]
          - alert [ref=e35]: Please sign in to continue.
          - button "Log in" [ref=e36] [cursor=pointer]
          - paragraph [ref=e37]:
            - text: Don't have an account?
            - link "Sign up" [ref=e38] [cursor=pointer]:
              - /url: /signup
  - region "1 notification." [ref=e39]:
    - list [ref=e40]:
      - listitem [ref=e41]:
        - alertdialog "Logged out" [ref=e42]:
          - img [ref=e44]
          - alert [ref=e46]: Logged out
          - button "Close" [ref=e47]:
            - img [ref=e48]
```

# Test source

```ts
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
  31  |     expect(canScrollEnrollment).toBe(true);
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
> 118 |     await expect(page.getByRole("heading", { name: "Oracle Amigo" })).toBeVisible();
      |                                                                       ^ Error: expect(locator).toBeVisible() failed
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
  132 |     ];
  133 | 
  134 |     for (const tab of tabs) {
  135 |       await clickAccountAction(page, tab.name);
  136 |       await expect(page).toHaveURL(tab.url);
  137 |       const main = page.getByRole("main", { name: "Main content" });
  138 |       await expect(main).toContainText(tab.text);
  139 |       await expect(main).not.toContainText(/coming soon/i);
  140 |     }
  141 | 
  142 |     await clickAccountAction(page, "Settings");
  143 |     await expect(page).toHaveURL(/\/settings$/);
  144 |     await expect(page.getByRole("main", { name: "Main content" })).toContainText("Account");
  145 |   });
  146 | 
  147 |   test("detects and sends a file request from the active composer", async ({ page }) => {
  148 |     await mockEnrolledAgent(page);
  149 |     await page.goto("/");
  150 |     await page.getByLabel("People and inbox rail").getByRole("button", { name: "Oracle Amigo" }).click();
  151 |     await page.getByRole("button", { name: "Open chat with My local agent" }).click();
  152 | 
  153 |     const textbox = page.getByPlaceholder("Type a message or / for commands...");
  154 |     await textbox.fill("Can you send me the API design document?");
  155 | 
  156 |     await expect(page.getByText("Sending as file request")).toBeVisible();
  157 |     await page.getByRole("button", { name: "Send message" }).click();
  158 |     await expect(page.getByText("Send file request?")).toBeVisible();
  159 |     await page.getByRole("button", { name: "Approve" }).click();
  160 | 
  161 |     const timeline = page.getByRole("log", { name: "Message timeline" });
  162 |     await expect(timeline.getByText("Can you send me the API design document?")).toBeVisible();
  163 |     await expect(timeline.getByText(/queued at relay|delivered|sending/i)).toBeVisible();
  164 |   });
  165 | 
  166 |   test("mocked release flow reaches approval and receipt pages", async ({ page }) => {
  167 |     await mockReleaseFlow(page);
  168 |     await page.goto("/");
  169 |     await page.getByRole("link", { name: "Sign up" }).click();
  170 | 
  171 |     await page.getByRole("textbox", { name: "Display Name" }).fill("Alice Release");
  172 |     await page.getByLabel("Email").fill("alice.release@example.com");
  173 |     await page.getByRole("textbox", { name: "Password" }).fill("correctHorseBatteryStaple-9!");
  174 |     await page.getByRole("button", { name: /create account/i }).click();
  175 | 
  176 |     await expect(page).toHaveURL(/\/enroll$/);
  177 |     await expect(page.getByRole("heading", { name: "Enroll Device" })).toBeVisible();
  178 |     await page.getByLabel("Agent Display Name").fill("Alice release agent");
  179 |     await page.getByRole("button", { name: /enroll device/i }).click();
  180 | 
  181 |     await expect(page).toHaveURL(/\/inbox$/);
  182 |     await page.getByLabel("People and inbox rail").getByRole("button", { name: "Oracle Amigo" }).click();
  183 |     await page.getByRole("button", { name: "Open chat with My local agent" }).click();
  184 |     await page.getByPlaceholder("Type a message or / for commands...").fill("Please send the release checklist document");
  185 |     await page.getByRole("button", { name: "Send message" }).click();
  186 |     await page.getByRole("button", { name: "Approve" }).click();
  187 | 
  188 |     await clickAccountAction(page, "Approvals");
  189 |     await expect(page.getByRole("button", { name: /release-checklist\.pdf Local/ })).toBeVisible();
  190 |     await page.getByRole("button", { name: /Approve/i }).click();
  191 | 
  192 |     await clickAccountAction(page, "Vault");
  193 |     await expect(page.getByRole("main", { name: "Main content" }).getByText("release-checklist.pdf")).toBeVisible();
  194 |   });
  195 | });
  196 | 
  197 | async function openAccountDropdown(page) {
  198 |   const rail = page.getByLabel("People and inbox rail");
  199 |   const trigger = rail.getByRole("button", { name: /Account profile:/ });
  200 |   await trigger.click();
  201 |   const profileItem = page.getByRole("menuitem", { name: "Profile" });
  202 |   try {
  203 |     await profileItem.waitFor({ state: "visible", timeout: 1000 });
  204 |   } catch {
  205 |     await trigger.click({ force: true });
  206 |     await profileItem.waitFor({ state: "visible", timeout: 3000 });
  207 |   }
  208 |   for (const item of ["Profile", "Agents", "Approvals", "Vault", "Missions", "Audit", "Settings", "Log out"]) {
  209 |     await expect(page.getByRole("menuitem", { name: item })).toBeVisible();
  210 |   }
  211 | }
  212 | 
  213 | async function clickAccountAction(page, name) {
  214 |   await openAccountDropdown(page);
  215 |   await page.getByRole("menuitem", { name }).click();
  216 | }
  217 | 
  218 | async function mockCloudStatus(page, status) {
```