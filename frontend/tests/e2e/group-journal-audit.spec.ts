import { expect, test } from "@playwright/test";

test("groups registry shows separate Drive folder and journal audit flags", async ({ page }) => {
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
          full_name: "System Admin",
          branch_id: "main",
          roles: [{ id: 1, name: "admin" }]
        })
      });
    }

    if (path.endsWith("/groups") && method === "GET") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([
          {
            id: 1,
            code: "10-26",
            name: "Папка і журнал",
            capacity: 30,
            status: "active",
            hidden_from_registry: false,
            start_date: null,
            end_date: null,
            year: 2026,
            has_journal_folder: true,
            has_journal_file: true
          },
          {
            id: 2,
            code: "11-26",
            name: "Тільки папка",
            capacity: 30,
            status: "active",
            hidden_from_registry: false,
            start_date: null,
            end_date: null,
            year: 2026,
            has_journal_folder: true,
            has_journal_file: false
          },
          {
            id: 3,
            code: "12-26",
            name: "Тільки журнал",
            capacity: 30,
            status: "active",
            hidden_from_registry: false,
            start_date: null,
            end_date: null,
            year: 2026,
            has_journal_folder: false,
            has_journal_file: true
          }
        ])
      });
    }

    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([]) });
  });

  await page.goto("/groups");

  await expect(page.getByRole("columnheader", { name: /^Т\s/ })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: /^Ж\s/ })).toBeVisible();
  await expect(page.getByRole("row", { name: /10-26/ }).getByLabel("Тека є")).toBeVisible();
  await expect(page.getByRole("row", { name: /10-26/ }).getByLabel("Журнал є")).toBeVisible();
  await expect(page.getByRole("row", { name: /11-26/ }).getByLabel("Тека є")).toBeVisible();
  await expect(page.getByRole("row", { name: /11-26/ }).getByLabel("Журнал відсутній")).toBeVisible();
  await expect(page.getByRole("row", { name: /12-26/ }).getByLabel("Тека відсутня")).toBeVisible();
  await expect(page.getByRole("row", { name: /12-26/ }).getByLabel("Журнал є")).toBeVisible();
});
