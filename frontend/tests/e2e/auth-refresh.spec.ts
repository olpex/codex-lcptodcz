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

test("shares one refresh request across parallel expired-token API calls", async ({ page }) => {
  let refreshCalls = 0;

  await page.addInitScript(() => {
    localStorage.setItem(
      "suptc_auth",
      JSON.stringify({
        accessToken: "old-access-token",
        refreshToken: "old-refresh-token"
      })
    );
  });

  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const method = request.method();
    const auth = request.headers().authorization || "";

    if (path.endsWith("/auth/me") && method === "GET") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(user)
      });
    }

    if (path.endsWith("/auth/refresh") && method === "POST") {
      refreshCalls += 1;
      if (refreshCalls > 1) {
        return route.fulfill({
          status: 401,
          contentType: "application/json",
          body: JSON.stringify({ detail: "Refresh token відкликано або прострочено" })
        });
      }
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          access_token: "new-access-token",
          refresh_token: "new-refresh-token"
        })
      });
    }

    if (["/api/v1/groups", "/api/v1/trainees", "/api/v1/schedule"].includes(path) && method === "GET") {
      if (auth !== "Bearer new-access-token") {
        return route.fulfill({
          status: 401,
          contentType: "application/json",
          body: JSON.stringify({ detail: "Сесія завершилась або вказані невірні облікові дані." })
        });
      }
    }

    if (path.endsWith("/groups") && method === "GET") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([
          {
            id: 1,
            code: "167-25",
            name: "Організація трудових відносин",
            capacity: 25,
            status: "active",
            start_date: null,
            end_date: null
          }
        ])
      });
    }

    if (path.endsWith("/trainees") && method === "GET") {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([]) });
    }

    if (path.endsWith("/schedule") && method === "GET") {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([]) });
    }

    if (path.match(/\/groups\/\d+\/audit$/) && method === "GET") {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([]) });
    }

    return route.fulfill({
      status: 404,
      contentType: "application/json",
      body: JSON.stringify({ detail: "not mocked" })
    });
  });

  await page.goto("/groups");

  await expect(page.getByRole("heading", { name: /167-25/ })).toBeVisible();
  expect(refreshCalls).toBe(1);
  await expect(page.getByText("Refresh token відкликано або прострочено")).not.toBeVisible();
});
