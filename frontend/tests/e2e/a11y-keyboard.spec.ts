import { expect, test, type Page } from "@playwright/test";

async function mockAuthorizedSchedule(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem(
      "suptc_auth",
      JSON.stringify({
        accessToken: "test-access-token",
        refreshToken: "test-refresh-token"
      })
    );
  });

  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const method = request.method();

    if (path.endsWith("/auth/me") && method === "GET") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          id: 1,
          username: "admin",
          full_name: "Системний адміністратор",
          branch_id: "main",
          roles: [{ id: 1, name: "admin" }]
        })
      });
    }

    if (path.endsWith("/schedule") && method === "GET") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([
          {
            id: 1,
            group_id: 1,
            teacher_id: 1,
            subject_id: 1,
            room_id: 101,
            starts_at: "2026-05-05T09:00:00Z",
            ends_at: "2026-05-05T11:00:00Z",
            pair_number: 1,
            academic_hours: 2,
            group_code: "A-01",
            group_name: "Тестова група",
            teacher_name: "Іваненко І.І.",
            subject_name: "Математика",
            room_name: "101"
          }
        ])
      });
    }

    return route.fulfill({
      status: 404,
      contentType: "application/json",
      body: JSON.stringify({ detail: "not mocked" })
    });
  });
}

test("login form is keyboard focusable", async ({ page }) => {
  await page.goto("/login");
  await page.locator("h1").focus();

  const usernameInput = page.locator("input").first();
  const passwordInput = page.locator("input[type='password']").first();
  const submitButton = page.getByRole("button", { name: "Увійти" });

  await page.keyboard.press("Tab");
  await expect(usernameInput).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(passwordInput).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(submitButton).toBeFocused();
});

test("schedule date accordion toggles with keyboard", async ({ page }) => {
  await mockAuthorizedSchedule(page);
  await page.goto("/schedule");

  const firstDateToggle = page.locator("div.space-y-3 > div > button").first();
  await expect(firstDateToggle).toHaveAttribute("aria-expanded", "false");

  await firstDateToggle.focus();
  await page.keyboard.press("Enter");
  await expect(firstDateToggle).toHaveAttribute("aria-expanded", "true");

  await page.keyboard.press("Enter");
  await expect(firstDateToggle).toHaveAttribute("aria-expanded", "false");
});

test("app layout skip link moves keyboard focus to main content", async ({ page }) => {
  await mockAuthorizedSchedule(page);
  await page.goto("/schedule");

  const skipLink = page.getByRole("link", { name: "Перейти до основного контенту" });
  await expect(skipLink).toBeAttached();
  const firstFocusableText = await page.evaluate(() => {
    const focusable = Array.from(
      document.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      )
    ).filter((element) => element.tabIndex >= 0 && !element.hasAttribute("disabled"));
    return focusable[0]?.textContent?.trim() ?? "";
  });
  expect(firstFocusableText).toBe("Перейти до основного контенту");

  await skipLink.focus();
  await expect(skipLink).toBeFocused();
  await expect(skipLink).toBeVisible();

  await page.keyboard.press("Enter");
  const mainContent = page.locator("main#main-content");
  await expect(page).toHaveURL(/#main-content$/);
  await expect(mainContent).toBeFocused();
});

test("mobile navigation dialog manages keyboard focus", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockAuthorizedSchedule(page);
  await page.goto("/schedule");

  const openMenuButton = page.getByRole("button", { name: "Відкрити меню" });
  await openMenuButton.focus();
  await page.keyboard.press("Enter");

  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Закрити" })).toBeFocused();

  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(openMenuButton).toBeFocused();
});
