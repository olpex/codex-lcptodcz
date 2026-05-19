import { expect, test } from "@playwright/test";

test("workload page downloads a one-sheet printable summary with current date filters", async ({ page }) => {
  let exportUrl: URL | null = null;

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

    if (path.endsWith("/teacher-workload") && method === "GET") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([
          {
            teacher_id: 1,
            row_number: 1,
            teacher_name: "Войтехівська Галина Михайлівна",
            total_hours: 10,
            annual_load_hours: 180,
            remaining_hours: 170
          }
        ])
      });
    }

    if (path.endsWith("/teacher-workload/export-summary") && method === "GET") {
      exportUrl = url;
      return route.fulfill({
        status: 200,
        contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers: {
          "content-disposition": 'attachment; filename="teacher_workload_summary.xlsx"'
        },
        body: "xlsx-bytes"
      });
    }

    return route.fulfill({
      status: 404,
      contentType: "application/json",
      body: JSON.stringify({ detail: "not mocked" })
    });
  });

  await page.goto("/workload");
  await page.locator('input[type="date"]').nth(0).fill("2026-04-01");
  await page.locator('input[type="date"]').nth(1).fill("2026-04-30");
  await page.getByRole("button", { name: "Друк педнавантаження" }).click();

  await expect.poll(() => exportUrl?.pathname).toContain("/teacher-workload/export-summary");
  expect(exportUrl?.searchParams.get("date_from")).toBe("2026-04-01");
  expect(exportUrl?.searchParams.get("date_to")).toBe("2026-04-30");
});

test("teacher sees workload as read-only without admin-only actions", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      "suptc_auth",
      JSON.stringify({
        accessToken: "teacher-access-token",
        refreshToken: "teacher-refresh-token"
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

    if (path.endsWith("/teacher-workload") && method === "GET") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([
          {
            teacher_id: 7,
            row_number: 1,
            teacher_name: "Тестовий викладач",
            total_hours: 24,
            annual_load_hours: 180,
            remaining_hours: 156,
            groups: [
              {
                group_id: 11,
                group_code: "КН-26",
                group_name: "Комп'ютерні науки",
                hours: 24
              }
            ]
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

  await page.goto("/workload");

  await expect(page.getByRole("cell", { name: "Тестовий викладач", exact: true })).toBeVisible();
  await expect(page.getByText("Режим перегляду")).toBeVisible();
  await expect(page.getByRole("button", { name: "Друк педнавантаження" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Перерахувати години/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Об'єднати обраних/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Експорт/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Зберегти/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Видалити/ })).toHaveCount(0);
});
