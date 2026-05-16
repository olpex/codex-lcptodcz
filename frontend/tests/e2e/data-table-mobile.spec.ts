import { expect, test, type Page } from "@playwright/test";

async function mockAuthorizedOrders(page: Page) {
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
          roles: [{ id: 1, name: "admin" }, { id: 2, name: "methodist" }]
        })
      });
    }

    if (path.endsWith("/orders") && method === "GET") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([
          {
            id: 1,
            branch_id: "main",
            order_number: "167-25",
            order_type: "enrollment",
            order_date: "2026-05-15",
            status: "approved",
            payload_json: {},
            created_at: "2026-05-15T09:00:00Z"
          },
          {
            id: 2,
            branch_id: "main",
            order_number: "168-25",
            order_type: "internal",
            order_date: "2026-05-16",
            status: "draft",
            payload_json: {},
            created_at: "2026-05-16T10:00:00Z"
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

test("registry data tables stay horizontally scrollable with the first column anchored on mobile", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockAuthorizedOrders(page);

  await page.goto("/orders");

  const scrollRegion = page.getByTestId("data-table-scroll-region");
  await expect(scrollRegion).toBeVisible();
  await expect(scrollRegion).toHaveAttribute("tabindex", "0");
  await expect(scrollRegion).toHaveAttribute("aria-label", "Реєстр наказів");

  const metrics = await scrollRegion.evaluate((element) => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth
  }));
  expect(metrics.scrollWidth).toBeGreaterThan(metrics.clientWidth);

  const firstCell = page.locator("[data-testid='data-table-scroll-region'] tbody tr td:first-child").first();
  const before = await firstCell.boundingBox();
  expect(before).not.toBeNull();

  await scrollRegion.evaluate((element) => {
    element.scrollLeft = 280;
  });

  await expect.poll(() => scrollRegion.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
  const after = await firstCell.boundingBox();
  expect(after).not.toBeNull();
  expect(Math.abs((after?.x ?? 0) - (before?.x ?? 0))).toBeLessThan(2);
});
