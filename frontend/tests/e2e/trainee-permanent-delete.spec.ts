import { expect, test } from "@playwright/test";

function trainee(id: number, firstName: string, lastName: string, groupCode = "180-25") {
  return {
    id,
    branch_id: "main",
    source_row_number: id,
    first_name: firstName,
    last_name: lastName,
    employment_center: null,
    birth_date: null,
    contract_number: `180-25/${String(id).padStart(3, "0")}`,
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
    created_at: "2026-05-04T12:00:00Z",
    updated_at: "2026-05-04T12:00:00Z"
  };
}

test("admin can permanently delete selected trainees and all trainees from the register", async ({ page }) => {
  const state = {
    trainees: [
      trainee(1, "Володимир Юхимович", "Боб-Харланов"),
      trainee(2, "Надія Юріївна", "Герус"),
      trainee(3, "Павло Іванович", "Гриб")
    ],
    selectedPayload: null as null | { trainee_ids: number[] },
    purgeAllCalled: false
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
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([{ id: 1, code: "180-25", name: "Група", capacity: 25, status: "active", start_date: null, end_date: null }])
      });
    }

    if (path.endsWith("/trainees") && method === "GET") {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(state.trainees) });
    }

    if (path.endsWith("/trainees/bulk/purge") && method === "POST") {
      state.selectedPayload = request.postDataJSON() as { trainee_ids: number[] };
      state.trainees = state.trainees.filter((item) => !state.selectedPayload?.trainee_ids.includes(item.id));
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          purged_count: state.selectedPayload.trainee_ids.length,
          purged_ids: state.selectedPayload.trainee_ids,
          missing_ids: []
        })
      });
    }

    if (path.endsWith("/trainees/bulk/purge-all") && method === "POST") {
      state.purgeAllCalled = true;
      const purgedIds = state.trainees.map((item) => item.id);
      state.trainees = [];
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          purged_count: purgedIds.length,
          purged_ids: purgedIds,
          missing_ids: []
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
  await page.getByRole("button", { name: /Група: 180-25/ }).click();

  await page.getByRole("checkbox", { name: /Боб-Харланов/ }).check();
  await page.getByRole("checkbox", { name: /Герус/ }).check();
  await page.getByRole("button", { name: "Видалити слухача" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Видалити" }).click();

  await expect.poll(() => state.selectedPayload).toEqual({ trainee_ids: [1, 2] });
  await expect(page.getByText("Гриб Павло Іванович")).toBeVisible();
  await expect(page.getByText("Боб-Харланов Володимир Юхимович")).not.toBeVisible();

  await page.getByRole("button", { name: "Видалити всіх слухачів" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Видалити всіх" }).click();

  await expect.poll(() => state.purgeAllCalled).toBe(true);
  await expect(page.getByText("За вибраним фільтром записів немає")).toBeVisible();
});
