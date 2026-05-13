import { expect, test } from "@playwright/test";

function installAuth(page: import("@playwright/test").Page) {
  return page.addInitScript(() => {
    localStorage.setItem(
      "suptc_auth",
      JSON.stringify({
        accessToken: "test-access-token",
        refreshToken: "test-refresh-token"
      })
    );
  });
}

function authUserPayload() {
  return {
    id: 1,
    username: "admin",
    full_name: "Системний адміністратор",
    branch_id: "main",
    roles: [{ id: 1, name: "admin" }]
  };
}

test("groups registry does not auto-load heavy detail data before a group is selected", async ({ page }) => {
  let releaseAutoTick: () => void = () => {};
  const autoTickGate = new Promise<void>((resolve) => {
    releaseAutoTick = resolve;
  });
  let detailRequests = 0;
  let auditRequests = 0;
  await installAuth(page);
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const method = request.method();

    if (path.endsWith("/auth/me") && method === "GET") {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(authUserPayload()) });
    }

    if (path.endsWith("/journal-monitors/auto-tick") && method === "POST") {
      await autoTickGate;
      return route.fulfill({
        status: 202,
        contentType: "application/json",
        body: JSON.stringify({ processed_sections: 1, failed_sections: 0 })
      });
    }

    if (path.endsWith("/groups") && method === "GET") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([
          {
            id: 1,
            code: "73-26",
            name: "Тестова група",
            capacity: 25,
            status: "active",
            start_date: null,
            end_date: null,
            year: 2026
          }
        ])
      });
    }

    if (path.endsWith("/groups/1/detail") && method === "GET") {
      detailRequests += 1;
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          active_trainees: 0,
          archived_trainees: 0,
          capacity_used_pct: 0,
          trainees: [],
          schedule_slots: 0,
          schedule_hours: 0,
          schedule_date_from: null,
          schedule_date_to: null,
          teachers: []
        })
      });
    }

    if (path.endsWith("/groups/1/audit") && method === "GET") {
      auditRequests += 1;
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([]) });
    }

    return route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ detail: "not mocked" }) });
  });

  try {
    await page.goto("/groups");
    await expect(page.getByText("73-26", { exact: true })).toBeVisible({ timeout: 1000 });
    await expect.poll(() => detailRequests, { timeout: 1000 }).toBe(0);
    await expect.poll(() => auditRequests, { timeout: 1000 }).toBe(0);
  } finally {
    releaseAutoTick();
  }
});

test("trainees registry does not wait for journal auto tick", async ({ page }) => {
  let releaseAutoTick: () => void = () => {};
  const autoTickGate = new Promise<void>((resolve) => {
    releaseAutoTick = resolve;
  });
  let refreshStarted = false;
  let traineesRequestsAfterRefresh = 0;

  await installAuth(page);
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const method = request.method();

    if (path.endsWith("/auth/me") && method === "GET") {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(authUserPayload()) });
    }

    if (path.endsWith("/journal-monitors/auto-tick") && method === "POST") {
      await autoTickGate;
      return route.fulfill({
        status: 202,
        contentType: "application/json",
        body: JSON.stringify({ processed_sections: 1, failed_sections: 0 })
      });
    }

    if (path.endsWith("/groups") && method === "GET") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([
          {
            id: 1,
            code: "73-26",
            name: "Тестова група",
            capacity: 25,
            status: "active",
            start_date: null,
            end_date: null,
            year: 2026
          }
        ])
      });
    }

    if (path.endsWith("/trainees") && method === "GET") {
      if (refreshStarted) {
        traineesRequestsAfterRefresh += 1;
      }
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([
          {
            id: 1,
            branch_id: "main",
            source_row_number: 1,
            first_name: "Марина",
            last_name: "Іваненко",
            employment_center: null,
            birth_date: null,
            contract_number: "Д-1",
            certificate_number: null,
            certificate_issue_date: null,
            postal_index: null,
            address: null,
            passport_series: null,
            passport_number: null,
            passport_issued_by: null,
            passport_issued_date: null,
            tax_id: null,
            group_code: "73-26",
            status: "active",
            is_deleted: false,
            deleted_at: null,
            phone: null,
            email: null,
            id_document: null,
            created_at: "2026-05-12T10:00:00Z",
            updated_at: "2026-05-12T10:00:00Z"
          }
        ])
      });
    }

    return route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ detail: "not mocked" }) });
  });

  try {
    await page.goto("/trainees");
    await expect(page.getByRole("button", { name: /Група: 73-26/ })).toBeVisible({ timeout: 1000 });
    refreshStarted = true;
    await page.locator("#main-content").getByRole("button", { name: "Оновити", exact: true }).click();
    await expect.poll(() => traineesRequestsAfterRefresh, { timeout: 1000 }).toBeGreaterThan(0);
  } finally {
    releaseAutoTick();
  }
});

test("trainees registry schedules background intake sync every 45 seconds", async ({ page }) => {
  await installAuth(page);
  await page.addInitScript(() => {
    const originalSetInterval = window.setInterval.bind(window);
    (window as unknown as { __suptcIntervals: number[] }).__suptcIntervals = [];
    window.setInterval = ((handler: TimerHandler, timeout?: number, ...args: unknown[]) => {
      (window as unknown as { __suptcIntervals: number[] }).__suptcIntervals.push(Number(timeout));
      return originalSetInterval(handler, timeout, ...args);
    }) as typeof window.setInterval;
  });

  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const method = request.method();

    if (path.endsWith("/auth/me") && method === "GET") {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(authUserPayload()) });
    }

    if (path.endsWith("/journal-monitors/auto-tick") && method === "POST") {
      return route.fulfill({
        status: 202,
        contentType: "application/json",
        body: JSON.stringify({ processed_sections: 0, failed_sections: 0, drive_intake_processed: 0, drive_intake_failed: 0 })
      });
    }

    if (path.endsWith("/groups") && method === "GET") {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([]) });
    }

    if (path.endsWith("/trainees") && method === "GET") {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([]) });
    }

    return route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ detail: "not mocked" }) });
  });

  await page.goto("/trainees");

  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __suptcIntervals: number[] }).__suptcIntervals), {
      timeout: 1000
    })
    .toContain(45_000);
});
