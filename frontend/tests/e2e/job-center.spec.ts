import { expect, test } from "@playwright/test";

test("job center shows jobs and allows refresh", async ({ page }) => {
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

    if (path.endsWith("/jobs") && method === "GET") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([
          {
            job_type: "export",
            report_type: "kpi",
            export_format: "xlsx",
            output_document_id: 5,
            job: {
              id: 17,
              status: "succeeded",
              message: "Експорт виконано",
              result_payload: { output_document_id: 5 },
              started_at: "2026-04-24T10:00:00Z",
              finished_at: "2026-04-24T10:00:05Z",
              created_at: "2026-04-24T09:59:59Z",
              updated_at: "2026-04-24T10:00:05Z"
            }
          }
        ])
      });
    }

    if (path.endsWith("/jobs/17") && method === "GET") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          job_type: "export",
          job: {
            id: 17,
            status: "succeeded",
            message: "Експорт виконано",
            result_payload: { output_document_id: 5 },
            started_at: "2026-04-24T10:00:00Z",
            finished_at: "2026-04-24T10:00:05Z",
            created_at: "2026-04-24T09:59:59Z",
            updated_at: "2026-04-24T10:00:05Z"
          }
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
          facility_load_pct: 30,
          training_plan_progress_pct: 40,
          forecast_graduation: 5,
          forecast_employment: 4
        })
      });
    }

    return route.fulfill({
      status: 404,
      contentType: "application/json",
      body: JSON.stringify({ detail: "not mocked" })
    });
  });

  await page.addInitScript(() => {
    localStorage.setItem(
      "suptc_auth",
      JSON.stringify({
        accessToken: "test-access-token",
        refreshToken: "test-refresh-token"
      })
    );
  });

  await page.goto("/jobs");
  await expect(page.getByText("Центр задач імпорту/експорту")).toBeVisible();
  await expect(page.getByText("Експорт виконано")).toBeVisible();
  await page.getByRole("button", { name: "Оновити" }).first().click();
  await expect(page.getByRole("cell", { name: "succeeded" })).toBeVisible();
});
