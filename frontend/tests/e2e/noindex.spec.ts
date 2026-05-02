import { expect, test } from "@playwright/test";

test("publishes crawler directives that prevent indexing", async ({ page, request }) => {
  await page.goto("/");

  await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
    "content",
    /noindex,\s*nofollow,\s*noarchive,\s*nosnippet,\s*noimageindex/i
  );

  const robotsResponse = await request.get("/robots.txt");
  expect(robotsResponse.ok()).toBeTruthy();
  await expect(await robotsResponse.text()).toContain("Disallow: /");
});
