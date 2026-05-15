import { expect, test } from "@playwright/test";

test("journal entries keep the group column pinned while scrolling on mobile", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    localStorage.setItem(
      "suptc_auth",
      JSON.stringify({
        accessToken: "test-access-token",
        refreshToken: "test-refresh-token"
      })
    );
  });

  const section = {
    id: 1,
    name: "Journals 2026",
    folder_url: "https://drive.google.com/drive/folders/test",
    last_synced_at: "2026-05-15T08:00:00Z",
    has_service_account_credentials: false,
    stats: {
      total: 1,
      complete: 0,
      schedule_only: 0,
      trainees_only: 0,
      not_processed: 1,
      unknown_code: 0,
      workload_and_trainees: 0,
      workload_trainees_schedule: 0
    },
    daily_activity: {
      cutoff_at: "2026-05-15T05:00:00Z",
      created_count: 0,
      changed_count: 0,
      created: [],
      changed: []
    },
    entries: [
      {
        id: 1,
        section_id: 1,
        drive_folder_id: "drive-1",
        drive_url: "https://drive.google.com/drive/folders/drive-1",
        journal_name: "Very long journal name for horizontal scroll",
        group_code: "1-26",
        processing_status: "not_processed",
        has_schedule: false,
        has_trainees: false,
        schedule_lessons: 0,
        schedule_hours: 0,
        trainee_count: 0,
        workload_status: "pending",
        workload_hours: 0,
        workload_teachers: [],
        workload_source_names: [],
        matched_group_id: null
      }
    ]
  };

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

    if (path.endsWith("/journal-monitors") && method === "GET") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([{ ...section, entries: [] }])
      });
    }

    if (path.endsWith("/journal-monitors/1") && method === "GET") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(section)
      });
    }

    return route.fulfill({
      status: 404,
      contentType: "application/json",
      body: JSON.stringify({ detail: "not mocked" })
    });
  });

  await page.goto("/journals");
  await page.locator("button[aria-controls='journal-monitor-entries']").click();

  const scroller = page.getByTestId("journal-entries-scroll");
  const pinnedGroupCell = page.getByTestId("journal-group-cell").first();

  await expect(scroller).toBeVisible();
  await expect(pinnedGroupCell).toBeVisible();
  await scroller.evaluate((element) => {
    element.scrollLeft = 240;
  });

  await expect
    .poll(() => pinnedGroupCell.evaluate((element) => getComputedStyle(element).position))
    .toBe("sticky");
});
