import { expect, test, type Page } from "@playwright/test";

type MockScheduleSlot = {
  id: number;
  group_id: number;
  teacher_id: number;
  subject_id: number;
  room_id: number;
  starts_at: string;
  ends_at: string;
  pair_number: number;
  academic_hours: number;
  group_code: string;
  group_name: string;
  teacher_name: string;
  subject_name: string;
  room_name: string;
};

async function mockAuthorizedSchedule(page: Page, slots: MockScheduleSlot[]) {
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

    if (path.endsWith("/schedule") && method === "GET") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(slots)
      });
    }

    return route.fulfill({
      status: 404,
      contentType: "application/json",
      body: JSON.stringify({ detail: "not mocked" })
    });
  });
}

test("schedule filter shows only conflicting lessons", async ({ page }) => {
  const slots: MockScheduleSlot[] = [
    {
      id: 1,
      group_id: 1,
      teacher_id: 7,
      subject_id: 10,
      room_id: 201,
      starts_at: "2026-05-05T09:00:00Z",
      ends_at: "2026-05-05T11:00:00Z",
      pair_number: 1,
      academic_hours: 2,
      group_code: "A-101",
      group_name: "Конфліктна група",
      teacher_name: "Іваненко О.О.",
      subject_name: "Математика",
      room_name: "201"
    },
    {
      id: 2,
      group_id: 1,
      teacher_id: 7,
      subject_id: 11,
      room_id: 301,
      starts_at: "2026-05-05T10:00:00Z",
      ends_at: "2026-05-05T12:00:00Z",
      pair_number: 2,
      academic_hours: 2,
      group_code: "A-101",
      group_name: "Конфліктна група",
      teacher_name: "Іваненко О.О.",
      subject_name: "Фізика",
      room_name: "301"
    },
    {
      id: 3,
      group_id: 2,
      teacher_id: 8,
      subject_id: 12,
      room_id: 205,
      starts_at: "2026-05-06T09:00:00Z",
      ends_at: "2026-05-06T11:00:00Z",
      pair_number: 1,
      academic_hours: 2,
      group_code: "B-202",
      group_name: "Без конфліктів",
      teacher_name: "Петров П.П.",
      subject_name: "Історія",
      room_name: "205"
    }
  ];

  await mockAuthorizedSchedule(page, slots);
  await page.goto("/schedule");

  await expect(page.getByText("Виявлено конфлікти у розкладі")).toBeVisible();

  await page.getByRole("button", { name: "Розгорнути все" }).click();
  await expect(page.getByText("B-202 (Без конфліктів)")).toBeVisible();
  await expect(page.locator("table tbody tr")).toHaveCount(3);

  await page.getByLabel("Лише конфлікти").check();
  await expect(page.getByText("A-101 (Конфліктна група)")).toHaveCount(2);
  await expect(page.getByText("B-202 (Без конфліктів)")).toHaveCount(0);
  await expect(page.locator("table tbody tr")).toHaveCount(2);
  await expect(page.locator("span", { hasText: "Конфлікт" })).toHaveCount(2);
});

test("schedule filter shows empty state when conflicts are absent", async ({ page }) => {
  const slots: MockScheduleSlot[] = [
    {
      id: 11,
      group_id: 3,
      teacher_id: 9,
      subject_id: 13,
      room_id: 105,
      starts_at: "2026-06-01T09:00:00Z",
      ends_at: "2026-06-01T11:00:00Z",
      pair_number: 1,
      academic_hours: 2,
      group_code: "C-303",
      group_name: "Ранкова група",
      teacher_name: "Коваленко К.К.",
      subject_name: "Українська мова",
      room_name: "105"
    },
    {
      id: 12,
      group_id: 4,
      teacher_id: 10,
      subject_id: 14,
      room_id: 106,
      starts_at: "2026-06-01T12:00:00Z",
      ends_at: "2026-06-01T14:00:00Z",
      pair_number: 3,
      academic_hours: 2,
      group_code: "D-404",
      group_name: "Денна група",
      teacher_name: "Мельник М.М.",
      subject_name: "Інформатика",
      room_name: "106"
    }
  ];

  await mockAuthorizedSchedule(page, slots);
  await page.goto("/schedule");

  await expect(page.getByText("Виявлено конфлікти у розкладі")).toHaveCount(0);
  await page.getByLabel("Лише конфлікти").check();
  await expect(page.getByText("Конфліктних занять не знайдено.")).toBeVisible();
  await expect(page.locator("table")).toHaveCount(0);
});
