import { expect, test } from "@playwright/test";

type RoleName = "admin" | "methodist" | "teacher";

const CASES: Array<{ role: RoleName; canAccessGroupsRoute: boolean }> = [
  { role: "admin", canAccessGroupsRoute: true },
  { role: "methodist", canAccessGroupsRoute: true },
  { role: "teacher", canAccessGroupsRoute: false }
];

for (const scenario of CASES) {
  test(`login as ${scenario.role} and check group permissions`, async ({ page }) => {
    await page.route("**/api/v1/**", async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      const path = url.pathname;
      const method = request.method();

      if (path.endsWith("/auth/login") && method === "POST") {
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            access_token: `access-${scenario.role}`,
            refresh_token: `refresh-${scenario.role}`,
            token_type: "bearer"
          })
        });
      }

      if (path.endsWith("/auth/me") && method === "GET") {
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            id: 1,
            username: scenario.role,
            full_name: `Test ${scenario.role}`,
            branch_id: "main",
            roles: [{ id: 1, name: scenario.role }]
          })
        });
      }

      if (path.endsWith("/dashboard/kpi") && method === "GET") {
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            active_groups: 1,
            active_trainees: 10,
            facility_load_pct: 20,
            training_plan_progress_pct: 30,
            forecast_graduation: 9,
            forecast_employment: 7
          })
        });
      }

      if (path.endsWith("/groups") && method === "GET") {
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify([])
        });
      }

      return route.fulfill({
        status: 404,
        contentType: "application/json",
        body: JSON.stringify({ detail: "not mocked" })
      });
    });

    await page.goto("/login");
    await page.locator("input").nth(0).fill(scenario.role);
    await page.locator("input[type='password']").first().fill("TestPass123!");
    await page.getByRole("button", { name: "Увійти" }).click();

    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByText("Ролі:")).toBeVisible();

    await page.goto("/groups");
    if (scenario.canAccessGroupsRoute) {
      await expect(page).toHaveURL(/\/groups$/);
      await expect(page.getByText("Створити групу")).toBeVisible();
    } else {
      await expect(page).toHaveURL(/\/$/);
      await expect(page.getByText("Створити групу")).toHaveCount(0);
    }
  });
}
