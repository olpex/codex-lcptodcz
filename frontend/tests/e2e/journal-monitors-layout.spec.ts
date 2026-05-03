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
      journal_name: "1-26 Організація трудових відносин в умовах воєнного стану",
      group_code: "1-26",
      processing_status: "not_processed",
      has_schedule: false,
      has_trainees: false,
      schedule_lessons: 0,
      schedule_hours: 0,
      trainee_count: 0,
      matched_group_id: null
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

async function loginAndMockJournals(page: Page, options: { sections?: unknown[] } = {}) {
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
  await expect(page.locator("#journal-monitor-entries").getByText("Не опрацьовано", { exact: true })).toBeVisible();
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
