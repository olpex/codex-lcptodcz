import { expect, test } from "@playwright/test";

test("login page renders", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByText("СУПТЦ")).toBeVisible();
  await expect(page.getByRole("button", { name: "Увійти" })).toBeVisible();
});

