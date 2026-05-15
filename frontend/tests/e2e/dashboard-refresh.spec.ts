import { expect, test } from "@playwright/test";

test("dashboard refresh keeps the newest KPI response", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      "suptc_auth",
      JSON.stringify({
        accessToken: "access-admin",
        refreshToken: "refresh-admin"
      })
    );
  });

  let kpiRequestCount = 0;
  let releaseInitialKpi: (() => void) | null = null;

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
      kpiRequestCount += 1;
      if (kpiRequestCount === 1) {
        await new Promise<void>((resolve) => {
          releaseInitialKpi = resolve;
        });
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            active_groups: 1,
            active_trainees: 10,
            training_plan_progress_pct: 10,
            student_plan_year: 2026,
            student_plan_target: 100,
            student_plan_processed: 10,
            forecast_graduation: 8,
            forecast_employment: 5
          })
        });
      }

      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          active_groups: 5,
          active_trainees: 24,
          training_plan_progress_pct: 24,
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

  await page.goto("/");
  await expect(page.getByText("СУПТЦ")).toBeVisible();
  await page.getByRole("button", { name: "Оновити" }).click();

  const activeGroupsCard = page.locator("section").filter({ has: page.getByRole("heading", { name: "Активні групи" }) });
  const activeTraineesCard = page.locator("section").filter({ has: page.getByRole("heading", { name: "Активні слухачі" }) });

  await expect(activeGroupsCard.locator("p").first()).toHaveText("5");
  await expect(activeTraineesCard.locator("p").first()).toHaveText("24");
  releaseInitialKpi?.();

  await expect(activeGroupsCard.locator("p").first()).toHaveText("5");
  await expect(activeTraineesCard.locator("p").first()).toHaveText("24");
});

test("teacher dashboard skips management attention checks", async ({ page }) => {
  let attentionRequests = 0;

  await page.addInitScript(() => {
    localStorage.setItem(
      "suptc_auth",
      JSON.stringify({
        accessToken: "access-teacher",
        refreshToken: "refresh-teacher"
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
          id: 7,
          username: "teacher",
          full_name: "Тестовий викладач",
          branch_id: "main",
          roles: [{ id: 3, name: "teacher" }]
        })
      });
    }

    if (path.endsWith("/dashboard/kpi") && method === "GET") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          active_groups: 2,
          active_trainees: 18,
          training_plan_progress_pct: 45,
          student_plan_year: 2026,
          student_plan_target: 40,
          student_plan_processed: 18,
          forecast_graduation: 12,
          forecast_employment: 9
        })
      });
    }

    if (path.endsWith("/dashboard/attention") && method === "GET") {
      attentionRequests += 1;
      return route.fulfill({
        status: 403,
        contentType: "application/json",
        body: JSON.stringify({ detail: "Forbidden" })
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

  await page.goto("/");

  await expect(page.getByRole("heading", { name: "Активні групи" })).toBeVisible();
  await expect(page.getByText("Управлінські перевірки")).toBeVisible();
  expect(attentionRequests).toBe(0);
  await expect(page.getByText("Forbidden")).toHaveCount(0);
});
