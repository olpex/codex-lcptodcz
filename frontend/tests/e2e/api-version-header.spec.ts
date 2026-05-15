import { expect, test } from "@playwright/test";

test("frontend sends the API version header with requests", async ({ page }) => {
  let apiVersion: string | null = null;

  await page.route("**/api/v1/auth/login", async (route) => {
    apiVersion = route.request().headers()["x-api-version"] || null;
    return route.fulfill({
      status: 401,
      contentType: "application/json",
      body: JSON.stringify({ detail: "invalid credentials" })
    });
  });

  await page.goto("/login");
  await page.locator("input").first().fill("admin");
  await page.locator('input[type="password"]').first().fill("wrong-password");
  await page.getByRole("button", { name: /Увійти/ }).click();

  await expect.poll(() => apiVersion).toBe("1");
});
