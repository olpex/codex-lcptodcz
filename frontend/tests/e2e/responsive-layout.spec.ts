import { expect, test, type Page } from "@playwright/test";

async function mockAuthorizedDashboard(page: Page) {
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

    if (path.endsWith("/dashboard/kpi") && method === "GET") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          active_groups: 2,
          active_trainees: 30,
          training_plan_progress_pct: 52,
          student_plan_year: 2026,
          student_plan_target: 100,
          student_plan_processed: 52,
          forecast_graduation: 27,
          forecast_employment: 20
        })
      });
    }

    return route.fulfill({
      status: 404,
      contentType: "application/json",
      body: JSON.stringify({ detail: "not mocked" })
    });
  });
}

test.describe("responsive dashboard", () => {
  test("desktop viewport", async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await mockAuthorizedDashboard(page);
    await page.goto("/");
    await expect(page.getByText("СУПТЦ")).toBeVisible();
    await expect(page.getByText("Активні групи")).toBeVisible();
    await expect(page.getByText("Завантаженість бази")).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Навантаження" })).toBeVisible();
  });

  test("tablet viewport", async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 768 });
    await mockAuthorizedDashboard(page);
    await page.goto("/");
    await expect(page.getByText("СУПТЦ")).toBeVisible();
    await expect(page.getByText("Активні слухачі")).toBeVisible();
    await expect(page.getByRole("link", { name: "Розклад" })).toBeVisible();
  });
});
