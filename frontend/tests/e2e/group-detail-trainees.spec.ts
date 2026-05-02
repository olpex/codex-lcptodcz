import { expect, test } from "@playwright/test";

test("group detail shows trainees imported from Excel", async ({ page }) => {
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
        body: JSON.stringify([
          { id: 1, code: "180-25", name: "Штучний інтелект", capacity: 30, status: "active", start_date: null, end_date: null },
          { id: 2, code: "46-26", name: "Технології комп'ютерної обробки інформації", capacity: 25, status: "active", start_date: null, end_date: null }
        ])
      });
    }

    if (path.endsWith("/trainees") && method === "GET") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([
          {
            id: 1,
            branch_id: "main",
            source_row_number: 1,
            first_name: "Іван Іванович",
            last_name: "Іваненко",
            employment_center: "Львівський ОЦЗ",
            birth_date: "2000-02-01",
            contract_number: "180-25/001",
            certificate_number: null,
            certificate_issue_date: null,
            postal_index: null,
            address: "м. Львів",
            passport_series: null,
            passport_number: null,
            passport_issued_by: null,
            passport_issued_date: null,
            tax_id: null,
            group_code: "180-25",
            status: "active",
            is_deleted: false,
            deleted_at: null,
            phone: "+380501112233",
            email: null,
            id_document: null,
            created_at: "2026-05-02T12:00:00Z",
            updated_at: "2026-05-02T12:00:00Z"
          },
          {
            id: 2,
            branch_id: "main",
            source_row_number: 2,
            first_name: "Петро Петрович",
            last_name: "Петренко",
            employment_center: "Львівський ОЦЗ",
            birth_date: null,
            contract_number: "180-25/002",
            certificate_number: null,
            certificate_issue_date: null,
            postal_index: null,
            address: null,
            passport_series: null,
            passport_number: null,
            passport_issued_by: null,
            passport_issued_date: null,
            tax_id: null,
            group_code: "180-25",
            status: "active",
            is_deleted: false,
            deleted_at: null,
            phone: null,
            email: null,
            id_document: null,
            created_at: "2026-05-02T12:01:00Z",
            updated_at: "2026-05-02T12:01:00Z"
          }
        ])
      });
    }

    if (path.endsWith("/schedule") && method === "GET") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([
          {
            id: 10,
            group_id: 2,
            teacher_id: 7,
            subject_id: 3,
            room_id: 1,
            starts_at: "2026-03-11T09:30:00Z",
            ends_at: "2026-03-11T11:05:00Z",
            pair_number: 1,
            academic_hours: 2,
            group_code: "46-26",
            group_name: "Технології комп'ютерної обробки інформації",
            teacher_name: "Войтехівська Галина Михайлівна",
            subject_name: "Тема",
            room_name: null
          }
        ])
      });
    }

    if (path.match(/\/groups\/\d+\/audit$/) && method === "GET") {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([]) });
    }

    return route.fulfill({
      status: 404,
      contentType: "application/json",
      body: JSON.stringify({ detail: "not mocked" })
    });
  });

  await page.goto("/groups");

  const detail = page.locator("section").filter({ has: page.getByRole("heading", { name: "1.3 Детальна картка групи" }) });
  await expect(detail.getByText("180-25 — Штучний інтелект")).toBeVisible();
  await expect(detail.getByText("Слухачі з Excel")).toBeVisible();
  await expect(detail.getByText("Активних: 2")).toBeVisible();
  await expect(detail.getByText("Іваненко Іван Іванович")).toBeVisible();
  await expect(detail.getByText("180-25/001")).toBeVisible();
  await expect(detail.getByText("+380501112233")).toBeVisible();
});
