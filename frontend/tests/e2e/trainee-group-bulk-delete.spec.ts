import { expect, test } from "@playwright/test";

function trainee(id: number, firstName: string, lastName: string, groupCode: string) {
  return {
    id,
    branch_id: "main",
    source_row_number: id,
    first_name: firstName,
    last_name: lastName,
    employment_center: null,
    birth_date: null,
    contract_number: `${groupCode}/${String(id).padStart(3, "0")}`,
    certificate_number: null,
    certificate_issue_date: null,
    postal_index: null,
    address: null,
    passport_series: null,
    passport_number: null,
    passport_issued_by: null,
    passport_issued_date: null,
    tax_id: null,
    group_code: groupCode,
    status: "active",
    is_deleted: false,
    deleted_at: null,
    phone: null,
    email: null,
    id_document: null,
    created_at: "2026-05-05T12:00:00Z",
    updated_at: "2026-05-05T12:00:00Z"
  };
}

test("admin can delete selected trainee-register groups with their trainees", async ({ page }) => {
  const state = {
    groups: [
      { id: 1, code: "33-26", name: "Група 33", capacity: 30, status: "active", start_date: null, end_date: null },
      { id: 2, code: "73-26", name: "Група 73", capacity: 30, status: "active", start_date: null, end_date: null },
      { id: 3, code: "83-26", name: "Група 83", capacity: 30, status: "active", start_date: null, end_date: null }
    ],
    trainees: [
      trainee(1, "Іван", "Бойко", "33-26"),
      trainee(2, "Олена", "Коваль", "33-26"),
      trainee(3, "Марія", "Петренко", "73-26"),
      trainee(4, "Павло", "Шевченко", "83-26")
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
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(state.trainees) });
    }

    if (path.endsWith("/groups/bulk/delete") && method === "POST") {
      state.bulkPayload = request.postDataJSON() as { group_ids: number[]; delete_trainees: boolean };
      const deletedCodes = new Set(
        state.groups.filter((group) => state.bulkPayload?.group_ids.includes(group.id)).map((group) => group.code)
      );
      state.groups = state.groups.filter((group) => !state.bulkPayload?.group_ids.includes(group.id));
      state.trainees = state.trainees.filter((item) => !deletedCodes.has(item.group_code));
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          deleted_count: state.bulkPayload.group_ids.length,
          deleted_ids: state.bulkPayload.group_ids,
          missing_ids: [],
          deleted_trainees_count: 3
        })
      });
    }

    return route.fulfill({
      status: 404,
      contentType: "application/json",
      body: JSON.stringify({ detail: "not mocked" })
    });
  });

  await page.goto("/trainees");

  await page.getByRole("checkbox", { name: "Вибрати групу 33-26" }).check();
  await page.getByRole("checkbox", { name: "Вибрати групу 73-26" }).check();
  await page.getByRole("button", { name: "Видалити групи" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Видалити групи" }).click();

  await expect.poll(() => state.bulkPayload).toEqual({ group_ids: [1, 2], delete_trainees: true });
  await expect(page.getByRole("button", { name: /Група: 83-26/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /Група: 33-26/ })).not.toBeVisible();
  await expect(page.getByRole("button", { name: /Група: 73-26/ })).not.toBeVisible();
});
