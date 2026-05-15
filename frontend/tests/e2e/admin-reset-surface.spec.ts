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
