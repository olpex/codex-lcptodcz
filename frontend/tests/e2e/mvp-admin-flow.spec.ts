import { expect, test } from "@playwright/test";

test("admin can run core MVP flow", async ({ page }) => {
  const state = {
    groups: [] as Array<{ id: number; code: string; name: string; capacity: number; status: string }>,
    trainees: [] as Array<{
      id: number;
      first_name: string;
      last_name: string;
      status: string;
      phone: string | null;
      email: string | null;
      id_document: string | null;
      birth_date: string | null;
    }>,
    slots: [] as Array<{
      id: number;
      group_id: number;
      teacher_id: number;
      subject_id: number;
      room_id: number;
      starts_at: string;
      ends_at: string;
    }>,
    drafts: [
      {
        id: 1,
        document_id: 1,
        draft_type: "trainee_card",
        status: "pending",
        confidence: 0.77,
        extracted_text: "Іван Петренко",
        structured_payload: {
          first_name: "Іван",
          last_name: "Петренко",
          status: "active"
        },
        created_at: "2026-01-01T00:00:00Z"
      }
    ],
    exportJobs: new Map<number, { id: number; status: string; message: string | null }>(),
    nextGroupId: 1,
    nextTraineeId: 1,
    nextSlotId: 1,
    nextJobId: 1
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

    if (path.endsWith("/dashboard/kpi") && method === "GET") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          active_groups: state.groups.length,
          active_trainees: state.trainees.length,
          training_plan_progress_pct: 25,
          student_plan_year: 2026,
          student_plan_target: 100,
          student_plan_processed: state.trainees.length,
          forecast_graduation: 2,
          forecast_employment: 1
        })
      });
    }

    if (path.endsWith("/groups") && method === "GET") {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(state.groups) });
    }

    if (path.endsWith("/groups") && method === "POST") {
      const payload = request.postDataJSON() as {
        code: string;
        name: string;
        capacity: number;
        status: string;
      };
      const group = {
        id: state.nextGroupId++,
        code: payload.code,
        name: payload.name,
        capacity: payload.capacity,
        status: payload.status
      };
      state.groups.push(group);
      return route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify(group) });
    }

    if (path.includes("/trainees") && method === "GET") {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(state.trainees) });
    }

    if (path.endsWith("/trainees") && method === "POST") {
      const payload = request.postDataJSON() as {
        first_name: string;
        last_name: string;
        status: string;
        phone?: string | null;
        email?: string | null;
      };
      const trainee = {
        id: state.nextTraineeId++,
        first_name: payload.first_name,
        last_name: payload.last_name,
        status: payload.status || "active",
        phone: payload.phone || null,
        email: payload.email || null,
        id_document: null,
        birth_date: null
      };
      state.trainees.push(trainee);
      return route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify(trainee) });
    }

    if (path.endsWith("/schedule") && method === "GET") {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(state.slots) });
    }

    if (path.endsWith("/schedule/generate") && method === "POST") {
      const slot = {
        id: state.nextSlotId++,
        group_id: state.groups[0]?.id ?? 1,
        teacher_id: 1,
        subject_id: 1,
        room_id: 1,
        starts_at: "2026-04-01T09:00:00Z",
        ends_at: "2026-04-01T11:00:00Z"
      };
      state.slots = [slot];
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(state.slots) });
    }

    if (path.endsWith("/documents/export") && method === "POST") {
      const job = { id: state.nextJobId++, status: "queued", message: "Заявку на експорт створено", result_payload: null };
      state.exportJobs.set(job.id, { ...job });
      return route.fulfill({ status: 202, contentType: "application/json", body: JSON.stringify(job) });
    }

    if (path.match(/\/jobs\/\d+$/) && method === "GET") {
      const jobId = Number(path.split("/").pop());
      const stored = state.exportJobs.get(jobId);
      if (!stored) {
        return route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ detail: "not found" }) });
      }
      stored.status = "succeeded";
      stored.message = "Експорт виконано";
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ job_type: "export", job: { ...stored, result_payload: { rows: 1 } } })
      });
    }

    if (path.endsWith("/mail/messages") && method === "GET") {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([]) });
    }

    if (path.endsWith("/drafts") && method === "GET") {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(state.drafts) });
    }

    if (path.endsWith("/drafts/1") && method === "PATCH") {
      const payload = request.postDataJSON() as {
        draft_type: string;
        confidence: number;
        structured_payload: Record<string, unknown>;
      };
      state.drafts[0] = {
        ...state.drafts[0],
        draft_type: payload.draft_type,
        confidence: payload.confidence,
        structured_payload: payload.structured_payload
      };
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(state.drafts[0]) });
    }

    if (path.endsWith("/drafts/1/approve") && method === "POST") {
      state.drafts[0] = { ...state.drafts[0], status: "approved" };
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ draft_id: 1, status: "approved", created_entity: { type: "trainee", id: 99 } })
      });
    }

    return route.fulfill({
      status: 404,
      contentType: "application/json",
      body: JSON.stringify({ detail: "not mocked" })
    });
  });

  await page.goto("/groups");
  await page.getByPlaceholder("Код групи").fill("MVP-001");
  await page.getByPlaceholder("Назва групи").fill("Група MVP");
  await page.getByRole("button", { name: "Створити" }).click();
  await expect(page.getByText("MVP-001")).toBeVisible();

  await page.goto("/trainees");
  await page.locator("input[placeholder=\"Ім'я\"]").fill("Марина");
  await page.locator("input[placeholder=\"Прізвище\"]").fill("Іваненко");
  await page.getByRole("button", { name: "Додати" }).click();
  await expect(page.getByText("Іваненко Марина")).toBeVisible();

  await page.goto("/schedule");
  await page.getByRole("button", { name: "Згенерувати" }).click();
  await expect(page.locator("table tbody tr")).toHaveCount(1);

  await page.goto("/documents");
  await page.getByRole("button", { name: "Згенерувати" }).click();
  await page.getByRole("button", { name: "Оновити статус" }).click();
  await expect(page.getByText("succeeded")).toBeVisible();

  await page.goto("/drafts");
  await page.getByRole("button", { name: "Підтвердити" }).click();
  await expect(page.getByText("Чернетка 1 підтверджена")).toBeVisible();
});
