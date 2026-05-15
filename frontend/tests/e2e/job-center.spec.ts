import { expect, test } from "@playwright/test";

test("job center shows jobs and allows refresh", async ({ page }) => {
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

    if (path.endsWith("/jobs") && method === "GET") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([
          {
            job_type: "export",
            report_type: "kpi",
            export_format: "xlsx",
            output_document_id: 5,
            job: {
              id: 17,
              status: "succeeded",
              message: "Експорт виконано",
              result_payload: { output_document_id: 5 },
              started_at: "2026-04-24T10:00:00Z",
              finished_at: "2026-04-24T10:00:05Z",
              created_at: "2026-04-24T09:59:59Z",
              updated_at: "2026-04-24T10:00:05Z"
            }
          }
        ])
      });
    }

    if (path.endsWith("/jobs/17") && method === "GET") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          job_type: "export",
          job: {
            id: 17,
            status: "succeeded",
            message: "Експорт виконано",
            result_payload: { output_document_id: 5 },
            started_at: "2026-04-24T10:00:00Z",
            finished_at: "2026-04-24T10:00:05Z",
            created_at: "2026-04-24T09:59:59Z",
            updated_at: "2026-04-24T10:00:05Z"
          }
        })
      });
    }

    if (path.endsWith("/dashboard/kpi") && method === "GET") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          active_groups: 1,
          active_trainees: 10,
          training_plan_progress_pct: 40,
          student_plan_year: 2026,
          student_plan_target: 100,
          student_plan_processed: 40,
          forecast_graduation: 5,
          forecast_employment: 4
        })
      });
    }

    return route.fulfill({
      status: 404,
      contentType: "application/json",
      body: JSON.stringify({ detail: "not mocked" })
    });
  });

  await page.addInitScript(() => {
    localStorage.setItem(
      "suptc_auth",
      JSON.stringify({
        accessToken: "test-access-token",
        refreshToken: "test-refresh-token"
      })
    );
  });

  await page.goto("/jobs");
  await expect(page.getByRole("heading", { name: "1.1 Центр імпорту" })).toBeVisible();
  await expect(page.getByText("Експорт виконано")).toBeVisible();
  await page.getByRole("button", { name: "Оновити" }).first().click();
  await expect(page.getByRole("cell", { name: "Успішно" })).toBeVisible();
});

test("job center confirms cancellation before stopping an active job", async ({ page }) => {
  let cancelRequested = false;

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

    if (path.endsWith("/documents/import/batch/formats") && method === "GET") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ supported_extensions: ["xlsx", "csv", "docx"] })
      });
    }

    if (path.endsWith("/jobs/drive-intake") && method === "GET") {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([]) });
    }

    if (path.endsWith("/jobs/email-intake") && method === "GET") {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([]) });
    }

    if (path.endsWith("/jobs/88/cancel") && method === "POST") {
      cancelRequested = true;
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          job_type: "import",
          job: {
            id: 88,
            status: "failed",
            message: "Скасовано користувачем",
            result_payload: { source: "manual_upload" },
            started_at: "2026-05-15T08:00:00Z",
            finished_at: "2026-05-15T08:02:00Z",
            created_at: "2026-05-15T07:59:50Z",
            updated_at: "2026-05-15T08:02:00Z"
          }
        })
      });
    }

    if (path.endsWith("/jobs") && method === "GET") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([
          {
            job_type: "import",
            import_source: "manual_upload",
            document_id: 88,
            document_file_name: "active-import.xlsx",
            job: {
              id: 88,
              status: "running",
              message: "Імпорт виконується",
              result_payload: { source: "manual_upload" },
              started_at: "2026-05-15T08:00:00Z",
              finished_at: null,
              created_at: "2026-05-15T07:59:50Z",
              updated_at: "2026-05-15T08:01:00Z"
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

  await page.addInitScript(() => {
    localStorage.setItem(
      "suptc_auth",
      JSON.stringify({
        accessToken: "test-access-token",
        refreshToken: "test-refresh-token"
      })
    );
  });

  await page.goto("/jobs");
  await page.getByRole("button", { name: "Скасувати" }).click();
  await expect.poll(() => cancelRequested).toBe(false);

  const confirmDialog = page.getByRole("alertdialog", { name: "Скасувати задачу" });
  await expect(confirmDialog).toBeVisible();
  await expect(confirmDialog).toContainText("active-import.xlsx");
  await confirmDialog.getByRole("button", { name: "Скасувати задачу" }).click();

  await expect.poll(() => cancelRequested).toBe(true);
  await expect(page.getByRole("cell", { name: "Скасовано користувачем" }).first()).toBeVisible();
});

test("job center highlights failed Drive jobs that need attention", async ({ page }) => {
  let retryRequested = false;

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
            document_id: 99,
            document_file_name: "46-26 Schedule.docx",
            job: {
              id: 99,
              status: "failed",
              message: "Google Drive denied rename",
              result_payload: {
                source: "drive_intake",
                drive_file_name: "46-26 Schedule.docx",
                processed_drive_file_name: "46-26 Schedule [processed].docx",
                marking_error: "Google Drive denied rename"
              },
              started_at: "2026-05-15T08:00:00Z",
              finished_at: "2026-05-15T08:01:00Z",
              created_at: "2026-05-15T07:59:50Z",
              updated_at: "2026-05-15T08:01:00Z"
            }
          },
          {
            job_type: "import",
            import_source: "mail_gmail_api",
            document_id: null,
            document_file_name: null,
            job: {
              id: 100,
              status: "failed",
              message: "MAIL_WEBHOOK_SECRET is missing or invalid",
              result_payload: {
                source: "mail_gmail_api"
              },
              started_at: "2026-05-15T08:02:00Z",
              finished_at: "2026-05-15T08:02:10Z",
              created_at: "2026-05-15T08:01:50Z",
              updated_at: "2026-05-15T08:02:10Z"
            }
          }
        ])
      });
    }

    if (path.endsWith("/jobs/99/retry") && method === "POST") {
      retryRequested = true;
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          job_type: "import",
          job: {
            id: 99,
            status: "running",
            message: "Задачу перезапущено",
            result_payload: {
              source: "drive_intake",
              drive_file_name: "46-26 Schedule.docx"
            },
            started_at: "2026-05-15T08:03:00Z",
            finished_at: null,
            created_at: "2026-05-15T07:59:50Z",
            updated_at: "2026-05-15T08:03:00Z"
          }
        })
      });
    }

    return route.fulfill({
      status: 404,
      contentType: "application/json",
      body: JSON.stringify({ detail: "not mocked" })
    });
  });

  await page.addInitScript(() => {
    localStorage.setItem(
      "suptc_auth",
      JSON.stringify({
        accessToken: "test-access-token",
        refreshToken: "test-refresh-token"
      })
    );
  });

  await page.goto("/jobs");

  const attentionPanel = page.getByTestId("job-attention-panel");
  await expect(attentionPanel).toBeVisible();
  await expect(attentionPanel).toContainText("Потребують уваги");
  await expect(attentionPanel).toContainText("Google Drive");
  await expect(attentionPanel).toContainText("46-26 Schedule.docx");
  await expect(attentionPanel).toContainText("Google Drive denied rename");
  await expect(attentionPanel).toContainText("Надайте service account доступ Editor");
  await expect(attentionPanel).toContainText("Пошта: Gmail API");
  await expect(attentionPanel).toContainText("Перевірте MAIL_WEBHOOK_SECRET");

  await attentionPanel.getByRole("button", { name: "Повторити #99" }).click();
  await expect.poll(() => retryRequested).toBe(false);

  const confirmDialog = page.getByRole("alertdialog", { name: "Повторити задачу" });
  await expect(confirmDialog).toBeVisible();
  await expect(confirmDialog).toContainText("46-26 Schedule.docx");
  await confirmDialog.getByRole("button", { name: "Повторити задачу" }).click();

  await expect.poll(() => retryRequested).toBe(true);
});

test("job center shows dedicated Google Drive intake status", async ({ page }) => {
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

    if (path.endsWith("/documents/import/batch/formats") && method === "GET") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ supported_extensions: ["xlsx", "csv", "docx"] })
      });
    }

    if (path.endsWith("/jobs/drive-intake") && method === "GET") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([
          {
            job_type: "import",
            import_source: "drive_intake",
            document_id: 99,
            document_file_name: "46-26 Schedule.docx",
            job: {
              id: 99,
              status: "failed",
              message: "Google Drive denied rename",
              result_payload: {
                source: "drive_intake",
                drive_file_name: "46-26 Schedule.docx",
                processed_drive_file_name: "46-26 Schedule [processed].docx",
                marking_error: "Google Drive denied rename"
              },
              started_at: "2026-05-15T08:00:00Z",
              finished_at: "2026-05-15T08:01:00Z",
              created_at: "2026-05-15T07:59:50Z",
              updated_at: "2026-05-15T08:01:00Z"
            }
          }
        ])
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

  await page.addInitScript(() => {
    localStorage.setItem(
      "suptc_auth",
      JSON.stringify({
        accessToken: "test-access-token",
        refreshToken: "test-refresh-token"
      })
    );
  });

  await page.goto("/jobs");

  const drivePanel = page.getByTestId("drive-intake-panel");
  await expect(drivePanel).toBeVisible();
  await expect(drivePanel).toContainText("Google Drive intake");
  await expect(drivePanel).toContainText("Останній файл");
  await expect(drivePanel).toContainText("46-26 Schedule.docx");
  await expect(drivePanel).toContainText("Drive після маркування");
  await expect(drivePanel).toContainText("46-26 Schedule [processed].docx");
  await expect(drivePanel).toContainText("Оновлено:");
  await expect(drivePanel).toContainText("Завершено:");
  await expect(drivePanel).toContainText("Google Drive denied rename");
  await expect(drivePanel).toContainText("Надайте service account доступ Editor");
});

test("job center can re-import a Google Drive intake file from the Drive panel", async ({ page }) => {
  let reprocessRequested = false;
  let driveHistoryRequests = 0;

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

    if (path.endsWith("/documents/import/batch/formats") && method === "GET") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ supported_extensions: ["xlsx", "csv", "docx"] })
      });
    }

    if (path.endsWith("/jobs/drive-intake") && method === "GET") {
      driveHistoryRequests += 1;
      const rows = reprocessRequested
        ? [
            {
              job_type: "import",
              import_source: "drive_intake",
              document_id: 99,
              document_file_name: "46-26 Schedule.docx",
              job: {
                id: 120,
                status: "queued",
                message: "Повторний імпорт із задачі #99",
                result_payload: {
                  source: "manual_reprocess",
                  reprocess_of_job_id: 99,
                  drive_file_name: "46-26 Schedule.docx"
                },
                started_at: null,
                finished_at: null,
                created_at: "2026-05-15T08:05:00Z",
                updated_at: "2026-05-15T08:05:00Z"
              }
            }
          ]
        : [
            {
              job_type: "import",
              import_source: "drive_intake",
              document_id: 99,
              document_file_name: "46-26 Schedule.docx",
              job: {
                id: 99,
                status: "succeeded",
                message: "Імпорт виконано",
                result_payload: {
                  source: "drive_intake",
                  drive_file_name: "46-26 Schedule.docx"
                },
                started_at: "2026-05-15T08:00:00Z",
                finished_at: "2026-05-15T08:01:00Z",
                created_at: "2026-05-15T07:59:50Z",
                updated_at: "2026-05-15T08:01:00Z"
              }
            }
          ];
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(rows) });
    }

    if (path.endsWith("/jobs/99/reprocess-import") && method === "POST") {
      reprocessRequested = true;
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          job_type: "import",
          job: {
            id: 120,
            status: "queued",
            message: "Повторний імпорт із задачі #99",
            result_payload: {
              source: "manual_reprocess",
              reprocess_of_job_id: 99,
              drive_file_name: "46-26 Schedule.docx"
            },
            started_at: null,
            finished_at: null,
            created_at: "2026-05-15T08:05:00Z",
            updated_at: "2026-05-15T08:05:00Z"
          }
        })
      });
    }

    if (path.endsWith("/jobs") && method === "GET") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(
          reprocessRequested
            ? [
                {
                  job_type: "import",
                  import_source: "drive_intake",
                  document_id: 99,
                  document_file_name: "46-26 Schedule.docx",
                  job: {
                    id: 120,
                    status: "queued",
                    message: "Повторний імпорт із задачі #99",
                    result_payload: {
                      source: "manual_reprocess",
                      reprocess_of_job_id: 99,
                      drive_file_name: "46-26 Schedule.docx"
                    },
                    started_at: null,
                    finished_at: null,
                    created_at: "2026-05-15T08:05:00Z",
                    updated_at: "2026-05-15T08:05:00Z"
                  }
                }
              ]
            : []
        )
      });
    }

    return route.fulfill({
      status: 404,
      contentType: "application/json",
      body: JSON.stringify({ detail: "not mocked" })
    });
  });

  await page.addInitScript(() => {
    localStorage.setItem(
      "suptc_auth",
      JSON.stringify({
        accessToken: "test-access-token",
        refreshToken: "test-refresh-token"
      })
    );
  });

  await page.goto("/jobs");

  const drivePanel = page.getByTestId("drive-intake-panel");
  await expect(drivePanel).toContainText("46-26 Schedule.docx");
  await drivePanel.getByRole("button", { name: "Повторно імпортувати #99" }).click();
  await expect.poll(() => reprocessRequested).toBe(false);

  const confirmDialog = page.getByRole("alertdialog", { name: "Повторно імпортувати файл" });
  await expect(confirmDialog).toBeVisible();
  await expect(confirmDialog).toContainText("46-26 Schedule.docx");
  await confirmDialog.getByRole("button", { name: "Повторно імпортувати" }).click();

  await expect.poll(() => reprocessRequested).toBe(true);
  await expect.poll(() => driveHistoryRequests).toBeGreaterThan(1);
  await expect(drivePanel).toContainText("#120");
  await expect(drivePanel).toContainText("Повторний імпорт із задачі #99");
});

test("job center confirms rollback before revoking an import", async ({ page }) => {
  let rollbackRequested = false;

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

    if (path.endsWith("/documents/import/batch/formats") && method === "GET") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ supported_extensions: ["xlsx", "csv", "docx"] })
      });
    }

    if (path.endsWith("/jobs/drive-intake") && method === "GET") {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([]) });
    }

    if (path.endsWith("/jobs/email-intake") && method === "GET") {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([]) });
    }

    if (path.endsWith("/jobs/77/rollback-import") && method === "POST") {
      rollbackRequested = true;
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          job_type: "import",
          job: {
            id: 77,
            status: "failed",
            message: "Імпорт відкликано. Видалено слухачів: 2",
            result_payload: {
              import_result: { inserted_ids: [101, 102] },
              rollback: { requested_count: 2, deleted_trainees: 2 }
            },
            started_at: "2026-05-15T08:00:00Z",
            finished_at: "2026-05-15T08:01:00Z",
            created_at: "2026-05-15T07:59:50Z",
            updated_at: "2026-05-15T08:05:00Z"
          }
        })
      });
    }

    if (path.endsWith("/jobs") && method === "GET") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([
          {
            job_type: "import",
            import_source: "manual_upload",
            document_id: 77,
            document_file_name: "contracts.xlsx",
            job: {
              id: 77,
              status: "succeeded",
              message: "Імпорт виконано",
              result_payload: { import_result: { inserted_ids: [101, 102] } },
              started_at: "2026-05-15T08:00:00Z",
              finished_at: "2026-05-15T08:01:00Z",
              created_at: "2026-05-15T07:59:50Z",
              updated_at: "2026-05-15T08:01:00Z"
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

  await page.addInitScript(() => {
    localStorage.setItem(
      "suptc_auth",
      JSON.stringify({
        accessToken: "test-access-token",
        refreshToken: "test-refresh-token"
      })
    );
  });

  await page.goto("/jobs");
  await page.getByRole("button", { name: "Відкликати імпорт" }).click();
  await expect.poll(() => rollbackRequested).toBe(false);

  const confirmDialog = page.getByRole("alertdialog", { name: "Відкликати імпорт" });
  await expect(confirmDialog).toBeVisible();
  await expect(confirmDialog).toContainText("contracts.xlsx");
  await expect(confirmDialog).toContainText("2");
  await confirmDialog.getByRole("button", { name: "Відкликати імпорт" }).click();

  await expect.poll(() => rollbackRequested).toBe(true);
  await expect(page.getByRole("cell", { name: "Імпорт відкликано. Видалено слухачів: 2" })).toBeVisible();
});

test("job center shows dedicated email intake status", async ({ page }) => {
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

    if (path.endsWith("/documents/import/batch/formats") && method === "GET") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ supported_extensions: ["xlsx", "csv", "docx"] })
      });
    }

    if (path.endsWith("/jobs/drive-intake") && method === "GET") {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([]) });
    }

    if (path.endsWith("/jobs/email-intake") && method === "GET") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([
          {
            job_type: "import",
            import_source: "mail_gmail_api",
            document_id: 130,
            document_file_name: "gmail-contracts.xlsx",
            job: {
              id: 130,
              status: "failed",
              message: "MAIL_WEBHOOK_SECRET is missing or invalid",
              result_payload: {
                source: "mail_gmail_api",
                message_id: "gmail-1"
              },
              started_at: "2026-05-15T08:00:00Z",
              finished_at: "2026-05-15T08:01:00Z",
              created_at: "2026-05-15T07:59:50Z",
              updated_at: "2026-05-15T08:01:00Z"
            }
          },
          {
            job_type: "import",
            import_source: "mail_google_script",
            document_id: 131,
            document_file_name: "apps-script-schedule.docx",
            job: {
              id: 131,
              status: "succeeded",
              message: "Імпорт виконано",
              result_payload: {
                source: "mail_google_script",
                message_id: "script-1"
              },
              started_at: "2026-05-15T08:02:00Z",
              finished_at: "2026-05-15T08:03:00Z",
              created_at: "2026-05-15T08:01:50Z",
              updated_at: "2026-05-15T08:03:00Z"
            }
          }
        ])
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

  await page.addInitScript(() => {
    localStorage.setItem(
      "suptc_auth",
      JSON.stringify({
        accessToken: "test-access-token",
        refreshToken: "test-refresh-token"
      })
    );
  });

  await page.goto("/jobs");

  const emailPanel = page.getByTestId("email-intake-panel");
  await expect(emailPanel).toBeVisible();
  await expect(emailPanel).toContainText("Email intake");
  await expect(emailPanel).toContainText("Пошта: Gmail API");
  await expect(emailPanel).toContainText("gmail-contracts.xlsx");
  await expect(emailPanel).toContainText("MAIL_WEBHOOK_SECRET is missing or invalid");
  await expect(emailPanel).toContainText("Перевірте MAIL_WEBHOOK_SECRET");
  await expect(emailPanel).toContainText("Пошта: Google Script");
  await expect(emailPanel).toContainText("apps-script-schedule.docx");
});

test("job center shows read-only worker health", async ({ page }) => {
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

    if (path.endsWith("/documents/import/batch/formats") && method === "GET") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ supported_extensions: ["xlsx", "csv", "docx"] })
      });
    }

    if (path.endsWith("/jobs/drive-intake") && method === "GET") {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([]) });
    }

    if (path.endsWith("/jobs/email-intake") && method === "GET") {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([]) });
    }

    if (path.endsWith("/jobs/worker-health") && method === "GET") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          status: "ok",
          celery: {
            broker_configured: true,
            ping_ok: true,
            workers: ["celery@worker-1"],
            error: null
          },
          backlog: {
            import: { queued: 2, running: 1 },
            export: { queued: 1, running: 0 },
            total_active: 4
          },
          queues: [
            { task: "app.tasks.worker.process_import_job_task", queue: "import_parse" },
            { task: "app.tasks.worker.process_drive_intake_auto_task", queue: "drive_intake" }
          ],
          beat_schedule: [
            {
              name: "google-drive-intake-auto",
              task: "app.tasks.worker.process_drive_intake_auto_task",
              schedule_seconds: 45
            }
          ],
          settings: {
            drive_intake_auto_enabled: true,
            drive_intake_interval_seconds: 45,
            journal_auto_interval_seconds: 60,
            imap_fallback_enabled: false,
            imap_auto_poll_enabled: false,
            mail_primary_channel: "google_apps_script"
          }
        })
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

  await page.addInitScript(() => {
    localStorage.setItem(
      "suptc_auth",
      JSON.stringify({
        accessToken: "test-access-token",
        refreshToken: "test-refresh-token"
      })
    );
  });

  await page.goto("/jobs");

  const workerPanel = page.getByTestId("worker-health-panel");
  await expect(workerPanel).toBeVisible();
  await expect(workerPanel).toContainText("Worker health");
  await expect(workerPanel).toContainText("celery@worker-1");
  await expect(workerPanel).toContainText("Активних задач: 4");
  await expect(workerPanel).toContainText("import_parse");
  await expect(workerPanel).toContainText("google-drive-intake-auto");
  await expect(workerPanel).toContainText("45 с");
  await expect(workerPanel).toContainText("Email канал: Google Apps Script");
  await expect(workerPanel).toContainText("IMAP fallback: вимкнено");
  await expect(workerPanel).toContainText("IMAP auto poll: вимкнено");
});
