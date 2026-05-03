import { expect, type Page, test } from "@playwright/test";

const section = {
  id: 1,
  name: "Журнали 2026",
  folder_url: "https://drive.google.com/drive/folders/test",
  last_synced_at: "2026-05-03T10:00:00Z",
  has_service_account_credentials: false,
  stats: {
    total: 4,
    complete: 1,
    schedule_only: 1,
    trainees_only: 1,
    not_processed: 1,
    unknown_code: 0
  },
  entries: [
    {
      id: 1,
      section_id: 1,
      drive_folder_id: "drive-1",
      drive_url: "https://drive.google.com/drive/folders/drive-1",
      journal_name: "1-26 Альфа",
      group_code: "1-26",
      processing_status: "not_processed",
      has_schedule: false,
      has_trainees: false,
      schedule_lessons: 0,
      schedule_hours: 0,
      trainee_count: 0,
      matched_group_id: null
    },
    {
      id: 2,
      section_id: 1,
      drive_folder_id: "drive-100",
      drive_url: "https://drive.google.com/drive/folders/drive-100",
      journal_name: "100-26 Якість навчання",
      group_code: "100-26",
      processing_status: "schedule_only",
      has_schedule: true,
      has_trainees: false,
      schedule_lessons: 8,
      schedule_hours: 16,
      trainee_count: 0,
      matched_group_id: 100
    },
    {
      id: 3,
      section_id: 1,
      drive_folder_id: "drive-2",
      drive_url: "https://drive.google.com/drive/folders/drive-2",
      journal_name: "2-26 Бета",
      group_code: "2-26",
      processing_status: "trainees_only",
      has_schedule: false,
      has_trainees: true,
      schedule_lessons: 0,
      schedule_hours: 0,
      trainee_count: 24,
      matched_group_id: 2
    },
    {
      id: 4,
      section_id: 1,
      drive_folder_id: "drive-10p",
      drive_url: "https://drive.google.com/drive/folders/drive-10p",
      journal_name: "10п-26 Трактори",
      group_code: "10п-26",
      processing_status: "complete",
      has_schedule: true,
      has_trainees: true,
      schedule_lessons: 12,
      schedule_hours: 24,
      trainee_count: 22,
      matched_group_id: 10
    }
  ]
};

const archiveSection = {
  ...section,
  id: 2,
  name: "Журнали 2025",
  folder_url: "https://drive.google.com/drive/folders/archive",
  last_synced_at: "2026-05-03T09:00:00Z",
  stats: {
    total: 100,
    complete: 40,
    schedule_only: 20,
    trainees_only: 10,
    not_processed: 30,
    unknown_code: 0
  },
  entries: []
};

async function loginAndMockJournals(
  page: Page,
  options: { sections?: unknown[]; onExport?: (url: URL) => void } = {}
) {
  await page.addInitScript(() => {
    localStorage.setItem(
      "suptc_auth",
      JSON.stringify({
        accessToken: "access-admin",
        refreshToken: "refresh-admin"
      })
    );
  });

  const sections = options.sections || [{ ...section, entries: [] }];

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

    if (path.endsWith("/journal-monitors") && method === "GET") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(sections)
      });
    }

    if (path.endsWith("/journal-monitors/1/export") && method === "GET") {
      options.onExport?.(url);
      return route.fulfill({
        status: 200,
        contentType: "text/csv",
        headers: { "content-disposition": "attachment; filename=journal-monitor.csv" },
        body: "Номер групи\n2-26\n"
      });
    }

    if (path.endsWith("/journal-monitors/1") && method === "GET") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(section)
      });
    }

    if (path.endsWith("/journal-monitors/2") && method === "GET") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(archiveSection)
      });
    }

    return route.fulfill({
      status: 404,
      contentType: "application/json",
      body: JSON.stringify({ detail: "not mocked" })
    });
  });
}

test("journal monitor uses a single wide detail block with section metadata and status percentages", async ({ page }) => {
  await loginAndMockJournals(page);

  await page.goto("/journals");

  await expect(page.getByRole("heading", { name: "Розділи" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Журнали 2026" })).toBeVisible();
  await expect(page.getByText(/4 папок, оновлено:/)).toBeVisible();
  await expect(page.getByRole("heading", { name: "Опрацювання журналів" })).toBeVisible();
  await expect(page.getByText("25%").first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "Розклад і слухачі" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Тільки розклад" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Тільки слухачі" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Не опрацьовано" })).toBeVisible();
  await page.getByRole("button", { name: /Список журналів/ }).click();
  await expect(page.getByRole("table").getByText("Не опрацьовано", { exact: true })).toBeVisible();
});

test("journal monitor section can be deleted from the project", async ({ page }) => {
  const remainingSections = [{ ...section, entries: [] }];
  let deletedSectionId: number | null = null;

  await loginAndMockJournals(page, {
    sections: [archiveSection, ...remainingSections]
  });

  await page.route("**/api/v1/journal-monitors/2", async (route) => {
    if (route.request().method() === "DELETE") {
      deletedSectionId = 2;
      return route.fulfill({ status: 204 });
    }
    return route.fallback();
  });

  await page.goto("/journals");
  await expect(page.getByRole("heading", { name: "Журнали 2025" })).toBeVisible();

  await page.getByRole("button", { name: "Видалити розділ" }).click();
  await expect(page.getByRole("alertdialog", { name: "Видалити розділ журналів" })).toBeVisible();
  await page.getByRole("button", { name: "Видалити", exact: true }).click();

  await expect.poll(() => deletedSectionId).toBe(2);
  await expect(page.getByRole("heading", { name: "Журнали 2025" })).toHaveCount(0);
});

test("journal monitor entries can be searched and sorted", async ({ page }) => {
  await loginAndMockJournals(page);

  await page.goto("/journals");
  await page.getByRole("button", { name: /Список журналів/ }).click();

  const visibleGroupCodes = () =>
    page.locator("#journal-monitor-entries tbody tr").evaluateAll((rows) =>
      rows
        .map((row) => row.querySelector("td")?.textContent?.trim() || "")
        .filter((value) => value && value !== "Даних ще немає. Натисніть «Оновити» після створення розділу.")
    );

  await page.getByRole("button", { name: /Група/ }).click();
  await expect.poll(visibleGroupCodes).toEqual(["1-26", "2-26", "10п-26", "100-26"]);

  await page.getByRole("button", { name: /Папка журналу/ }).click();
  await expect.poll(visibleGroupCodes).toEqual(["1-26", "2-26", "10п-26", "100-26"]);

  await page.getByRole("button", { name: /Статус/ }).click();
  await expect.poll(visibleGroupCodes).toEqual(["10п-26", "100-26", "2-26", "1-26"]);

  await page.getByRole("button", { name: /Розклад/ }).click();
  await expect.poll(visibleGroupCodes).toEqual(["100-26", "10п-26", "1-26", "2-26"]);

  await page.getByRole("button", { name: /Слухачі/ }).click();
  await expect.poll(visibleGroupCodes).toEqual(["2-26", "10п-26", "1-26", "100-26"]);

  await page.getByPlaceholder("Пошук за номером або назвою журналу").fill("бета");
  await expect.poll(visibleGroupCodes).toEqual(["2-26"]);

  await page.getByPlaceholder("Пошук за номером або назвою журналу").fill("100");
  await expect.poll(visibleGroupCodes).toEqual(["100-26"]);
});

test("journal monitor export uses current filters", async ({ page }) => {
  let exportUrl: URL | null = null;
  await loginAndMockJournals(page, {
    onExport: (url) => {
      exportUrl = url;
    }
  });

  await page.goto("/journals");
  await page.getByRole("button", { name: /Список журналів/ }).click();
  await page.getByPlaceholder("Пошук за номером або назвою журналу").fill("бета");
  await page.getByLabel("Фільтр за статусом журналів").selectOption("trainees_only");
  await page.getByLabel("Фільтр за розкладом журналів").selectOption("false");
  await page.getByLabel("Фільтр за слухачами журналів").selectOption("true");
  await page.getByRole("button", { name: "csv" }).click();

  await expect.poll(() => exportUrl?.searchParams.get("format")).toBe("csv");
  expect(exportUrl?.searchParams.get("q")).toBe("бета");
  expect(exportUrl?.searchParams.get("status")).toBe("trainees_only");
  expect(exportUrl?.searchParams.get("has_schedule")).toBe("false");
  expect(exportUrl?.searchParams.get("has_trainees")).toBe("true");
});
