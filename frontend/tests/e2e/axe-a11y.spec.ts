import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test("login page has no automatically detectable axe violations", async ({ page }) => {
  await page.goto("/login");

  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
});
