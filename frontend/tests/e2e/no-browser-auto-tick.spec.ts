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
    full_name: "Admin",
    branch_id: "main",
    roles: [{ id: 1, name: "admin" }]
  };
}

test("frontend pages do not trigger journal auto tick from an open browser tab", async ({ page }) => {
  let autoTickRequests = 0;

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
      autoTickRequests += 1;
      return route.fulfill({ status: 410, contentType: "application/json", body: JSON.stringify({ detail: "disabled" }) });
    }

    if (path.endsWith("/schedule") && method === "GET") {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([]) });
    }

    if (path.endsWith("/teachers") && method === "GET") {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([]) });
    }

    if (path.endsWith("/groups") && method === "GET") {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([]) });
    }

    if (path.endsWith("/trainees") && method === "GET") {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([]) });
    }

    return route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ detail: "not mocked" }) });
  });

  await page.goto("/schedule");
  await page.goto("/trainees");
  await page.waitForTimeout(300);

  expect(autoTickRequests).toBe(0);
});
