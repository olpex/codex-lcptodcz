import { expect, test } from "@playwright/test";

test("job center surfaces active background jobs in a live progress drawer", async ({ page }) => {
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
          full_name: "Admin",
          branch_id: "main",
          roles: [{ id: 1, name: "admin" }]
        })
      });
    }

    if (path.endsWith("/documents/import/batch/formats") && method === "GET") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ supported_extensions: ["xlsx", "csv", "docx"] })
      });
    }

    if (path.endsWith("/jobs") && method === "GET") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([
          {
            job_type: "import",
            import_source: "xlsx",
            document_id: 5,
            document_file_name: "large-import.xlsx",
            job: {
              id: 41,
              status: "running",
              message: "Processing large-import.xlsx",
              result_payload: {},
              started_at: "2026-05-15T08:00:00Z",
              finished_at: null,
              created_at: "2026-05-15T07:59:50Z",
              updated_at: "2026-05-15T08:00:10Z"
            }
          }
        ])
      });
    }

    return route.fulfill({
      status: 404,
      contentType: "application/json",
      body: JSON.stringify({ detail: "not mocked" })
    });
  });

  await page.goto("/jobs");

  const drawer = page.getByTestId("job-progress-drawer");
  await expect(drawer).toBeVisible();
  await expect(drawer).toHaveAttribute("aria-live", "polite");
  await expect(drawer).toContainText("#41");
  await expect(drawer).toContainText("Processing large-import.xlsx");
});

test("job center explains active Drive intake progress without opening Google Drive", async ({ page }) => {
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
          full_name: "Admin",
          branch_id: "main",
          roles: [{ id: 1, name: "admin" }]
        })
      });
    }

    if (path.endsWith("/documents/import/batch/formats") && method === "GET") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ supported_extensions: ["xlsx", "csv", "docx"] })
      });
    }

    if (path.endsWith("/jobs") && method === "GET") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([
          {
            job_type: "import",
            import_source: "drive_intake",
            document_id: 88,
            document_file_name: "46-26 Schedule.docx",
            job: {
              id: 88,
              status: "running",
              message: "Імпорт з Google Drive виконується",
              result_payload: {
                source: "drive_intake",
                channel: "google_drive_folder",
                drive_file_name: "46-26 Schedule.docx",
                drive_url: "https://drive.google.com/file/d/drive-88/view",
                import_mode: "overwrite"
              },
              started_at: "2026-05-15T08:00:00Z",
              finished_at: null,
              created_at: "2026-05-15T07:59:50Z",
              updated_at: "2026-05-15T08:00:10Z"
            }
          }
        ])
      });
    }

    return route.fulfill({
      status: 404,
      contentType: "application/json",
      body: JSON.stringify({ detail: "not mocked" })
    });
  });

  await page.goto("/jobs");

  const drawer = page.getByTestId("job-progress-drawer");
  await expect(drawer).toBeVisible();
  await expect(drawer).toContainText("Google Drive");
  await expect(drawer).toContainText("Крок 2 з 3");
  await expect(drawer.getByRole("progressbar", { name: "Прогрес задачі #88" })).toHaveAttribute("aria-valuenow", "60");
  await expect(page.getByRole("cell", { name: "Google Drive", exact: true })).toBeVisible();
  await expect(page.getByText("Файл Drive: 46-26 Schedule.docx")).toBeVisible();
});

test("job center polls lightweight statuses for active jobs", async ({ page }) => {
  await page.clock.install();
  let listRequests = 0;
  let statusRequests = 0;

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
          full_name: "Admin",
          branch_id: "main",
          roles: [{ id: 1, name: "admin" }]
        })
      });
    }

    if (path.endsWith("/documents/import/batch/formats") && method === "GET") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ supported_extensions: ["xlsx", "csv", "docx"] })
      });
    }

    if (path.endsWith("/jobs/statuses") && method === "GET") {
      statusRequests += 1;
      expect(url.searchParams.getAll("job_id")).toContain("41");
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([
          {
            job_type: "import",
            job: {
              id: 41,
              status: "running",
              message: "Halfway through large-import.xlsx",
              result_payload: {},
              started_at: "2026-05-15T08:00:00Z",
              finished_at: null,
              created_at: "2026-05-15T07:59:50Z",
              updated_at: "2026-05-15T08:00:18Z"
            }
          }
        ])
      });
    }

    if (path.endsWith("/jobs") && method === "GET") {
      listRequests += 1;
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([
          {
            job_type: "import",
            import_source: "xlsx",
            document_id: 5,
            document_file_name: "large-import.xlsx",
            job: {
              id: 41,
              status: "running",
              message: "Processing large-import.xlsx",
              result_payload: {},
              started_at: "2026-05-15T08:00:00Z",
              finished_at: null,
              created_at: "2026-05-15T07:59:50Z",
              updated_at: "2026-05-15T08:00:10Z"
            }
          }
        ])
      });
    }

    return route.fulfill({
      status: 404,
      contentType: "application/json",
      body: JSON.stringify({ detail: "not mocked" })
    });
  });

  await page.goto("/jobs");
  await expect(page.getByTestId("job-progress-drawer")).toContainText("Processing large-import.xlsx");
  const listRequestsAfterInitialLoad = listRequests;

  await page.clock.fastForward(8000);

  await expect.poll(() => statusRequests).toBe(1);
  expect(listRequests).toBe(listRequestsAfterInitialLoad);
  await expect(page.getByTestId("job-progress-drawer")).toContainText("Halfway through large-import.xlsx");
});
