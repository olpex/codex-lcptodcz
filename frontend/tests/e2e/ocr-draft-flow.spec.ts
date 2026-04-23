import { expect, test } from "@playwright/test";

test("ocr draft can be edited and approved", async ({ page }) => {
  const draft = {
    id: 1,
    document_id: 10,
    draft_type: "trainee_card",
    status: "pending",
    confidence: 0.73,
    extracted_text: "Іван Петренко\nЗаява на навчання",
    structured_payload: {
      first_name: "Іван",
      last_name: "Петренко",
      status: "active"
    },
    created_at: "2026-01-01T10:00:00Z"
  };

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
          full_name: "Системний адміністратор",
          branch_id: "main",
          roles: [{ id: 1, name: "admin" }]
        })
      });
    }

    if (path.endsWith("/drafts") && method === "GET") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([draft])
      });
    }

    if (path.endsWith("/mail/messages") && method === "GET") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([])
      });
    }

    if (path.endsWith("/drafts/1") && method === "PATCH") {
      const payload = request.postDataJSON() as {
        draft_type: string;
        confidence: number;
        structured_payload: Record<string, unknown>;
      };
      draft.draft_type = payload.draft_type;
      draft.confidence = payload.confidence;
      draft.structured_payload = payload.structured_payload;
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(draft)
      });
    }

    if (path.endsWith("/drafts/1/approve") && method === "POST") {
      draft.status = "approved";
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          draft_id: 1,
          status: "approved",
          created_entity: { type: "trainee", id: 77 }
        })
      });
    }

    return route.fulfill({
      status: 404,
      contentType: "application/json",
      body: JSON.stringify({ detail: "not mocked" })
    });
  });

  await page.goto("/drafts");

  await expect(page.getByText("Редактор чернетки")).toBeVisible();

  await page.getByPlaceholder("Ім'я").fill("Марина");
  await page.getByPlaceholder("Прізвище").fill("Іваненко");
  await page.getByRole("button", { name: "Зберегти зміни" }).click();
  await expect(page.getByText("Чернетка 1 збережена")).toBeVisible();

  await page.getByRole("button", { name: "Підтвердити" }).click();
  await expect(page.getByText("Чернетка 1 підтверджена")).toBeVisible();
});

