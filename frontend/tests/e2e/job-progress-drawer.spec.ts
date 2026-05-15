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
