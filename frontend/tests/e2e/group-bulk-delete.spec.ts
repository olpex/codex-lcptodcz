import { expect, test } from "@playwright/test";

test("admin can delete multiple trainee groups from the groups register", async ({ page }) => {
  const state = {
    groups: [
      { id: 1, code: "46-26", name: "Комп'ютерна обробка", capacity: 25, status: "active", start_date: null, end_date: null },
      { id: 2, code: "180-26", name: "Штучний інтелект", capacity: 30, status: "active", start_date: null, end_date: null },
      { id: 3, code: "KEEP-26", name: "Залишити", capacity: 20, status: "active", start_date: null, end_date: null }
    ],
    bulkPayload: null as null | { group_ids: number[]; delete_trainees: boolean }
  };

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

    if (path.endsWith("/groups") && method === "GET") {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(state.groups) });
    }

    if (path.endsWith("/trainees") && method === "GET") {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([]) });
    }

    if (path.endsWith("/schedule") && method === "GET") {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([]) });
    }

    if (path.endsWith("/teacher-workload") && method === "GET") {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([]) });
    }

    if (path.endsWith("/groups/bulk/delete") && method === "POST") {
      state.bulkPayload = request.postDataJSON() as { group_ids: number[]; delete_trainees: boolean };
      state.groups = state.groups.filter((group) => !state.bulkPayload?.group_ids.includes(group.id));
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          deleted_count: state.bulkPayload.group_ids.length,
          deleted_ids: state.bulkPayload.group_ids,
          missing_ids: [],
          deleted_trainees_count: 0
        })
      });
    }

    return route.fulfill({
      status: 404,
      contentType: "application/json",
      body: JSON.stringify({ detail: "not mocked" })
    });
  });

  await page.goto("/groups");

  await page.getByRole("checkbox", { name: "Вибрати групу 46-26" }).check();
  await page.getByRole("checkbox", { name: "Вибрати групу 180-26" }).check();
  await page.getByRole("button", { name: "Видалити вибрані" }).click();

  const dialog = page.getByRole("alertdialog");
  await dialog.getByRole("checkbox", { name: "Також перемістити всіх слухачів вибраних груп до архіву" }).check();
  await dialog.getByRole("button", { name: "Видалити" }).click();

  await expect.poll(() => state.bulkPayload).toEqual({ group_ids: [1, 2], delete_trainees: true });
  await expect(page.getByRole("row", { name: /KEEP-26/ })).toBeVisible();
  await expect(page.getByRole("row", { name: /46-26/ })).not.toBeVisible();
  await expect(page.getByRole("row", { name: /180-26/ })).not.toBeVisible();
});
