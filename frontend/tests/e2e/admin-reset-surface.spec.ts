import { expect, test } from "@playwright/test";

test("login page keeps emergency reset off the public surface", async ({ page }) => {
  await page.goto("/login");

  await expect(page.locator('a[href="/login/admin-reset"], a[href="/emergency-reset"]')).toHaveCount(0);
});

test("emergency reset remains available on a dedicated route", async ({ page }) => {
  await page.goto("/emergency-reset");

  await expect(page.locator("form")).toBeVisible();
  await expect(page.locator('input[type="password"]')).toHaveCount(3);
});

test("emergency reset shows session timeout and remaining attempts after failure", async ({ page }) => {
  await page.route("**/api/v1/auth/admin-reset-password", async (route) => {
    return route.fulfill({
      status: 403,
      contentType: "application/json",
      body: JSON.stringify({ detail: "Невірний токен скидання" })
    });
  });

  await page.goto("/emergency-reset");

  const safetyStatus = page.getByTestId("reset-safety-status");
  await expect(safetyStatus).toContainText("Сеанс форми активний");
  await expect(safetyStatus).toContainText("Спроб залишилось: 3");

  await page.getByLabel("Логін").fill("admin");
  await page.locator('input[type="password"]').nth(0).fill("wrong-token");
  await page.locator('input[type="password"]').nth(1).fill("NewPass123!");
  await page.locator('input[type="password"]').nth(2).fill("NewPass123!");
  await page.getByRole("button", { name: "Скинути пароль адміністратора" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Так, скинути пароль" }).click();

  await expect(safetyStatus).toContainText("Спроб залишилось: 2");
  await expect(page).toHaveURL(/\/emergency-reset$/);
});
