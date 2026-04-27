# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: mvp-admin-flow.spec.ts >> admin can run core MVP flow
- Location: tests\e2e\mvp-admin-flow.spec.ts:3:1

# Error details

```
Test timeout of 30000ms exceeded.
```

```
Error: locator.fill: Test timeout of 30000ms exceeded.
Call log:
  - waiting for locator('input[placeholder="Ім\'я"]')

```

# Page snapshot

```yaml
- generic [ref=e3]:
  - link "Перейти до основного контенту" [ref=e4] [cursor=pointer]:
    - /url: "#main-content"
  - banner [ref=e5]:
    - generic [ref=e6]:
      - generic [ref=e7]:
        - paragraph [ref=e8]: СУПТЦ
        - paragraph [ref=e9]: Система управління професійно-технічним центром
      - generic [ref=e11]:
        - paragraph [ref=e12]: Системний адміністратор
        - paragraph [ref=e13]: "Ролі: admin"
        - button "Вийти" [ref=e14] [cursor=pointer]
  - generic [ref=e15]:
    - complementary [ref=e16]:
      - navigation "Головна навігація" [ref=e17]:
        - link "Дашборд" [ref=e18] [cursor=pointer]:
          - /url: /
        - link "Профіль" [ref=e19] [cursor=pointer]:
          - /url: /profile
        - link "Групи" [ref=e20] [cursor=pointer]:
          - /url: /groups
        - link "Слухачі" [ref=e21] [cursor=pointer]:
          - /url: /trainees
        - link "Накази" [ref=e22] [cursor=pointer]:
          - /url: /orders
        - link "Розклад" [ref=e23] [cursor=pointer]:
          - /url: /schedule
        - link "Навантаження" [ref=e24] [cursor=pointer]:
          - /url: /workload
        - link "Успішність" [ref=e25] [cursor=pointer]:
          - /url: /performance
        - link "Документи" [ref=e26] [cursor=pointer]:
          - /url: /documents
        - link "Центр задач" [ref=e27] [cursor=pointer]:
          - /url: /jobs
        - link "Чернетки OCR" [ref=e28] [cursor=pointer]:
          - /url: /drafts
    - main [ref=e29]:
      - generic [ref=e30]:
        - generic [ref=e31]:
          - heading "Пошук слухачів" [level=2] [ref=e32]
          - generic [ref=e34]:
            - generic [ref=e35]:
              - generic [ref=e36]: Пошуковий запит
              - textbox "Пошуковий запит" [ref=e37]:
                - /placeholder: ПІБ, номер групи, номер договору
            - button "Знайти" [ref=e38] [cursor=pointer]
        - generic [ref=e39]:
          - heading "Додати слухача вручну" [level=2] [ref=e40]
          - generic [ref=e41]:
            - generic [ref=e42]:
              - generic [ref=e43]: Ім'я *
              - textbox "Ім'я * Ім'я слухача" [ref=e44]
              - generic [ref=e45]: Ім'я слухача
            - generic [ref=e46]:
              - generic [ref=e47]: Прізвище *
              - textbox "Прізвище * Прізвище слухача" [ref=e48]
              - generic [ref=e49]: Прізвище слухача
            - generic [ref=e50]:
              - generic [ref=e51]: Телефон
              - textbox "Телефон" [ref=e52]
            - generic [ref=e53]:
              - generic [ref=e54]:
                - generic [ref=e55]: Номер групи
                - textbox "Номер групи" [ref=e56]
              - button "Додати" [ref=e58] [cursor=pointer]
        - generic [ref=e59]:
          - heading "Реєстр слухачів" [level=2] [ref=e60]
          - generic [ref=e62]:
            - generic [ref=e63]:
              - checkbox "Показати архів" [ref=e64]
              - text: Показати архів
            - button "Розгорнути всі" [ref=e65] [cursor=pointer]
            - button "Згорнути всі" [ref=e66] [cursor=pointer]
            - button "Вибрати всі" [ref=e67] [cursor=pointer]
            - button "Зняти вибір" [ref=e68] [cursor=pointer]
            - generic [ref=e69]: "Вибрано: 0"
            - textbox "Номер групи" [ref=e70]
            - button "Призначити групу" [disabled] [ref=e71]
            - button "Очистити групу" [disabled] [ref=e72]
            - button "Очистити невідомі групи" [ref=e73] [cursor=pointer]
            - button "Архівувати без групи" [ref=e74] [cursor=pointer]
            - combobox [ref=e75]:
              - option "Активний" [selected]
              - option "Завершив навчання"
              - option "Відрахований"
            - button "Змінити статус" [disabled] [ref=e76]
            - button "Відновити вибраних" [disabled] [ref=e77]
            - button "Архівувати вибраних" [disabled] [ref=e78]
          - paragraph [ref=e79]: Слухачі відсутні
```

# Test source

```ts
  126 |       };
  127 |       const trainee = {
  128 |         id: state.nextTraineeId++,
  129 |         first_name: payload.first_name,
  130 |         last_name: payload.last_name,
  131 |         status: payload.status || "active",
  132 |         phone: payload.phone || null,
  133 |         email: payload.email || null,
  134 |         id_document: null,
  135 |         birth_date: null
  136 |       };
  137 |       state.trainees.push(trainee);
  138 |       return route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify(trainee) });
  139 |     }
  140 | 
  141 |     if (path.endsWith("/schedule") && method === "GET") {
  142 |       return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(state.slots) });
  143 |     }
  144 | 
  145 |     if (path.endsWith("/schedule/generate") && method === "POST") {
  146 |       const slot = {
  147 |         id: state.nextSlotId++,
  148 |         group_id: state.groups[0]?.id ?? 1,
  149 |         teacher_id: 1,
  150 |         subject_id: 1,
  151 |         room_id: 1,
  152 |         starts_at: "2026-04-01T09:00:00Z",
  153 |         ends_at: "2026-04-01T11:00:00Z"
  154 |       };
  155 |       state.slots = [slot];
  156 |       return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(state.slots) });
  157 |     }
  158 | 
  159 |     if (path.endsWith("/documents/export") && method === "POST") {
  160 |       const job = { id: state.nextJobId++, status: "queued", message: "Заявку на експорт створено", result_payload: null };
  161 |       state.exportJobs.set(job.id, { ...job });
  162 |       return route.fulfill({ status: 202, contentType: "application/json", body: JSON.stringify(job) });
  163 |     }
  164 | 
  165 |     if (path.match(/\/jobs\/\d+$/) && method === "GET") {
  166 |       const jobId = Number(path.split("/").pop());
  167 |       const stored = state.exportJobs.get(jobId);
  168 |       if (!stored) {
  169 |         return route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ detail: "not found" }) });
  170 |       }
  171 |       stored.status = "succeeded";
  172 |       stored.message = "Експорт виконано";
  173 |       return route.fulfill({
  174 |         status: 200,
  175 |         contentType: "application/json",
  176 |         body: JSON.stringify({ job_type: "export", job: { ...stored, result_payload: { rows: 1 } } })
  177 |       });
  178 |     }
  179 | 
  180 |     if (path.endsWith("/mail/messages") && method === "GET") {
  181 |       return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([]) });
  182 |     }
  183 | 
  184 |     if (path.endsWith("/drafts") && method === "GET") {
  185 |       return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(state.drafts) });
  186 |     }
  187 | 
  188 |     if (path.endsWith("/drafts/1") && method === "PATCH") {
  189 |       const payload = request.postDataJSON() as {
  190 |         draft_type: string;
  191 |         confidence: number;
  192 |         structured_payload: Record<string, unknown>;
  193 |       };
  194 |       state.drafts[0] = {
  195 |         ...state.drafts[0],
  196 |         draft_type: payload.draft_type,
  197 |         confidence: payload.confidence,
  198 |         structured_payload: payload.structured_payload
  199 |       };
  200 |       return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(state.drafts[0]) });
  201 |     }
  202 | 
  203 |     if (path.endsWith("/drafts/1/approve") && method === "POST") {
  204 |       state.drafts[0] = { ...state.drafts[0], status: "approved" };
  205 |       return route.fulfill({
  206 |         status: 200,
  207 |         contentType: "application/json",
  208 |         body: JSON.stringify({ draft_id: 1, status: "approved", created_entity: { type: "trainee", id: 99 } })
  209 |       });
  210 |     }
  211 | 
  212 |     return route.fulfill({
  213 |       status: 404,
  214 |       contentType: "application/json",
  215 |       body: JSON.stringify({ detail: "not mocked" })
  216 |     });
  217 |   });
  218 | 
  219 |   await page.goto("/groups");
  220 |   await page.getByPlaceholder("Код групи").fill("MVP-001");
  221 |   await page.getByPlaceholder("Назва групи").fill("Група MVP");
  222 |   await page.getByRole("button", { name: "Створити" }).click();
  223 |   await expect(page.getByText("MVP-001")).toBeVisible();
  224 | 
  225 |   await page.goto("/trainees");
> 226 |   await page.locator("input[placeholder=\"Ім'я\"]").fill("Марина");
      |                                                     ^ Error: locator.fill: Test timeout of 30000ms exceeded.
  227 |   await page.locator("input[placeholder=\"Прізвище\"]").fill("Іваненко");
  228 |   await page.getByRole("button", { name: "Додати" }).click();
  229 |   await expect(page.getByText("Іваненко Марина")).toBeVisible();
  230 | 
  231 |   await page.goto("/schedule");
  232 |   await page.getByRole("button", { name: "Згенерувати" }).click();
  233 |   await expect(page.locator("table tbody tr")).toHaveCount(1);
  234 | 
  235 |   await page.goto("/documents");
  236 |   await page.getByRole("button", { name: "Згенерувати" }).click();
  237 |   await page.getByRole("button", { name: "Оновити статус" }).click();
  238 |   await expect(page.getByText("succeeded")).toBeVisible();
  239 | 
  240 |   await page.goto("/drafts");
  241 |   await page.getByRole("button", { name: "Підтвердити" }).click();
  242 |   await expect(page.getByText("Чернетка 1 підтверджена")).toBeVisible();
  243 | });
  244 | 
```