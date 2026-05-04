import { expect, test } from "@playwright/test";

const user = {
  id: 1,
  username: "admin",
  full_name: "Системний адміністратор",
  branch_id: "main",
  roles: [
    { id: 1, name: "admin" },
    { id: 2, name: "methodist" }
  ]
};

test.beforeEach(async ({ page }) => {
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
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(user) });
    }

    if (path.endsWith("/documents/import/batch/formats") && method === "GET") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ supported_extensions: ["xls", "xlsx", "csv", "docx"] })
      });
    }

    if (path.endsWith("/jobs") && method === "GET") {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([]) });
    }

    return route.fulfill({
      status: 404,
      contentType: "application/json",
      body: JSON.stringify({ detail: "not mocked" })
    });
  });
});

test("documents page sends data imports to the import center", async ({ page }) => {
  await page.goto("/documents");

  await expect(page.getByRole("heading", { name: "Імпорт даних" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Відкрити центр імпорту" })).toHaveAttribute("href", "/jobs");
  await expect(page.getByLabel("Файл для імпорту")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Експорт звітів (.xlsx, .pdf, .csv)" })).toBeVisible();
});

test("import center exposes only actually supported automatic import formats", async ({ page }) => {
  await page.goto("/jobs");

  const singleFileInput = page.locator("input[type='file']").first();
  await expect(singleFileInput).toHaveAttribute("accept", ".xls,.xlsx,.csv,.docx");
  await expect(page.getByText("PDF наразі не імпортується автоматично")).toBeVisible();
  await expect(page.getByText("Файли XLS/XLSX/CSV/DOCX").first()).toBeVisible();
});
