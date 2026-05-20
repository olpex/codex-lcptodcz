import { expect, type Page, test } from "@playwright/test";

const section = {
  id: 1,
  name: "Журнали 2026",
  folder_url: "https://drive.google.com/drive/folders/test",
  last_synced_at: "2026-05-03T10:00:00Z",
  has_service_account_credentials: false,
  stats: {
    total: 4,
    complete: 0,
    schedule_only: 1,
    trainees_only: 0,
    not_processed: 0,
    unknown_code: 0,
    workload_only: 1,
    workload_and_trainees: 1,
    workload_trainees_schedule: 1
  },
  daily_activity: {
    cutoff_at: "2026-05-13T05:00:00Z",
    created_count: 1,
    changed_count: 1,
    created: [
      {
        id: 5,
        drive_file_id: "drive-created",
        drive_url: "https://drive.google.com/drive/folders/drive-created",
        journal_name: "46-26 Новий журнал",
        group_code: "46-26",
        created_at: "2026-05-13T05:30:00Z",
        change_started_at: null,
        modified_at: "2026-05-13T05:30:00Z"
      }
    ],
    changed: [
      {
        id: 6,
        drive_file_id: "drive-changed",
        drive_url: "https://drive.google.com/drive/folders/drive-changed",
        journal_name: "47-26 Змінений журнал",
        group_code: "47-26",
        created_at: "2026-05-12T07:00:00Z",
        change_started_at: "2026-05-13T06:10:00Z",
        modified_at: "2026-05-13T08:45:00Z"
      }
    ]
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
      workload_status: "processed",
      workload_hours: 12,
      workload_teachers: [
        { teacher_id: 11, teacher_name: "Брикін В. Є.", hours: 8 },
        { teacher_id: 12, teacher_name: "Старожук Л. В.", hours: 4 }
      ],
      workload_source_names: ["Педнавантаження"],
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
      workload_status: "pending",
      workload_hours: 0,
      workload_teachers: [],
      workload_source_names: [],
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
      workload_status: "processed",
      workload_hours: 30,
      workload_teachers: [{ teacher_id: 13, teacher_name: "Паращук О. Л.", hours: 30 }],
      workload_source_names: ["Педнавантаження"],
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
      workload_status: "processed",
      workload_hours: 24,
      workload_teachers: [{ teacher_id: 14, teacher_name: "Коваль О. П.", hours: 24 }],
      workload_source_names: ["Педнавантаження"],
      matched_group_id: 10
    }
  ]
};

const archiveSection = {
  ...section,
  id: 2,
  name: "Журнали 2025",
  is_active: false,
  folder_url: "https://drive.google.com/drive/folders/archive",
  last_synced_at: "2026-05-03T09:00:00Z",
  stats: {
    total: 100,
    complete: 40,
    schedule_only: 20,
    trainees_only: 10,
    not_processed: 30,
    unknown_code: 0,
    workload_only: 0,
    workload_and_trainees: 0,
    workload_trainees_schedule: 0
  },
  entries: []
};

const noDataSection = {
  ...section,
  entries: [
    {
      id: 85,
      section_id: 1,
      drive_folder_id: "drive-85",
      drive_url: "https://drive.google.com/drive/folders/drive-85",
      journal_name: "85-26 Штучний інтелект: розвиток кар'єри та професійне зростання",
      group_code: "85-26",
      processing_status: "not_processed",
      has_schedule: false,
      has_trainees: false,
      schedule_lessons: 0,
      schedule_hours: 0,
      trainee_count: 0,
      trainees_status: "no_data",
      trainees_message: "Списку слухачів немає",
      workload_status: "no_data",
      workload_hours: 0,
      workload_teachers: [],
      workload_message: "Педнавантаження відсутнє",
      workload_source_names: [],
      matched_group_id: null
    }
  ]
};

const failedDriveSection = {
  ...section,
  last_sync_status: "failed",
  last_sync_message: "GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON не налаштовано для приватної папки",
  last_synced_at: null,
  entries: []
};

const emptyDriveSection = {
  ...section,
  last_sync_status: "success",
  last_sync_message: null,
  stats: {
    total: 0,
    complete: 0,
    schedule_only: 0,
    trainees_only: 0,
    not_processed: 0,
    unknown_code: 0,
    workload_only: 0,
    workload_and_trainees: 0,
    workload_trainees_schedule: 0
  },
  entries: []
};

async function loginAndMockJournals(
  page: Page,
  options: {
    sections?: unknown[];
    detailSection?: typeof section;
    onExport?: (url: URL) => void;
    onProcessingStart?: (url: URL) => void;
    onReprocessAll?: (url: URL) => void;
    onBackgroundTick?: (url: URL) => void | Promise<void>;
    onAutoPump?: (url: URL) => void;
    onSync?: (url: URL) => unknown | void;
    onEvents?: (url: URL) => unknown[] | void;
    onUpdateSection?: (url: URL, payload: unknown) => unknown | void;
  } = {}
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
  const detailSection = options.detailSection || section;

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

    if (path.endsWith("/journal-monitors/auto-pump") && method === "POST") {
      options.onAutoPump?.(url);
      return route.fulfill({
        status: 202,
        contentType: "application/json",
        body: JSON.stringify({ triggered: 1, skipped: null, processed_sections: 1, failed_sections: 0 })
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

    if (path.endsWith("/journal-monitors/1/processing/start") && method === "POST") {
      options.onProcessingStart?.(url);
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ...section, workload_auto_enabled: true, workload_auto_year: Number(url.searchParams.get("year")) })
      });
    }

    if (path.endsWith("/journal-monitors/1/processing/background-tick") && method === "POST") {
      await options.onBackgroundTick?.(url);
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ...section, workload_auto_enabled: true, workload_auto_year: Number(url.searchParams.get("year")) })
      });
    }

    if (path.endsWith("/journal-monitors/1/processing/reprocess-all") && method === "POST") {
      options.onReprocessAll?.(url);
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ...section,
          workload_auto_enabled: true,
          workload_auto_year: Number(url.searchParams.get("year")),
          entries: section.entries.map((entry) => ({ ...entry, workload_status: "pending", trainees_status: "pending" }))
        })
      });
    }

    if (path.endsWith("/journal-monitors/1/sync") && method === "POST") {
      const syncPayload = options.onSync?.(url);
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(syncPayload ?? { ...section, workload_auto_enabled: true, workload_auto_year: 2026 })
      });
    }

    if (path.endsWith("/journal-monitors/1/events") && method === "GET") {
      const eventsPayload = options.onEvents?.(url);
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(eventsPayload ?? [])
      });
    }

    if (path.endsWith("/journal-monitors/2") && method === "PATCH") {
      const payload = request.postDataJSON();
      const updatedSection = options.onUpdateSection?.(url, payload);
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(updatedSection ?? { ...archiveSection, is_active: true, entries: [] })
      });
    }

    if (path.endsWith("/journal-monitors/1") && method === "GET") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(detailSection)
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

test("journal monitor no-data cells use the same badge styling", async ({ page }) => {
  await loginAndMockJournals(page, {
    sections: [{ ...noDataSection, entries: [] }],
    detailSection: noDataSection
  });

  await page.goto("/journals");
  await page.getByRole("button", { name: /Список журналів/ }).click();

  const noDataBadges = page.locator("#journal-monitor-entries tbody tr", { hasText: "85-26" }).getByText("Н/даних", { exact: true });
  await expect(noDataBadges).toHaveCount(4);

  const classNames = await noDataBadges.evaluateAll((elements) =>
    elements.map((element) => element.getAttribute("class") || "")
  );
  expect(new Set(classNames).size).toBe(1);
  expect(classNames[0]).toContain("bg-rose-100");
  expect(classNames[0]).toContain("rounded-full");
  expect(classNames[0]).toContain("text-xs");
});

test("journal monitor shows extracted hours when workload details are incomplete", async ({ page }) => {
  await loginAndMockJournals(page, {
    sections: [{ ...noDataSection, entries: [] }],
    detailSection: {
      ...noDataSection,
      entries: noDataSection.entries.map((entry) => ({ ...entry, workload_hours: 30 }))
    }
  });

  await page.goto("/journals");
  await page.getByRole("button", { name: /Список журналів/ }).click();

  const row = page.locator("#journal-monitor-entries tbody tr", { hasText: "85-26" });
  await expect(row.locator("td").nth(4).getByText("Н/даних", { exact: true })).toBeVisible();
  await expect(row.locator("td").nth(5)).toHaveText("30");
});

test("journal monitor explains Drive sync failures inline", async ({ page }) => {
  await loginAndMockJournals(page, {
    sections: [{ ...failedDriveSection, entries: [] }],
    detailSection: failedDriveSection
  });

  await page.goto("/journals");

  await expect(page.getByText("Немає доступу до Google Drive")).toBeVisible();
  await expect(page.getByText("GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON не налаштовано для приватної папки")).toBeVisible();
});

test("journal monitor explains an empty Drive folder after sync", async ({ page }) => {
  await loginAndMockJournals(page, {
    sections: [{ ...emptyDriveSection, entries: [] }],
    detailSection: emptyDriveSection
  });

  await page.goto("/journals");

  await expect(page.getByText("Папка Google Drive порожня")).toBeVisible();
  await expect(page.getByText("Перевірте, чи у вибраній папці є журнали груп, або оновіть моніторинг після додавання файлів.")).toBeVisible();
});

test("journal monitor workload status title lists teachers and course hours", async ({ page }) => {
  await loginAndMockJournals(page);

  await page.goto("/journals");
  await page.getByRole("button", { name: /Список журналів/ }).click();

  const row = page.locator("#journal-monitor-entries tbody tr", { hasText: "1-26" });
  const badge = row.locator("td").nth(4).getByText("Додано", { exact: true });

  await expect(badge).toHaveAttribute("title", "Брикін В. Є. (8 год)\nСтарожук Л. В. (4 год)");
});

test("journal monitor uses a single wide detail block with section metadata and status percentages", async ({ page }) => {
  await loginAndMockJournals(page);

  await page.goto("/journals");

  await expect(page.getByRole("heading", { name: "Розділи" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Журнали 2026" })).toBeVisible();
  await expect(page.getByText(/4 папок, оновлено:/)).toBeVisible();
  await expect(page.getByRole("heading", { name: "Опрацювання журналів" })).toBeVisible();
  await expect(page.getByText("25%").first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "Тільки педнавантаження" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Розклад і слухачі" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Тільки розклад" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Тільки слухачі" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Не опрацьовано" })).toBeVisible();
  await page.getByRole("button", { name: /Список журналів/ }).click();
  await expect(page.getByRole("table").getByText("Тільки педнавантаження", { exact: true })).toBeVisible();
  await expect(page.locator("#journal-monitor-entries tbody tr").filter({ hasText: "2-26" }).getByText("Пед.+слухачі")).toBeVisible();
  await expect(page.locator("#journal-monitor-entries tbody tr").filter({ hasText: "10п-26" }).getByText("Опрацьовано")).toBeVisible();
  await expect(page.getByText("Тільки слухачі:").locator("b")).toHaveText("0");
  await expect(page.getByText("Пед.+слухачі:").locator("b")).toHaveText("1");
});

test("journal monitor shows section lifecycle and processing configuration", async ({ page }) => {
  const processingSection = {
    ...section,
    has_service_account_credentials: true,
    last_sync_status: "success",
    workload_auto_enabled: true,
    workload_auto_year: 2026
  };
  await loginAndMockJournals(page, {
    sections: [{ ...processingSection, entries: [] }],
    detailSection: processingSection
  });

  await page.goto("/journals");

  const lifecycle = page.getByLabel("Життєвий цикл розділу журналів");
  await expect(lifecycle).toBeVisible();
  await expect(lifecycle.getByText("Стан секції")).toBeVisible();
  await expect(lifecycle.getByText("Активна")).toBeVisible();
  await expect(lifecycle.getByText("Google Drive")).toBeVisible();
  await expect(lifecycle.getByText("Синхронізація успішна")).toBeVisible();
  await expect(lifecycle.getByText("Service account")).toBeVisible();
  await expect(lifecycle.getByText("Налаштовано")).toBeVisible();
  await expect(lifecycle.getByText("Автоопрацювання")).toBeVisible();
  await expect(lifecycle.getByText("Увімкнено, 2026")).toBeVisible();
});

test("journal monitor shows journals created and changed since 8 today", async ({ page }) => {
  await loginAndMockJournals(page);

  await page.goto("/journals");

  const activityButton = page.getByRole("button", { name: /Активність з 08:00/ });
  await expect(activityButton).toBeVisible();
  await expect(activityButton).toHaveAttribute("aria-expanded", "false");
  await activityButton.click();
  await expect(activityButton).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByRole("heading", { name: "Створені журнали" })).toBeVisible();
  await expect(page.getByRole("link", { name: "46-26 Новий журнал" })).toHaveAttribute("href", "https://drive.google.com/drive/folders/drive-created");
  await expect(page.getByText("Створено: 08:30")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Змінені журнали" })).toBeVisible();
  await expect(page.getByRole("link", { name: "47-26 Змінений журнал" })).toHaveAttribute("href", "https://drive.google.com/drive/folders/drive-changed");
  await expect(page.getByText("Початок змін: 09:10")).toBeVisible();
  await expect(page.getByText("Остання зміна: 11:45")).toBeVisible();
});

test("journal monitor shows filterable Drive event history", async ({ page }) => {
  let eventsUrl: URL | null = null;
  await loginAndMockJournals(page, {
    onEvents: (url) => {
      eventsUrl = url;
      return [
        {
          id: 10,
          section_id: 1,
          object_type: "workbook",
          action: "changed",
          drive_file_id: "sheet-46-26",
          drive_folder_id: "drive-46-26",
          drive_mime_type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          drive_url: "https://drive.google.com/file/d/sheet-46-26/view",
          journal_name: "46-26 Журнал.xlsx",
          group_code: "46-26",
          actor_user_id: 1,
          actor_name: "Системний адміністратор",
          source: "manual",
          drive_created_at: "2026-05-13T05:12:00Z",
          drive_modified_at: "2026-05-14T06:35:00Z",
          occurred_at: "2026-05-14T06:35:00Z",
          detected_at: "2026-05-14T06:36:00Z"
        }
      ];
    }
  });

  await page.goto("/journals");

  await expect(page.getByRole("heading", { name: "Історія змін Drive" })).toBeVisible();
  await expect(page.getByText("46-26 Журнал.xlsx")).toBeVisible();
  await expect(page.getByText("Журнал", { exact: true })).toBeVisible();
  await expect(page.getByRole("cell", { name: "Змінено" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "Системний адміністратор" })).toBeVisible();

  await page.getByLabel("Дія").selectOption("deleted");
  await expect.poll(() => eventsUrl?.searchParams.get("action")).toBe("deleted");
});

test("journal monitor refreshes daily activity without workload auto-processing", async ({ page }) => {
  let syncCalls = 0;
  const idleSection = {
    ...section,
    workload_auto_enabled: false,
    daily_activity: {
      ...section.daily_activity,
      created_count: 0,
      changed_count: 0,
      created: [],
      changed: []
    }
  };
  const refreshedSection = {
    ...idleSection,
    last_synced_at: "2026-05-13T09:05:00Z",
    daily_activity: {
      ...idleSection.daily_activity,
      created_count: 1,
      created: [
        {
          id: 50,
          drive_file_id: "drive-auto-created",
          drive_url: "https://drive.google.com/drive/folders/drive-auto-created",
          journal_name: "50-26 Auto refreshed journal",
          group_code: "50-26",
          created_at: "2026-05-13T09:01:00Z",
          change_started_at: null,
          modified_at: "2026-05-13T09:01:00Z"
        }
      ]
    }
  };

  await loginAndMockJournals(page, {
    sections: [{ ...idleSection, entries: [] }],
    detailSection: idleSection,
    onSync: () => {
      syncCalls += 1;
      return refreshedSection;
    }
  });

  await page.goto("/journals");
  await page.getByRole("button", { name: /Активність з 08:00/ }).click();

  await page.evaluate(() => window.dispatchEvent(new Event("suptc:page-refresh")));

  await expect.poll(() => syncCalls).toBe(1);
  await expect(page.getByText("50-26 Auto refreshed journal")).toBeVisible();
});

test("journal monitor page refresh keeps backlog moving without re-syncing Drive", async ({ page }) => {
  let backgroundCalls = 0;
  let syncCalls = 0;
  const processingSection = {
    ...section,
    workload_auto_enabled: true,
    workload_auto_year: 2026,
    daily_activity: {
      ...section.daily_activity,
      created_count: 0,
      changed_count: 0,
      created: [],
      changed: []
    }
  };
  const auditedSection = {
    ...processingSection,
    daily_activity: {
      ...processingSection.daily_activity,
      changed_count: 1,
      changed: [
        {
          id: 51,
          drive_file_id: "drive-auto-changed",
          drive_url: "https://drive.google.com/drive/folders/drive-auto-changed",
          journal_name: "51-26 Auto audited journal",
          group_code: "51-26",
          created_at: "2026-05-12T09:01:00Z",
          change_started_at: "2026-05-13T09:15:00Z",
          modified_at: "2026-05-13T09:20:00Z"
        }
      ]
    }
  };

  await loginAndMockJournals(page, {
    sections: [{ ...processingSection, entries: [] }],
    detailSection: processingSection,
    onBackgroundTick: () => {
      backgroundCalls += 1;
    },
    onSync: () => {
      syncCalls += 1;
      return auditedSection;
    }
  });

  await page.goto("/journals");
  await expect(page.getByRole("button", { name: "Зупинити опрацювання" })).toBeVisible();

  await page.evaluate(() => window.dispatchEvent(new Event("suptc:page-refresh")));

  await expect.poll(() => backgroundCalls).toBe(1);
  await expect.poll(() => syncCalls).toBe(0);
});

test("journal monitor opens the current-year section by default", async ({ page }) => {
  await loginAndMockJournals(page, {
    sections: [archiveSection, { ...section, entries: [] }]
  });

  await page.goto("/journals");

  await expect(page.getByRole("heading", { name: "Журнали 2026" })).toBeVisible();
  await expect(page.getByLabel("Розділ для перегляду")).toHaveValue("1");
});

test("journal monitor archived sections are read-only until reactivated", async ({ page }) => {
  let patchPayload: unknown = null;
  await loginAndMockJournals(page, {
    sections: [{ ...section, entries: [] }, archiveSection],
    onUpdateSection: (_url, payload) => {
      patchPayload = payload;
      return { ...archiveSection, is_active: true, entries: [] };
    }
  });

  await page.goto("/journals");
  await page.getByLabel("Розділ для перегляду").selectOption("2");
  const journalPanel = page.locator("#main-content");

  await expect(page.getByText("Архівовано", { exact: true })).toBeVisible();
  await expect(page.getByText("Розділ вимкнено для автоматичного опрацювання.")).toBeVisible();
  await expect(journalPanel.getByRole("button", { name: "Оновити" })).toBeDisabled();
  await expect(journalPanel.getByRole("button", { name: "Почати опрацювання" })).toBeDisabled();

  await journalPanel.getByRole("button", { name: "Активувати розділ" }).click();

  await expect.poll(() => patchPayload).toEqual({ is_active: true });
});

test("journal monitor can prefill a copied section for the next year", async ({ page }) => {
  await loginAndMockJournals(page, {
    sections: [archiveSection, { ...section, entries: [] }]
  });

  await page.goto("/journals");
  await page.getByRole("button", { name: "Копіювати на новий рік" }).click();

  await expect(page.getByLabel("Назва розділу")).toHaveValue("Журнали 2027");
  await expect(page.getByLabel("URL папки Google Drive")).toHaveValue(section.folder_url);
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
  await expect(page.getByRole("heading", { name: "Журнали 2026" })).toBeVisible();
  await page.getByLabel("Розділ для перегляду").selectOption("2");
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
        .map((row) => row.querySelector("td:nth-child(2)")?.textContent?.trim() || "")
        .filter((value) => value && value !== "Даних ще немає. Натисніть «Оновити» після створення розділу.")
    );

  await page.getByRole("button", { name: /Група/ }).click();
  await expect.poll(visibleGroupCodes).toEqual(["1-26", "2-26", "10п-26", "100-26"]);

  await page.getByRole("button", { name: /Папка \/ файли журналів/ }).click();
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

test("journal monitor status filter can show workload-only and missing workload journals", async ({ page }) => {
  await loginAndMockJournals(page);

  await page.goto("/journals");
  await page.getByRole("button", { name: /Список журналів/ }).click();

  const visibleGroupCodes = () =>
    page.locator("#journal-monitor-entries tbody tr").evaluateAll((rows) =>
      rows
        .map((row) => row.querySelector("td:nth-child(2)")?.textContent?.trim() || "")
        .filter((value) => value && value !== "Даних ще немає. Натисніть «Оновити» після створення розділу.")
    );

  await page.getByLabel("Фільтр за статусом журналів").selectOption("workload_only");
  await expect.poll(visibleGroupCodes).toEqual(["1-26"]);

  await page.getByLabel("Фільтр за статусом журналів").selectOption("without_workload");
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

  await page.getByPlaceholder("Пошук за номером або назвою журналу").fill("");
  await page.getByLabel("Фільтр за статусом журналів").selectOption("workload_only");
  await page.getByLabel("Фільтр за розкладом журналів").selectOption("");
  await page.getByLabel("Фільтр за слухачами журналів").selectOption("");
  await page.getByRole("button", { name: "csv" }).click();

  await expect.poll(() => exportUrl?.searchParams.get("workload")).toBe("workload_only");
  expect(exportUrl?.searchParams.get("status")).toBeNull();
});

test("journal monitor starts one combined processing action for trainees and workload", async ({ page }) => {
  let processingUrl: URL | null = null;
  let backgroundUrl: URL | null = null;
  await loginAndMockJournals(page, {
    onProcessingStart: (url) => {
      processingUrl = url;
    },
    onBackgroundTick: (url) => {
      backgroundUrl = url;
    }
  });

  await page.goto("/journals");
  await expect(page.getByRole("button", { name: "Почати опрацювання" })).toBeVisible();
  await page.getByLabel("Рік").fill("2026");
  await page.getByRole("button", { name: "Почати опрацювання" }).click();

  await expect.poll(() => processingUrl?.pathname).toContain("/journal-monitors/1/processing/start");
  expect(processingUrl?.searchParams.get("year")).toBe("2026");
  await expect(page.getByRole("button", { name: "Зупинити опрацювання" })).toBeVisible();

  await page.evaluate(() => window.dispatchEvent(new Event("suptc:page-refresh")));

  await expect.poll(() => backgroundUrl?.pathname).toContain("/journal-monitors/1/processing/background-tick");
  expect(backgroundUrl?.searchParams.get("year")).toBe("2026");
  expect(backgroundUrl?.searchParams.get("sync")).toBeNull();
  expect(backgroundUrl?.searchParams.get("workload_limit")).toBe("1");
  expect(backgroundUrl?.searchParams.get("trainees_limit")).toBe("1");
});

test("app layout quietly pumps journal background sync for admins", async ({ page }) => {
  let autoPumpUrl: URL | null = null;
  await loginAndMockJournals(page, {
    onAutoPump: (url) => {
      autoPumpUrl = url;
    }
  });

  await page.goto("/journals");

  await expect.poll(() => autoPumpUrl?.pathname, { timeout: 15_000 }).toContain("/journal-monitors/auto-pump");
});

test("journal monitor update button processes a batch when auto-processing is enabled", async ({ page }) => {
  let backgroundUrl: URL | null = null;
  let syncUrl: URL | null = null;
  await loginAndMockJournals(page, {
    detailSection: { ...section, workload_auto_enabled: true, workload_auto_year: 2026 },
    onBackgroundTick: (url) => {
      backgroundUrl = url;
    },
    onSync: (url) => {
      syncUrl = url;
    }
  });

  await page.goto("/journals");
  await expect(page.getByRole("button", { name: "Зупинити опрацювання" })).toBeVisible();
  await page.getByTestId("journal-monitor-refresh").click();

  await expect.poll(() => backgroundUrl?.pathname).toContain("/journal-monitors/1/processing/background-tick");
  expect(backgroundUrl?.searchParams.get("year")).toBe("2026");
  expect(backgroundUrl?.searchParams.get("sync")).toBe("true");
  expect(backgroundUrl?.searchParams.get("workload_limit")).toBe("20");
  expect(backgroundUrl?.searchParams.get("trainees_limit")).toBe("20");
  expect(syncUrl).toBeNull();
});

test("journal monitor update queues a batch when an automatic step is already running", async ({ page }) => {
  const backgroundUrls: URL[] = [];
  let releaseFirstStep: (() => void) | null = null;
  const firstStepPending = new Promise<void>((resolve) => {
    releaseFirstStep = resolve;
  });
  await loginAndMockJournals(page, {
    detailSection: { ...section, workload_auto_enabled: true, workload_auto_year: 2026 },
    onBackgroundTick: async (url) => {
      backgroundUrls.push(url);
      if (backgroundUrls.length === 1) {
        await firstStepPending;
      }
    }
  });

  await page.goto("/journals");
  await expect(page.getByTestId("journal-monitor-refresh")).toBeVisible();
  await page.evaluate(() => window.dispatchEvent(new Event("suptc:page-refresh")));
  await expect.poll(() => backgroundUrls.length).toBe(1);

  await page.getByTestId("journal-monitor-refresh").click();
  releaseFirstStep?.();

  await expect.poll(() => backgroundUrls.length).toBe(2);
  const queuedUrl = backgroundUrls[1];
  expect(queuedUrl.searchParams.get("sync")).toBe("true");
  expect(queuedUrl.searchParams.get("workload_limit")).toBe("20");
  expect(queuedUrl.searchParams.get("trainees_limit")).toBe("20");
});

test("journal monitor auto processing starts the selected step immediately on open", async ({ page }) => {
  let backgroundUrl: URL | null = null;
  await loginAndMockJournals(page, {
    detailSection: { ...section, workload_auto_enabled: true, workload_auto_year: 2026 },
    onBackgroundTick: (url) => {
      backgroundUrl = url;
    }
  });

  await page.goto("/journals");

  await expect.poll(() => backgroundUrl?.pathname, { timeout: 3_000 }).toContain("/journal-monitors/1/processing/background-tick");
  expect(backgroundUrl?.searchParams.get("sync")).toBeNull();
  expect(backgroundUrl?.searchParams.get("workload_limit")).toBe("1");
  expect(backgroundUrl?.searchParams.get("trainees_limit")).toBe("1");
});

test("journal monitor can force full reprocessing for a year", async ({ page }) => {
  let reprocessUrl: URL | null = null;
  const backgroundUrls: URL[] = [];
  await loginAndMockJournals(page, {
    onReprocessAll: (url) => {
      reprocessUrl = url;
    },
    onBackgroundTick: (url) => {
      backgroundUrls.push(url);
    }
  });

  await page.goto("/journals");
  await page.getByLabel("Рік").fill("2026");
  await page.getByRole("button", { name: "Переобробити все" }).click();

  await expect.poll(() => reprocessUrl?.pathname).toContain("/journal-monitors/1/processing/reprocess-all");
  expect(reprocessUrl?.searchParams.get("year")).toBe("2026");
  await expect(page.getByText("Повну переобробку журналів для 2026 року поставлено в чергу")).toBeVisible();
  await expect.poll(() => backgroundUrls.some((url) => url.searchParams.get("sync") === "true")).toBe(true);
  const reprocessTickUrl = backgroundUrls.find((url) => url.searchParams.get("sync") === "true");
  expect(reprocessTickUrl?.pathname).toContain("/journal-monitors/1/processing/background-tick");
  expect(reprocessTickUrl?.searchParams.get("year")).toBe("2026");
  await expect(page.getByRole("button", { name: "Переобробити все" })).toBeDisabled();
});
