import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

async function mockAuthorizedDashboard(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem(
      "suptc_auth",
      JSON.stringify({
        accessToken: "access-admin",
        refreshToken: "refresh-admin"
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

    if (path.endsWith("/dashboard/kpi") && method === "GET") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          active_groups: 5,
          active_trainees: 24,
          training_plan_progress_pct: 48,
          student_plan_year: 2026,
          student_plan_target: 100,
          student_plan_processed: 24,
          forecast_graduation: 20,
          forecast_employment: 14
        })
      });
    }

    if (path.endsWith("/dashboard/attention") && method === "GET") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ generated_at: "2026-05-02T12:00:00Z", total_count: 0, items: [] })
      });
    }

    if (path.endsWith("/teacher-workload") && method === "GET") {
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
}

test("login page has no automatically detectable axe violations", async ({ page }) => {
  await page.goto("/login");

  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
});

test("authenticated dashboard has no automatically detectable axe violations", async ({ page }) => {
  await mockAuthorizedDashboard(page);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Активні групи" })).toBeVisible();

  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
});
