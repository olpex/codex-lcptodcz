import math
import time
from io import BytesIO

import pytest
from openpyxl import Workbook

from app.api.routes import journal_monitors as journal_monitor_routes
from app.models import Document, DocumentType, ExportJob, ImportJob, JobStatus, JournalMonitorSection


IMPORT_PREVIEW_ROUTE = "/api/v1/documents/import/preview"
OCR_UPLOAD_ROUTE = "/api/v1/drafts/upload-image"
DRIVE_SYNC_ROUTE_TEMPLATE = "/api/v1/journal-monitors/{section_id}/sync"
JOB_STATUSES_ROUTE = "/api/v1/jobs/statuses"


def _contracts_xlsx_bytes(rows: int = 8) -> bytes:
    stream = BytesIO()
    workbook = Workbook()
    sheet = workbook.active
    sheet.title = "Додаток"
    sheet.append(["Група 46-26 Perf"])
    sheet.append([])
    sheet.append(["№", "ПІБ безробітного", "Дата народження", "№ Договору"])
    for index in range(1, rows + 1):
        sheet.append([index, f"Слухач {index}", "01.02.2000", f"46-26/{index:03d}"])
    workbook.save(stream)
    stream.seek(0)
    return stream.read()


def _percentile(values: list[float], percentile: float) -> float:
    ordered = sorted(values)
    index = max(0, min(len(ordered) - 1, math.ceil((percentile / 100) * len(ordered)) - 1))
    return ordered[index]


def _assert_latency(label: str, durations: list[float], *, p95_under: float, p99_under: float) -> None:
    assert durations, f"{label} did not record timings"
    p95 = _percentile(durations, 95)
    p99 = _percentile(durations, 99)
    assert p95 < p95_under, f"{label} p95={p95:.3f}s exceeded {p95_under:.3f}s"
    assert p99 < p99_under, f"{label} p99={p99:.3f}s exceeded {p99_under:.3f}s"


@pytest.mark.perf
def test_import_preview_route_keeps_bounded_p95_latency(client, auth_headers):
    payload = _contracts_xlsx_bytes()
    durations: list[float] = []

    for index in range(8):
        started = time.perf_counter()
        response = client.post(
            IMPORT_PREVIEW_ROUTE,
            headers=auth_headers,
            files={
                "file": (
                    f"contracts-perf-{index}.xlsx",
                    payload,
                    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                )
            },
        )
        durations.append(time.perf_counter() - started)
        assert response.status_code == 200
        assert response.json()["import_kind"] == "contracts"

    _assert_latency("import preview", durations, p95_under=1.0, p99_under=1.25)


@pytest.mark.perf
def test_ocr_upload_route_with_browser_text_keeps_bounded_p95_latency(client, auth_headers):
    durations: list[float] = []
    extracted_text = "Розклад занять групи 46-26\n21.10.2026 1 пара Кар'єрний розвиток ауд. 1"

    for index in range(6):
        started = time.perf_counter()
        response = client.post(
            OCR_UPLOAD_ROUTE,
            headers=auth_headers,
            data={"draft_type": "schedule", "extracted_text": extracted_text},
            files={"file": (f"46-26-ocr-perf-{index}.png", b"browser-ocr-text-only", "image/png")},
        )
        durations.append(time.perf_counter() - started)
        assert response.status_code == 201
        assert response.json()["draft_type"] == "schedule"

    _assert_latency("ocr draft upload", durations, p95_under=1.0, p99_under=1.25)


@pytest.mark.perf
def test_drive_sync_route_keeps_bounded_p95_latency(client, auth_headers, db_session, monkeypatch):
    monkeypatch.setattr(journal_monitor_routes, "list_drive_child_folders", lambda folder_id, service_account_json=None: [])
    section = JournalMonitorSection(
        branch_id="main",
        name="Журнали perf",
        folder_url="https://drive.google.com/drive/folders/perf-root",
        folder_id="perf-root",
    )
    db_session.add(section)
    db_session.commit()
    db_session.refresh(section)

    sync_route = DRIVE_SYNC_ROUTE_TEMPLATE.format(section_id=section.id)
    durations: list[float] = []

    for _ in range(8):
        started = time.perf_counter()
        response = client.post(sync_route, headers=auth_headers)
        durations.append(time.perf_counter() - started)
        assert response.status_code == 200

    _assert_latency("Drive sync", durations, p95_under=1.0, p99_under=1.25)


@pytest.mark.perf
def test_job_statuses_route_keeps_bounded_p95_latency(client, auth_headers, db_session):
    document = Document(
        branch_id="main",
        file_name="job-status-perf.xlsx",
        file_path="/tmp/job-status-perf.xlsx",
        file_type=DocumentType.XLSX,
        source="upload",
    )
    db_session.add(document)
    db_session.commit()
    db_session.refresh(document)

    job_ids: list[int] = []
    for index in range(24):
        job = ImportJob(
            branch_id="main",
            idempotency_key=f"perf-status-import-{index}",
            document_id=document.id,
            status=JobStatus.QUEUED if index % 2 == 0 else JobStatus.RUNNING,
            message="perf status import",
        )
        db_session.add(job)
        db_session.flush()
        job_ids.append(job.id)
    for index in range(8):
        db_session.add(
            ExportJob(
                branch_id="main",
                idempotency_key=f"perf-status-export-{index}",
                report_type="kpi",
                export_format="xlsx",
                status=JobStatus.QUEUED,
                message="perf status export",
            )
        )
    db_session.commit()

    id_query = "&".join(f"job_id={job_id}" for job_id in job_ids)
    durations: list[float] = []

    for _ in range(12):
        started = time.perf_counter()
        response = client.get(f"{JOB_STATUSES_ROUTE}?limit=100&{id_query}", headers=auth_headers)
        durations.append(time.perf_counter() - started)
        assert response.status_code == 200
        assert len(response.json()) >= len(job_ids)

    _assert_latency("job statuses", durations, p95_under=0.75, p99_under=1.0)
