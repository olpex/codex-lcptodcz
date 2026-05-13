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

    if (path.endsWith("/teachers") && method === "GET") {
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
  await expect(page.locator("[draggable=true]", { hasText: "B-202" })).toBeVisible();
  await expect(page.getByText("Петров П.")).toBeVisible();

  await page.getByLabel("Лише конфлікти").check();
  await expect(page.locator("[draggable=true]", { hasText: "A-101" }).first()).toBeVisible();
  await expect(page.locator("[draggable=true]", { hasText: "B-202" })).toHaveCount(0);
  await expect(page.getByText("Петров П.")).toHaveCount(0);
  await expect(page.getByText("Конфліктних: 2")).toBeVisible();
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

test("schedule page pulls Google Drive intake and refreshes imported lessons", async ({ page }) => {
  const importedSlot: MockScheduleSlot = {
    id: 41,
    group_id: 46,
    teacher_id: 12,
    subject_id: 22,
    room_id: 302,
    starts_at: "2026-03-11T09:30:00Z",
    ends_at: "2026-03-11T11:05:00Z",
    pair_number: 1,
    academic_hours: 2,
    group_code: "46-26",
    group_name: "Технології комп'ютерної обробки інформації",
    teacher_name: "Войтехівська Г.М.",
    subject_name: "Правові та організаційні основи охорони праці",
    room_name: "Імпорт: 46-26"
  };
  let driveTickRequests = 0;
  let driveProcessed = false;

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

    if (path.endsWith("/journal-monitors/auto-tick") && method === "POST") {
      driveTickRequests += 1;
      driveProcessed = true;
      return route.fulfill({
        status: 202,
        contentType: "application/json",
        body: JSON.stringify({
          processed_sections: 0,
          failed_sections: 0,
          drive_intake_processed: 1,
          drive_intake_failed: 0,
          drive_intake_filename: "46-26 Розклад.docx",
          drive_intake_job_id: 1001
        })
      });
    }

    if (path.endsWith("/schedule") && method === "GET") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(driveProcessed ? [importedSlot] : [])
      });
    }

    if (path.endsWith("/teachers") && method === "GET") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([
          {
            id: 12,
            first_name: "Г.М.",
            last_name: "Войтехівська",
            is_active: true
          }
        ])
      });
    }

    return route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ detail: "not mocked" }) });
  });

  await page.goto("/schedule");

  await expect.poll(() => driveTickRequests).toBeGreaterThan(0);
  await page.getByRole("button", { name: "Розгорнути все" }).click();
  await expect(page.locator("[draggable=true]", { hasText: "46-26" })).toBeVisible();
  await expect(page.locator("[draggable=true]", { hasText: "Войтехівська Г." }).first()).toBeVisible();
});

test("schedule page shows Google Drive intake failures", async ({ page }) => {
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

    if (path.endsWith("/journal-monitors/auto-tick") && method === "POST") {
      return route.fulfill({
        status: 202,
        contentType: "application/json",
        body: JSON.stringify({
          processed_sections: 0,
          failed_sections: 0,
          drive_intake_processed: 0,
          drive_intake_failed: 1,
          drive_intake_message: "Не вдалося отримати доступ до папки Google Drive"
        })
      });
    }

    if (path.endsWith("/schedule") && method === "GET") {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([]) });
    }

    if (path.endsWith("/teachers") && method === "GET") {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([]) });
    }

    return route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ detail: "not mocked" }) });
  });

  await page.goto("/schedule");

  await expect(page.getByText("Не вдалося отримати доступ до папки Google Drive")).toBeVisible();
});

test("same time in the same auditorium is not treated as a conflict", async ({ page }) => {
  const slots: MockScheduleSlot[] = [
    {
      id: 21,
      group_id: 5,
      teacher_id: 11,
      subject_id: 15,
      room_id: 999,
      starts_at: "2026-07-01T09:00:00Z",
      ends_at: "2026-07-01T11:00:00Z",
      pair_number: 1,
      academic_hours: 2,
      group_code: "ONLINE-1",
      group_name: "Дистанційна перша",
      teacher_name: "Шевченко С.С.",
      subject_name: "Онлайн-курс",
      room_name: "Zoom"
    },
    {
      id: 22,
      group_id: 6,
      teacher_id: 12,
      subject_id: 16,
      room_id: 999,
      starts_at: "2026-07-01T09:00:00Z",
      ends_at: "2026-07-01T11:00:00Z",
      pair_number: 1,
      academic_hours: 2,
      group_code: "ONLINE-2",
      group_name: "Дистанційна друга",
      teacher_name: "Франко І.Я.",
      subject_name: "Онлайн-практикум",
      room_name: "Zoom"
    }
  ];

  await mockAuthorizedSchedule(page, slots);
  await page.goto("/schedule");

  await expect(page.getByText("Виявлено конфлікти у розкладі")).toHaveCount(0);
  await expect(page.getByText("Конфлікти (викл./ауд.)")).toHaveCount(0);
  await expect(page.getByText("Конфлікти викладачів")).toBeVisible();
});

test("admin can delete a group schedule from the schedule page", async ({ page }) => {
  let deleteUrl: URL | null = null;
  let slots: MockScheduleSlot[] = [
    {
      id: 31,
      group_id: 31,
      teacher_id: 11,
      subject_id: 15,
      room_id: 101,
      starts_at: "2026-08-01T09:00:00Z",
      ends_at: "2026-08-01T11:00:00Z",
      pair_number: 1,
      academic_hours: 2,
      group_code: "DEL-31",
      group_name: "Група для видалення",
      teacher_name: "Шевченко С.С.",
      subject_name: "Курс",
      room_name: "101"
    },
    {
      id: 32,
      group_id: 32,
      teacher_id: 12,
      subject_id: 16,
      room_id: 102,
      starts_at: "2026-08-02T09:00:00Z",
      ends_at: "2026-08-02T11:00:00Z",
      pair_number: 1,
      academic_hours: 2,
      group_code: "KEEP-32",
      group_name: "Група лишається",
      teacher_name: "Франко І.Я.",
      subject_name: "Інший курс",
      room_name: "102"
    }
  ];

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
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(slots) });
    }

    if (path.endsWith("/teachers") && method === "GET") {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([]) });
    }

    if (path.endsWith("/schedule/groups/31") && method === "DELETE") {
      deleteUrl = url;
      slots = slots.filter((slot) => slot.group_id !== 31);
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          group_id: 31,
          group_code: "DEL-31",
          deleted_slots: 1,
          deleted_hours: 2,
          journal_workload_present: false
        })
      });
    }

    return route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ detail: "not mocked" }) });
  });

  await page.goto("/schedule");
  await page.getByRole("button", { name: "Розгорнути все" }).click();
  await expect(page.locator("[draggable=true]", { hasText: "DEL-31" })).toBeVisible();
  await expect(page.locator("[draggable=true]", { hasText: "KEEP-32" })).toBeVisible();

  await page.getByLabel("Група для видалення розкладу").selectOption("31");
  await page.getByRole("button", { name: "Видалити розклад групи" }).click();
  await expect(page.getByRole("alertdialog", { name: "Видалити розклад групи" })).toBeVisible();
  await page.getByRole("alertdialog").getByRole("button", { name: "Видалити" }).click();

  await expect.poll(() => deleteUrl?.pathname).toContain("/schedule/groups/31");
  await expect(page.locator("[draggable=true]", { hasText: "DEL-31" })).toHaveCount(0);
  await expect(page.locator("[draggable=true]", { hasText: "KEEP-32" })).toBeVisible();
});
