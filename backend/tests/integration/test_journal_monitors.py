from datetime import datetime, timezone
from io import BytesIO

from openpyxl import Workbook

from app.core.crypto import cipher
from app.models import Group, GroupStatus, JournalWorkloadEntry, Room, ScheduleSlot, Subject, Teacher, Trainee
from app.services.import_export import collect_teacher_workload_summary
from app.services import journal_monitor


def _seed_schedule(db_session, group: Group, suffix: str) -> None:
    teacher = Teacher(branch_id="main", first_name="Тест", last_name="Викладач", hourly_rate=0, is_active=True)
    subject = Subject(branch_id="main", name=f"Предмет {suffix}", hours_total=4)
    room = Room(branch_id="main", name=f"Аудиторія {suffix}", capacity=20)
    db_session.add_all([teacher, subject, room])
    db_session.flush()
    db_session.add(
        ScheduleSlot(
            group_id=group.id,
            teacher_id=teacher.id,
            subject_id=subject.id,
            room_id=room.id,
            starts_at=datetime(2026, 5, 1, 9, 30, tzinfo=timezone.utc),
            ends_at=datetime(2026, 5, 1, 11, 5, tzinfo=timezone.utc),
            pair_number=1,
            academic_hours=2,
        )
    )


def _journal_workbook_bytes(
    rows: list[tuple[str, float, str, str]],
    *,
    sheet_name: str = "Дисципліни",
    discipline_sheet_index: int = 2,
) -> bytes:
    workbook = Workbook()
    workbook.active.title = "Загальні"
    while len(workbook.worksheets) < discipline_sheet_index:
        workbook.create_sheet(f"Аркуш {len(workbook.worksheets) + 1}")
    sheet = workbook.create_sheet(sheet_name)
    sheet.append(["Назва дисципліни", "Кількість годин", "Сторінки", "Прізвище, ім'я, по батькові викладача"])
    for row in rows:
        sheet.append(list(row))
    stream = BytesIO()
    workbook.save(stream)
    return stream.getvalue()


def _journal_zv_workbook_bytes(rows: list[tuple[int, str, str, str, str, str, str, str]]) -> bytes:
    workbook = Workbook()
    workbook.active.title = "Дисципліни"
    sheet = workbook.create_sheet("ЗВ")
    sheet.append(
        [
            "Номер за порядком",
            "Номер в журналі З-СНН",
            "Прізвище, ім'я та по батькові слухача",
            "Стать",
            "Дата народження",
            "Ідентифікаційний номер",
            "Домашня адреса",
            "Телефон",
        ]
    )
    for row in rows:
        sheet.append(list(row))
    stream = BytesIO()
    workbook.save(stream)
    return stream.getvalue()


def _journal_zv_workbook_with_title_bytes(rows: list[tuple[int, str, str, str, str, str, str]]) -> bytes:
    workbook = Workbook()
    workbook.active.title = "ЗВ"
    sheet = workbook.active
    sheet.merge_cells("A1:G1")
    sheet["A1"] = "ЗАГАЛЬНІ ВІДОМОСТІ ПРО СЛУХАЧІВ"
    sheet.append(["№ п/п", "№ договору", "Прізвище, ім'я, по батькові", "Стать", "Дата народження", "ІПН", "Адреса"])
    for row in rows:
        sheet.append(list(row))
    stream = BytesIO()
    workbook.save(stream)
    return stream.getvalue()


def _journal_combined_workbook_bytes() -> bytes:
    workbook = Workbook()
    workbook.active.title = "Загальні"
    disciplines = workbook.create_sheet("Дисципліни")
    disciplines.append(["Назва дисципліни", "Кількість годин", "Сторінки", "Прізвище, ім'я, по батькові викладача"])
    disciplines.append(["Основи безпеки", 8, "1-8", "Коваль Олена Петрівна"])
    zv = workbook.create_sheet("ЗВ")
    zv.append(
        [
            "Номер за порядком",
            "Номер в журналі З-СНН",
            "Прізвище, ім'я та по батькові слухача",
            "Стать",
            "Дата народження",
            "Ідентифікаційний номер",
            "Домашня адреса",
            "Телефон",
        ]
    )
    zv.append((1, "З-СНН-001", "Петренко Іван Іванович", "ч", "01.02.1990", "1234567890", "м. Львів", "+380501112233"))
    stream = BytesIO()
    workbook.save(stream)
    return stream.getvalue()


def test_journal_zv_parser_skips_title_and_imports_all_real_trainees():
    surnames = [
        "Андрущенко",
        "Бойко",
        "Василенко",
        "Гнатюк",
        "Данилюк",
        "Єфименко",
        "Жук",
        "Захаренко",
        "Іванчук",
        "Климчук",
        "Левченко",
        "Мельник",
        "Назаренко",
        "Онищенко",
        "Петренко",
        "Романюк",
        "Савчук",
        "Ткаченко",
        "Удовенко",
        "Федоренко",
        "Хоменко",
        "Цимбалюк",
        "Чорний",
        "Шевченко",
        "Юрченко",
        "Яценко",
        "Коваль",
        "Марченко",
        "Лисенко",
        "Мороз",
        "Поліщук",
        "Руденко",
        "Семенюк",
    ]
    rows = [
        (
            index,
            "1(З-СНН) від 02.01.2026",
            f"{surname} Наталія Іванівна",
            "ж" if index % 2 else "ч",
            "02.01.1990",
            f"10000000{index:02d}",
            f"Адреса {index}",
        )
        for index, surname in enumerate(surnames, start=1)
    ]

    parsed = journal_monitor.parse_journal_zv_trainees_xlsx(
        _journal_zv_workbook_with_title_bytes(rows),
        group_code="1-26",
        group_name="1-26 Організація трудових відносин",
    )

    assert parsed["rows"] == 33
    assert parsed["data"][0]["Прізвище"] == "Андрущенко"
    assert parsed["data"][0]["Ідентифікаційний номер"] == "1000000001"
    assert parsed["data"][0]["№ договору"] == "1(З-СНН) від 02.01.2026"
    assert parsed["data"][-1]["Номер за порядком"] == 33
    assert all(row["Прізвище"] != "№" for row in parsed["data"])


def test_journal_worker_imports_trainees_from_zv_sheet_and_updates_group_status(
    client,
    auth_headers,
    db_session,
    monkeypatch,
):
    drive_folders = lambda _folder_id, service_account_json=None: [
            {
                "id": "drive-46-26",
                "name": "46-26 Журнал",
                "url": "https://drive.google.com/drive/folders/drive-46-26",
                "modified_time": "2026-03-02T10:00:00Z",
            },
        ]
    monkeypatch.setattr("app.api.routes.journal_monitors.list_drive_child_folders", drive_folders)
    monkeypatch.setattr("app.tasks.worker.list_drive_child_folders", drive_folders)
    monkeypatch.setattr(
        journal_monitor,
        "list_drive_journal_workbook_files",
        lambda folder_id, service_account_json=None: [
            {"id": "zv-xlsx", "name": "46-26 Журнал.xlsx", "mimeType": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"}
        ],
        raising=False,
    )
    monkeypatch.setattr(
        journal_monitor,
        "download_drive_file_bytes",
        lambda file_id, mime_type=None, service_account_json=None: _journal_zv_workbook_bytes(
            [
                (1, "З-СНН-001", "Петренко Іван Іванович", "ч", "01.02.1990", "1234567890", "м. Львів, вул. Зелена 1", "+380501112233"),
                (2, "З-СНН-002", "Коваль Олена Петрівна", "ж", "03.04.1992", "0987654321", "м. Львів, вул. Шевченка 2", "+380672223344"),
            ]
        ),
        raising=False,
    )

    create_response = client.post(
        "/api/v1/journal-monitors",
        json={"name": "Журнали 2026", "folder_url": "https://drive.google.com/drive/folders/root-folder"},
        headers=auth_headers,
    )
    section_id = create_response.json()["id"]
    section = db_session.get(journal_monitor.JournalMonitorSection, section_id)
    section.workload_auto_enabled = True
    section.workload_auto_year = 2026
    db_session.add(section)
    db_session.commit()

    from app.tasks.worker import process_journal_monitor_auto_task

    process_journal_monitor_auto_task.run()
    detail_response = client.get(f"/api/v1/journal-monitors/{section_id}", headers=auth_headers)

    assert detail_response.status_code == 200
    entry = detail_response.json()["entries"][0]
    assert entry["group_code"] == "46-26"
    assert entry["has_trainees"] is True
    assert entry["trainee_count"] == 2
    assert entry["processing_status"] == "trainees_only"
    assert entry["trainees_status"] == "processed"
    assert entry["trainees_message"] == "Додано/оновлено слухачів із журналу: 2"

    trainees = db_session.query(Trainee).order_by(Trainee.last_name).all()
    assert [(trainee.last_name, trainee.first_name, trainee.group_code) for trainee in trainees] == [
        ("Коваль", "Олена Петрівна", "46-26"),
        ("Петренко", "Іван Іванович", "46-26"),
    ]
    assert cipher.decrypt(trainees[1].tax_id_encrypted) == "1234567890"
    assert cipher.decrypt(trainees[1].address_encrypted) == "м. Львів, вул. Зелена 1"
    assert cipher.decrypt(trainees[1].phone_encrypted) == "+380501112233"


def test_journal_trainees_import_keeps_all_rows_with_shared_group_contract(
    db_session,
    monkeypatch,
):
    entry = journal_monitor.JournalMonitorEntry(
        section_id=1,
        branch_id="main",
        drive_file_id="drive-1-26",
        drive_url="https://drive.google.com/drive/folders/drive-1-26",
        journal_name="1-26 Організація трудових відносин",
        group_code="1-26",
    )
    db_session.add(entry)
    db_session.flush()
    monkeypatch.setattr(
        journal_monitor,
        "list_drive_journal_workbook_files",
        lambda folder_id, service_account_json=None: [
            {"id": "shared-contract-zv", "name": "1-26 Журнал.xlsx", "mimeType": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"}
        ],
        raising=False,
    )
    monkeypatch.setattr(
        journal_monitor,
        "download_drive_file_bytes",
        lambda file_id, mime_type=None, service_account_json=None: _journal_zv_workbook_bytes(
            [
                (1, "1(З-СНН) від 02.01.2026", "Петренко Іван Іванович", "ч", "01.02.1990", "", "м. Львів", ""),
                (2, "1(З-СНН) від 02.01.2026", "Коваль Олена Петрівна", "ж", "03.04.1992", "", "м. Київ", ""),
                (3, "1(З-СНН) від 02.01.2026", "Шевченко Марія Іванівна", "ж", "05.06.1994", "", "м. Одеса", ""),
            ]
        ),
        raising=False,
    )

    result = journal_monitor.process_journal_trainees_entry(db_session, entry)

    assert result["entries"] == 3
    assert result["import_result"]["inserted"] == 3
    assert db_session.query(Trainee).filter(Trainee.group_code == "1-26", Trainee.is_deleted.is_(False)).count() == 3


def test_journal_response_hides_redundant_workbook_names_but_keeps_distinct_files():
    redundant_entry = journal_monitor.JournalMonitorEntry(
        id=1,
        section_id=1,
        branch_id="main",
        drive_file_id="drive-1-26",
        journal_name="1-26 Організація трудових відносин в умовах воєнного стану",
        group_code="1-26",
        workload_source_names=[
            '"1-26 Організація трудових відносин в умовах воєнного стану правові аспекти"',
            "Теорія",
        ],
    )

    payload = journal_monitor.entry_to_response_payload(redundant_entry)

    assert payload["workload_source_names"] == ["Теорія"]


def test_background_tick_reprocesses_processed_trainees_when_import_count_is_too_low(
    client,
    auth_headers,
    db_session,
    monkeypatch,
):
    monkeypatch.setattr(
        "app.api.routes.journal_monitors.list_drive_child_folders",
        lambda _folder_id, service_account_json=None: [
            {
                "id": "drive-1-26",
                "name": "1-26 Журнал",
                "url": "https://drive.google.com/drive/folders/drive-1-26",
                "modified_time": "2026-05-01T10:00:00Z",
            },
        ],
    )
    monkeypatch.setattr(
        journal_monitor,
        "list_drive_journal_workbook_files",
        lambda folder_id, service_account_json=None: [
            {"id": "shared-contract-zv", "name": "1-26 Журнал.xlsx", "mimeType": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"}
        ],
        raising=False,
    )
    monkeypatch.setattr(
        journal_monitor,
        "download_drive_file_bytes",
        lambda file_id, mime_type=None, service_account_json=None: _journal_zv_workbook_bytes(
            [
                (1, "1(З-СНН) від 02.01.2026", "Петренко Іван Іванович", "ч", "01.02.1990", "", "м. Львів", ""),
                (2, "1(З-СНН) від 02.01.2026", "Коваль Олена Петрівна", "ж", "03.04.1992", "", "м. Київ", ""),
                (3, "1(З-СНН) від 02.01.2026", "Шевченко Марія Іванівна", "ж", "05.06.1994", "", "м. Одеса", ""),
            ]
        ),
        raising=False,
    )
    create_response = client.post(
        "/api/v1/journal-monitors",
        json={"name": "Журнали 2026", "folder_url": "https://drive.google.com/drive/folders/root-folder"},
        headers=auth_headers,
    )
    section_id = create_response.json()["id"]
    sync_response = client.post(f"/api/v1/journal-monitors/{section_id}/sync", headers=auth_headers)
    entry_id = sync_response.json()["entries"][0]["id"]
    db_session.add(Trainee(branch_id="main", first_name="Іван Іванович", last_name="Петренко", group_code="1-26"))
    entry = db_session.get(journal_monitor.JournalMonitorEntry, entry_id)
    entry.trainees_status = "processed"
    entry.trainees_message = "Додано/оновлено слухачів із журналу: 3"
    entry.trainee_count = 1
    db_session.add(entry)
    db_session.commit()

    tick_response = client.post(
        f"/api/v1/journal-monitors/{section_id}/processing/background-tick?year=2026",
        headers=auth_headers,
    )

    assert tick_response.status_code == 200
    entry_payload = tick_response.json()["entries"][0]
    assert entry_payload["trainees_status"] == "processed"
    assert entry_payload["trainee_count"] == 3


def test_journal_sync_refreshes_folders_without_inline_processing(client, auth_headers, monkeypatch):
    monkeypatch.setattr(
        "app.api.routes.journal_monitors.list_drive_child_folders",
        lambda _folder_id, service_account_json=None: [
            {
                "id": "drive-46-26",
                "name": "46-26 Журнал",
                "url": "https://drive.google.com/drive/folders/drive-46-26",
                "modified_time": "2026-03-02T10:00:00Z",
            },
        ],
    )
    monkeypatch.setattr(
        journal_monitor,
        "process_journal_trainees_for_section",
        lambda *args, **kwargs: (_ for _ in ()).throw(AssertionError("sync must not process trainees inline")),
    )
    monkeypatch.setattr(
        journal_monitor,
        "process_next_journal_workload",
        lambda *args, **kwargs: (_ for _ in ()).throw(AssertionError("sync must not process workload inline")),
    )

    create_response = client.post(
        "/api/v1/journal-monitors",
        json={"name": "Журнали 2026", "folder_url": "https://drive.google.com/drive/folders/root-folder"},
        headers=auth_headers,
    )
    section_id = create_response.json()["id"]

    sync_response = client.post(f"/api/v1/journal-monitors/{section_id}/sync", headers=auth_headers)

    assert sync_response.status_code == 200
    entry = sync_response.json()["entries"][0]
    assert entry["group_code"] == "46-26"
    assert entry["trainees_status"] == "pending"
    assert entry["workload_status"] == "pending"


def test_journal_worker_marks_trainees_no_data_when_zv_sheet_has_no_rows(
    client,
    auth_headers,
    db_session,
    monkeypatch,
):
    drive_folders = lambda _folder_id, service_account_json=None: [
            {
                "id": "drive-47-26",
                "name": "47-26 Журнал",
                "url": "https://drive.google.com/drive/folders/drive-47-26",
                "modified_time": "2026-03-02T10:00:00Z",
            },
        ]
    monkeypatch.setattr("app.api.routes.journal_monitors.list_drive_child_folders", drive_folders)
    monkeypatch.setattr("app.tasks.worker.list_drive_child_folders", drive_folders)
    monkeypatch.setattr(
        journal_monitor,
        "list_drive_journal_workbook_files",
        lambda folder_id, service_account_json=None: [
            {"id": "empty-zv-xlsx", "name": "47-26 Журнал.xlsx", "mimeType": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"}
        ],
        raising=False,
    )
    monkeypatch.setattr(
        journal_monitor,
        "download_drive_file_bytes",
        lambda file_id, mime_type=None, service_account_json=None: _journal_zv_workbook_bytes([]),
        raising=False,
    )

    create_response = client.post(
        "/api/v1/journal-monitors",
        json={"name": "Журнали 2026", "folder_url": "https://drive.google.com/drive/folders/root-folder"},
        headers=auth_headers,
    )
    section_id = create_response.json()["id"]
    section = db_session.get(journal_monitor.JournalMonitorSection, section_id)
    section.workload_auto_enabled = True
    section.workload_auto_year = 2026
    db_session.add(section)
    db_session.commit()

    from app.tasks.worker import process_journal_monitor_auto_task

    process_journal_monitor_auto_task.run()
    detail_response = client.get(f"/api/v1/journal-monitors/{section_id}", headers=auth_headers)

    assert detail_response.status_code == 200
    entry = detail_response.json()["entries"][0]
    assert entry["has_trainees"] is False
    assert entry["trainee_count"] == 0
    assert entry["processing_status"] == "not_processed"
    assert entry["trainees_status"] == "no_data"
    assert entry["trainees_message"] == "На аркуші «ЗВ» не знайдено рядків зі слухачами"


def test_journal_workload_auto_start_processes_one_2026_journal_and_updates_teacher_workload(
    client,
    auth_headers,
    db_session,
    monkeypatch,
):
    existing_teacher = Teacher(
        branch_id="main",
        first_name="Олена Петрівна",
        last_name="Коваль",
        hourly_rate=0,
        is_active=True,
    )
    db_session.add(existing_teacher)
    db_session.commit()

    drive_folders = lambda _folder_id, service_account_json=None: [
            {
                "id": "drive-73-26",
                "name": "73-26 Журнал з кібербезпеки",
                "url": "https://drive.google.com/drive/folders/drive-73-26",
                "modified_time": "2026-02-01T10:00:00Z",
            },
            {
                "id": "drive-74-26",
                "name": "74-26 Журнал з обліку",
                "url": "https://drive.google.com/drive/folders/drive-74-26",
                "modified_time": "2026-02-02T10:00:00Z",
            },
            {
                "id": "drive-10-25",
                "name": "10-25 Архівний журнал",
                "url": "https://drive.google.com/drive/folders/drive-10-25",
                "modified_time": "2025-02-01T10:00:00Z",
            },
        ]
    monkeypatch.setattr("app.api.routes.journal_monitors.list_drive_child_folders", drive_folders)
    monkeypatch.setattr("app.tasks.worker.list_drive_child_folders", drive_folders)
    monkeypatch.setattr(
        journal_monitor,
        "list_drive_journal_workbook_files",
        lambda folder_id, service_account_json=None: [
            {"id": f"{folder_id}-xlsx", "name": f"{folder_id}.xlsx", "mimeType": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"}
        ],
        raising=False,
    )
    monkeypatch.setattr(
        journal_monitor,
        "download_drive_file_bytes",
        lambda file_id, mime_type=None, service_account_json=None: _journal_workbook_bytes(
            [
                ("Основи кібербезпеки", 12, "1-18", "Коваль Олена Петрівна"),
                ("Безпечна робота", 8, "19-25", "Шевченко Марія Іванівна"),
            ]
        ),
        raising=False,
    )

    create_response = client.post(
        "/api/v1/journal-monitors",
        json={"name": "Журнали 2026", "folder_url": "https://drive.google.com/drive/folders/root-folder"},
        headers=auth_headers,
    )
    section_id = create_response.json()["id"]

    sync_response = client.post(f"/api/v1/journal-monitors/{section_id}/workload-auto/start?year=2026", headers=auth_headers)

    assert sync_response.status_code == 200
    assert sync_response.json()["workload_auto_enabled"] is True
    assert sync_response.json()["workload_auto_year"] == 2026
    entries = {item["drive_file_id"]: item for item in sync_response.json()["entries"]}
    assert entries["drive-73-26"]["workload_status"] == "processed"
    assert entries["drive-73-26"]["workload_hours"] == 20
    assert entries["drive-74-26"]["workload_status"] == "pending"
    assert entries["drive-10-25"]["workload_status"] == "skipped_year"

    summary = {row["teacher_name"]: row for row in collect_teacher_workload_summary(db_session, "main")}
    assert summary["Коваль Олена Петрівна"]["total_hours"] == 12
    assert summary["Шевченко Марія Іванівна"]["total_hours"] == 8

    from app.tasks.worker import process_journal_monitor_auto_task

    process_journal_monitor_auto_task.run()
    second_response = client.get(f"/api/v1/journal-monitors/{section_id}", headers=auth_headers)
    second_entries = {item["drive_file_id"]: item for item in second_response.json()["entries"]}
    assert second_entries["drive-74-26"]["workload_status"] == "processed"

    refreshed_summary = {row["teacher_name"]: row for row in collect_teacher_workload_summary(db_session, "main")}
    assert refreshed_summary["Коваль Олена Петрівна"]["total_hours"] == 24
    assert refreshed_summary["Шевченко Марія Іванівна"]["total_hours"] == 16


def test_journal_processing_start_is_fast_and_tick_processes_trainees(
    client,
    auth_headers,
    db_session,
    monkeypatch,
):
    monkeypatch.setattr(
        "app.api.routes.journal_monitors.list_drive_child_folders",
        lambda *args, **kwargs: (_ for _ in ()).throw(AssertionError("processing/start must use existing journal entries")),
    )
    monkeypatch.setattr(
        journal_monitor,
        "list_drive_journal_workbook_files",
        lambda folder_id, service_account_json=None: [
            {"id": f"{folder_id}-xlsx", "name": "46-26 Журнал.xlsx", "mimeType": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"}
        ],
        raising=False,
    )
    monkeypatch.setattr(
        journal_monitor,
        "download_drive_file_bytes",
        lambda file_id, mime_type=None, service_account_json=None: _journal_zv_workbook_bytes(
            [(1, "З-СНН-001", "Петренко Іван Іванович", "ч", "01.02.1990", "1234567890", "м. Львів", "+380501112233")]
        ),
        raising=False,
    )
    monkeypatch.setattr(
        "app.tasks.worker.process_journal_monitor_auto_task.delay",
        lambda: (_ for _ in ()).throw(AssertionError("processing/start must not call Celery in the web request")),
    )

    create_response = client.post(
        "/api/v1/journal-monitors",
        json={"name": "Журнали 2026", "folder_url": "https://drive.google.com/drive/folders/root-folder"},
        headers=auth_headers,
    )
    section_id = create_response.json()["id"]
    db_session.add(
        journal_monitor.JournalMonitorEntry(
            section_id=section_id,
            branch_id="main",
            drive_file_id="drive-46-26",
            drive_url="https://drive.google.com/drive/folders/drive-46-26",
            journal_name="46-26 Журнал",
            group_code="46-26",
            workload_status="processed",
            workload_year=2026,
            workload_hours=8,
        )
    )
    db_session.commit()

    response = client.post(f"/api/v1/journal-monitors/{section_id}/processing/start?year=2026", headers=auth_headers)

    assert response.status_code == 200
    assert response.json()["workload_auto_enabled"] is True
    assert response.json()["workload_auto_year"] == 2026
    entry = response.json()["entries"][0]
    assert entry["workload_status"] == "processed"
    assert entry["trainees_status"] == "pending"

    tick_response = client.post(f"/api/v1/journal-monitors/{section_id}/processing/tick", headers=auth_headers)

    assert tick_response.status_code == 200
    assert tick_response.json()["workload_auto_enabled"] is False
    tick_entry = tick_response.json()["entries"][0]
    assert tick_entry["trainees_status"] == "processed"
    assert tick_entry["trainee_count"] == 1
    assert "опрацювання завершено" in tick_response.json()["last_sync_message"]


def test_journal_processing_tick_processes_pending_workload_before_trainees(
    client,
    auth_headers,
    db_session,
    monkeypatch,
):
    monkeypatch.setattr(
        "app.api.routes.journal_monitors.list_drive_child_folders",
        lambda *args, **kwargs: (_ for _ in ()).throw(AssertionError("processing/start must use existing journal entries")),
    )
    monkeypatch.setattr(
        journal_monitor,
        "list_drive_journal_workbook_files",
        lambda folder_id, service_account_json=None: [
            {"id": f"{folder_id}-xlsx", "name": "46-26 Журнал.xlsx", "mimeType": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"}
        ],
        raising=False,
    )
    monkeypatch.setattr(
        journal_monitor,
        "download_drive_file_bytes",
        lambda file_id, mime_type=None, service_account_json=None: _journal_combined_workbook_bytes(),
        raising=False,
    )

    create_response = client.post(
        "/api/v1/journal-monitors",
        json={"name": "Журнали 2026", "folder_url": "https://drive.google.com/drive/folders/root-folder"},
        headers=auth_headers,
    )
    section_id = create_response.json()["id"]
    db_session.add(
        journal_monitor.JournalMonitorEntry(
            section_id=section_id,
            branch_id="main",
            drive_file_id="drive-46-26",
            drive_url="https://drive.google.com/drive/folders/drive-46-26",
            journal_name="46-26 Журнал",
            group_code="46-26",
            workload_status="pending",
            trainees_status="pending",
        )
    )
    db_session.commit()

    response = client.post(f"/api/v1/journal-monitors/{section_id}/processing/start?year=2026", headers=auth_headers)
    assert response.status_code == 200

    tick_response = client.post(f"/api/v1/journal-monitors/{section_id}/processing/tick", headers=auth_headers)

    assert tick_response.status_code == 200
    tick_entry = tick_response.json()["entries"][0]
    assert tick_entry["workload_status"] == "processed"
    assert tick_entry["workload_hours"] == 8
    assert tick_entry["trainees_status"] == "processed"
    assert tick_entry["trainee_count"] == 1
    assert tick_response.json()["workload_auto_enabled"] is False
    summary = {row["teacher_name"]: row for row in collect_teacher_workload_summary(db_session, "main")}
    assert summary["Коваль Олена Петрівна"]["total_hours"] == 8


def test_journal_auto_worker_processes_trainees_and_workload_together(db_session, monkeypatch):
    monkeypatch.setattr(
        "app.tasks.worker.list_drive_child_folders",
        lambda _folder_id, service_account_json=None: [
            {
                "id": "drive-46-26",
                "name": "46-26 Журнал",
                "url": "https://drive.google.com/drive/folders/drive-46-26",
                "modified_time": "2026-03-02T10:00:00Z",
            },
        ],
    )
    monkeypatch.setattr(
        journal_monitor,
        "list_drive_journal_workbook_files",
        lambda folder_id, service_account_json=None: [
            {"id": f"{folder_id}-xlsx", "name": "46-26 Журнал.xlsx", "mimeType": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"}
        ],
        raising=False,
    )
    monkeypatch.setattr(
        journal_monitor,
        "download_drive_file_bytes",
        lambda file_id, mime_type=None, service_account_json=None: _journal_combined_workbook_bytes(),
        raising=False,
    )
    section = journal_monitor.JournalMonitorSection(
        branch_id="main",
        name="Журнали 2026",
        folder_url="https://drive.google.com/drive/folders/root-folder",
        folder_id="root-folder",
        workload_auto_enabled=True,
        workload_auto_year=2026,
    )
    db_session.add(section)
    db_session.commit()

    from app.tasks.worker import process_journal_monitor_auto_task

    result = process_journal_monitor_auto_task.run()

    assert result == {"processed_sections": 1, "failed_sections": 0}
    entry = section.entries[0]
    assert entry.trainees_status == "processed"
    assert entry.trainee_count == 1
    assert entry.workload_status == "processed"
    assert entry.workload_hours == 8
    summary = {row["teacher_name"]: row for row in collect_teacher_workload_summary(db_session, "main")}
    assert summary["Коваль Олена Петрівна"]["total_hours"] == 8


def test_journal_auto_worker_processes_active_sections_without_manual_auto_toggle(db_session, monkeypatch):
    monkeypatch.setattr(
        "app.tasks.worker.list_drive_child_folders",
        lambda _folder_id, service_account_json=None: [
            {
                "id": "drive-1-26",
                "name": "1-26 Журнал",
                "url": "https://drive.google.com/drive/folders/drive-1-26",
                "modified_time": "2026-03-02T10:00:00Z",
            },
        ],
    )
    monkeypatch.setattr(
        journal_monitor,
        "list_drive_journal_workbook_files",
        lambda folder_id, service_account_json=None: [
            {"id": f"{folder_id}-xlsx", "name": "1-26 Журнал.xlsx", "mimeType": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"}
        ],
        raising=False,
    )
    monkeypatch.setattr(
        journal_monitor,
        "download_drive_file_bytes",
        lambda file_id, mime_type=None, service_account_json=None: _journal_combined_workbook_bytes(),
        raising=False,
    )
    section = journal_monitor.JournalMonitorSection(
        branch_id="main",
        name="Журнали 2026",
        folder_url="https://drive.google.com/drive/folders/root-folder",
        folder_id="root-folder",
        workload_auto_enabled=False,
        workload_auto_year=2026,
    )
    db_session.add(section)
    db_session.commit()

    from app.tasks.worker import process_journal_monitor_auto_task

    result = process_journal_monitor_auto_task.run()

    assert result == {"processed_sections": 1, "failed_sections": 0}
    entry = section.entries[0]
    assert entry.group_code == "1-26"
    assert entry.workload_status == "processed"
    assert entry.trainees_status == "processed"
    assert entry.trainee_count == 1


def test_journal_auto_worker_continues_with_one_pending_trainees_after_workloads_processed(db_session, monkeypatch):
    drive_folders = lambda _folder_id, service_account_json=None: [
        {
            "id": "drive-51-26",
            "name": "51-26 Журнал",
            "url": "https://drive.google.com/drive/folders/drive-51-26",
            "modified_time": "2026-03-02T10:00:00Z",
        },
        {
            "id": "drive-52-26",
            "name": "52-26 Журнал",
            "url": "https://drive.google.com/drive/folders/drive-52-26",
            "modified_time": "2026-03-03T10:00:00Z",
        },
    ]
    monkeypatch.setattr("app.tasks.worker.list_drive_child_folders", drive_folders)
    monkeypatch.setattr(
        journal_monitor,
        "list_drive_journal_workbook_files",
        lambda folder_id, service_account_json=None: [
            {"id": f"{folder_id}-xlsx", "name": f"{folder_id}.xlsx", "mimeType": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"}
        ],
        raising=False,
    )
    downloaded: list[str] = []

    def fake_download(file_id, mime_type=None, service_account_json=None):
        downloaded.append(file_id)
        return _journal_zv_workbook_bytes(
            [(1, "З-СНН-001", f"Петренко Іван {file_id}", "ч", "01.02.1990", "", "", "")]
        )

    monkeypatch.setattr(journal_monitor, "download_drive_file_bytes", fake_download, raising=False)
    section = journal_monitor.JournalMonitorSection(
        branch_id="main",
        name="Журнали 2026",
        folder_url="https://drive.google.com/drive/folders/root-folder",
        folder_id="root-folder",
        workload_auto_enabled=True,
        workload_auto_year=2026,
    )
    db_session.add(section)
    db_session.flush()
    for code, drive_id in (("51-26", "drive-51-26"), ("52-26", "drive-52-26")):
        db_session.add(
            journal_monitor.JournalMonitorEntry(
                section_id=section.id,
                branch_id="main",
                drive_file_id=drive_id,
                drive_url=f"https://drive.google.com/drive/folders/{drive_id}",
                journal_name=f"{code} Журнал",
                group_code=code,
                workload_status="processed",
                workload_year=2026,
                workload_hours=8,
                trainees_status="pending",
            )
        )
    db_session.commit()

    from app.tasks.worker import process_journal_monitor_auto_task

    result = process_journal_monitor_auto_task.run()

    assert result == {"processed_sections": 1, "failed_sections": 0}
    entries = {entry.group_code: entry for entry in section.entries}
    assert entries["51-26"].trainees_status == "processed"
    assert entries["52-26"].trainees_status == "pending"
    assert downloaded == ["drive-51-26-xlsx"]
    assert db_session.query(Trainee).filter(Trainee.group_code == "51-26").count() == 1


def test_start_requeue_keeps_already_imported_trainees_out_of_front_of_queue(db_session):
    section = journal_monitor.JournalMonitorSection(
        branch_id="main",
        name="Журнали 2026",
        folder_url="https://drive.google.com/drive/folders/root-folder",
        folder_id="root-folder",
        workload_auto_enabled=True,
        workload_auto_year=2026,
    )
    db_session.add(section)
    db_session.flush()
    imported = journal_monitor.JournalMonitorEntry(
        section_id=section.id,
        branch_id="main",
        drive_file_id="drive-1-26",
        journal_name="1-26 Журнал",
        group_code="1-26",
        has_trainees=True,
        trainee_count=33,
        trainees_status="processed",
    )
    pending = journal_monitor.JournalMonitorEntry(
        section_id=section.id,
        branch_id="main",
        drive_file_id="drive-2-26",
        journal_name="2-26 Журнал",
        group_code="2-26",
        has_trainees=False,
        trainee_count=0,
        trainees_status="no_data",
    )
    db_session.add_all([imported, pending])
    db_session.commit()

    changed = journal_monitor.requeue_journal_trainees_for_year(db_session, section, 2026)

    assert changed == 1
    assert imported.trainees_status == "processed"
    assert pending.trainees_status == "pending"


def test_journal_step_message_does_not_grow_past_database_limit(db_session):
    section = journal_monitor.JournalMonitorSection(
        branch_id="main",
        name="Журнали 2026",
        folder_url="https://drive.google.com/drive/folders/root-folder",
        folder_id="root-folder",
        workload_auto_enabled=True,
        workload_auto_year=2026,
        last_sync_message="x" * 500,
    )
    db_session.add(section)
    db_session.commit()

    journal_monitor.process_journal_monitor_section_step(db_session, section)
    db_session.commit()

    assert section.last_sync_message is not None
    assert len(section.last_sync_message) <= 500


def test_journal_workload_can_be_run_for_2025_on_demand(client, auth_headers, monkeypatch):
    monkeypatch.setattr(
        "app.api.routes.journal_monitors.list_drive_child_folders",
        lambda _folder_id, service_account_json=None: [
            {
                "id": "drive-10-25",
                "name": "10-25 Архівний журнал",
                "url": "https://drive.google.com/drive/folders/drive-10-25",
                "modified_time": "2025-02-01T10:00:00Z",
            },
        ],
    )
    monkeypatch.setattr(
        journal_monitor,
        "list_drive_journal_workbook_files",
        lambda folder_id, service_account_json=None: [
            {"id": f"{folder_id}-xlsx", "name": f"{folder_id}.xlsx", "mimeType": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"}
        ],
        raising=False,
    )
    monkeypatch.setattr(
        journal_monitor,
        "download_drive_file_bytes",
        lambda file_id, mime_type=None, service_account_json=None: _journal_workbook_bytes(
            [("Архівна дисципліна", 6, "1-6", "Петренко Ігор Степанович")]
        ),
        raising=False,
    )

    create_response = client.post(
        "/api/v1/journal-monitors",
        json={"name": "Журнали 2025", "folder_url": "https://drive.google.com/drive/folders/root-folder"},
        headers=auth_headers,
    )
    section_id = create_response.json()["id"]
    sync_response = client.post(f"/api/v1/journal-monitors/{section_id}/sync", headers=auth_headers)
    assert sync_response.json()["entries"][0]["workload_status"] == "pending"

    process_response = client.post(
        f"/api/v1/journal-monitors/{section_id}/workload-auto/start?year=2025",
        headers=auth_headers,
    )

    assert process_response.status_code == 200
    entry = process_response.json()["entries"][0]
    assert entry["workload_status"] == "processed"
    assert entry["workload_year"] == 2025
    assert entry["workload_hours"] == 6


def test_journal_workload_parses_two_workbooks_lowercase_sheet_and_splits_multiple_teachers(
    client,
    auth_headers,
    db_session,
    monkeypatch,
):
    db_session.add(
        Teacher(
            branch_id="main",
            first_name="Віктор Євгенович",
            last_name="Брикін",
            hourly_rate=0,
            is_active=True,
        )
    )
    db_session.commit()

    monkeypatch.setattr(
        "app.api.routes.journal_monitors.list_drive_child_folders",
        lambda _folder_id, service_account_json=None: [
            {
                "id": "drive-80-26",
                "name": "80-26 Журнал теорії і виробничого навчання",
                "url": "https://drive.google.com/drive/folders/drive-80-26",
                "modified_time": "2026-03-01T10:00:00Z",
            },
        ],
    )
    monkeypatch.setattr(
        journal_monitor,
        "list_drive_journal_workbook_files",
        lambda folder_id, service_account_json=None: [
            {"id": "theory-xlsx", "name": "Теорія.xlsx", "mimeType": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"},
            {"id": "practice-xlsx", "name": "Виробниче навчання.xlsx", "mimeType": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"},
        ],
        raising=False,
    )

    def fake_download(file_id, mime_type=None, service_account_json=None):
        if file_id == "theory-xlsx":
            return _journal_workbook_bytes(
                [("Матеріалознавство", 5, "1-5", "Брикін Віктор Євгенович, Старожук Людмила Василівна")],
                sheet_name="дисципліни",
                discipline_sheet_index=3,
            )
        return _journal_workbook_bytes(
            [("Практика", 4, "6-9", "БрикінВіктор Євгенович")],
            sheet_name="ДИСЦИПЛІНИ",
            discipline_sheet_index=4,
        )

    monkeypatch.setattr(journal_monitor, "download_drive_file_bytes", fake_download, raising=False)

    create_response = client.post(
        "/api/v1/journal-monitors",
        json={"name": "Журнали 2026", "folder_url": "https://drive.google.com/drive/folders/root-folder"},
        headers=auth_headers,
    )
    section_id = create_response.json()["id"]
    response = client.post(f"/api/v1/journal-monitors/{section_id}/workload-auto/start?year=2026", headers=auth_headers)

    assert response.status_code == 200
    entry = response.json()["entries"][0]
    assert entry["workload_status"] == "processed"
    assert entry["workload_source_names"] == ["Теорія", "Виробниче навчання"]
    summary = {row["teacher_name"]: row for row in collect_teacher_workload_summary(db_session, "main")}
    assert summary["Брикін Віктор Євгенович"]["total_hours"] == 9
    assert summary["Старожук Людмила Василівна"]["total_hours"] == 5
    assert "Брикін Віктор Євгенович, Старожук Людмила Василівна" not in summary


def test_auto_sync_retries_failed_journal_after_access_is_fixed(client, auth_headers, db_session, monkeypatch):
    drive_folders = lambda _folder_id, service_account_json=None: [
            {
                "id": "drive-82-26",
                "name": "82-26 Журнал з тимчасово закритим доступом",
                "url": "https://drive.google.com/drive/folders/drive-82-26",
                "modified_time": "2026-03-03T10:00:00Z",
            },
        ]
    monkeypatch.setattr("app.api.routes.journal_monitors.list_drive_child_folders", drive_folders)
    monkeypatch.setattr("app.tasks.worker.list_drive_child_folders", drive_folders)
    monkeypatch.setattr(
        journal_monitor,
        "list_drive_journal_workbook_files",
        lambda folder_id, service_account_json=None: [
            {"id": "restricted-xlsx", "name": "82-26 Трактористи виробн.xlsx", "mimeType": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"}
        ],
        raising=False,
    )
    access_fixed = {"value": False}

    def fake_download(file_id, mime_type=None, service_account_json=None):
        if not access_fixed["value"]:
            raise PermissionError("Немає доступу до файлу")
        return _journal_workbook_bytes([("Доступ відновлено", 7, "1-7", "Доступний Викладач")])

    monkeypatch.setattr(journal_monitor, "download_drive_file_bytes", fake_download, raising=False)

    create_response = client.post(
        "/api/v1/journal-monitors",
        json={"name": "Журнали 2026", "folder_url": "https://drive.google.com/drive/folders/root-folder"},
        headers=auth_headers,
    )
    section_id = create_response.json()["id"]
    first_response = client.post(f"/api/v1/journal-monitors/{section_id}/workload-auto/start?year=2026", headers=auth_headers)
    assert first_response.json()["entries"][0]["workload_status"] == "failed"
    assert first_response.json()["entries"][0]["workload_source_names"] == ["82-26 Трактористи виробн"]

    access_fixed["value"] = True
    from app.tasks.worker import process_journal_monitor_auto_task

    process_journal_monitor_auto_task.run()
    retry_response = client.get(f"/api/v1/journal-monitors/{section_id}", headers=auth_headers)

    entry = retry_response.json()["entries"][0]
    assert entry["workload_status"] == "processed"
    assert entry["workload_hours"] == 7


def test_deleting_teacher_marks_related_journal_for_regeneration(client, auth_headers, db_session, monkeypatch):
    monkeypatch.setattr(
        "app.api.routes.journal_monitors.list_drive_child_folders",
        lambda _folder_id, service_account_json=None: [
            {
                "id": "drive-81-26",
                "name": "81-26 Журнал",
                "url": "https://drive.google.com/drive/folders/drive-81-26",
                "modified_time": "2026-03-02T10:00:00Z",
            },
        ],
    )
    monkeypatch.setattr(
        journal_monitor,
        "list_drive_journal_workbook_files",
        lambda folder_id, service_account_json=None: [
            {"id": "journal-xlsx", "name": "Журнал.xlsx", "mimeType": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"}
        ],
        raising=False,
    )
    monkeypatch.setattr(
        journal_monitor,
        "download_drive_file_bytes",
        lambda file_id, mime_type=None, service_account_json=None: _journal_workbook_bytes(
            [("Дисципліна", 3, "1-3", "Тимчасовий Викладач")]
        ),
        raising=False,
    )

    create_response = client.post(
        "/api/v1/journal-monitors",
        json={"name": "Журнали 2026", "folder_url": "https://drive.google.com/drive/folders/root-folder"},
        headers=auth_headers,
    )
    section_id = create_response.json()["id"]
    client.post(f"/api/v1/journal-monitors/{section_id}/workload-auto/start?year=2026", headers=auth_headers)
    teacher_id = db_session.query(Teacher).filter(Teacher.last_name == "Тимчасовий").one().id

    delete_response = client.delete(f"/api/v1/teachers/{teacher_id}", headers=auth_headers)

    assert delete_response.status_code == 204
    detail_response = client.get(f"/api/v1/journal-monitors/{section_id}", headers=auth_headers)
    entry = detail_response.json()["entries"][0]
    assert entry["workload_status"] == "needs_regeneration"
    assert entry["workload_hours"] == 0
    assert db_session.query(JournalWorkloadEntry).count() == 0


def test_journal_monitor_sync_compares_drive_folders_with_project_data(client, auth_headers, db_session, monkeypatch):
    complete_group = Group(branch_id="main", code="180-25", name="Штучний інтелект", status=GroupStatus.ACTIVE)
    schedule_group = Group(branch_id="main", code="167-25", name="Трудові відносини", status=GroupStatus.ACTIVE)
    db_session.add_all([complete_group, schedule_group])
    db_session.flush()
    _seed_schedule(db_session, complete_group, "180")
    _seed_schedule(db_session, schedule_group, "167")
    db_session.add(Trainee(branch_id="main", first_name="Іван", last_name="Повний", status="active", group_code="180-25"))
    db_session.add(Trainee(branch_id="main", first_name="Олена", last_name="ТількиСлухачі", status="active", group_code="162-25"))
    db_session.commit()

    def fake_drive_folders(_folder_id: str, service_account_json: str | None = None):
        return [
            {
                "id": "drive-180",
                "name": "180-25 Штучний інтелект: розвиток кар'єри",
                "url": "https://drive.google.com/drive/folders/drive-180",
                "modified_time": "2026-05-01T10:00:00Z",
            },
            {
                "id": "drive-167",
                "name": "167-25 Організація трудових відносин",
                "url": "https://drive.google.com/drive/folders/drive-167",
                "modified_time": "2026-05-01T11:00:00Z",
            },
            {
                "id": "drive-162",
                "name": "162-25 Штучний інтелект",
                "url": "https://drive.google.com/drive/folders/drive-162",
                "modified_time": "2026-05-01T12:00:00Z",
            },
            {
                "id": "drive-999",
                "name": "999-25 Немає в системі",
                "url": "https://drive.google.com/drive/folders/drive-999",
                "modified_time": "2026-05-01T13:00:00Z",
            },
        ]

    monkeypatch.setattr("app.api.routes.journal_monitors.list_drive_child_folders", fake_drive_folders)

    create_response = client.post(
        "/api/v1/journal-monitors",
        json={"name": "Журнали 2026", "folder_url": "https://drive.google.com/drive/folders/root-folder"},
        headers=auth_headers,
    )
    assert create_response.status_code == 201
    section_id = create_response.json()["id"]

    sync_response = client.post(f"/api/v1/journal-monitors/{section_id}/sync", headers=auth_headers)
    assert sync_response.status_code == 200
    assert sync_response.json()["stats"]["total"] == 4
    assert sync_response.json()["stats"]["complete"] == 1
    assert sync_response.json()["stats"]["schedule_only"] == 1
    assert sync_response.json()["stats"]["trainees_only"] == 1
    assert sync_response.json()["stats"]["not_processed"] == 1
    assert sync_response.json()["stats"]["workload_and_trainees"] == 0
    assert sync_response.json()["stats"]["workload_trainees_schedule"] == 0

    for entry in db_session.query(journal_monitor.JournalMonitorEntry).filter(
        journal_monitor.JournalMonitorEntry.section_id == section_id,
        journal_monitor.JournalMonitorEntry.group_code.in_(["180-25", "162-25"]),
    ):
        entry.workload_status = "processed"
        entry.workload_hours = 30
        db_session.add(entry)
    db_session.commit()

    detail_response = client.get(f"/api/v1/journal-monitors/{section_id}", headers=auth_headers)
    assert detail_response.status_code == 200
    assert detail_response.json()["stats"]["workload_and_trainees"] == 2
    assert detail_response.json()["stats"]["workload_trainees_schedule"] == 1
    entries = {item["group_code"]: item for item in detail_response.json()["entries"]}
    assert entries["180-25"]["has_schedule"] is True
    assert entries["180-25"]["has_trainees"] is True
    assert entries["180-25"]["processing_status"] == "complete"
    assert entries["167-25"]["processing_status"] == "schedule_only"
    assert entries["162-25"]["processing_status"] == "trainees_only"
    assert entries["999-25"]["processing_status"] == "not_processed"


def test_journal_monitor_exports_csv(client, auth_headers, db_session, monkeypatch):
    monkeypatch.setattr(
        "app.api.routes.journal_monitors.list_drive_child_folders",
        lambda _folder_id, service_account_json=None: [
            {
                "id": "drive-180",
                "name": "180-25 Журнал",
                "url": "https://drive.google.com/drive/folders/drive-180",
                "modified_time": None,
            }
        ],
    )

    create_response = client.post(
        "/api/v1/journal-monitors",
        json={"name": "Журнали 2026", "folder_url": "https://drive.google.com/drive/folders/root-folder"},
        headers=auth_headers,
    )
    section_id = create_response.json()["id"]
    client.post(f"/api/v1/journal-monitors/{section_id}/sync", headers=auth_headers)

    export_response = client.get(f"/api/v1/journal-monitors/{section_id}/export?format=csv", headers=auth_headers)
    assert export_response.status_code == 200
    assert export_response.headers["content-type"].startswith("text/csv")
    assert "Номер групи" in export_response.text
    assert "180-25" in export_response.text


def test_journal_monitor_export_respects_filters(client, auth_headers, db_session, monkeypatch):
    complete_group = Group(branch_id="main", code="180-25", name="Штучний інтелект", status=GroupStatus.ACTIVE)
    schedule_group = Group(branch_id="main", code="167-25", name="Трудові відносини", status=GroupStatus.ACTIVE)
    db_session.add_all([complete_group, schedule_group])
    db_session.flush()
    _seed_schedule(db_session, complete_group, "180-filter")
    _seed_schedule(db_session, schedule_group, "167-filter")
    db_session.add(Trainee(branch_id="main", first_name="Іван", last_name="Повний", status="active", group_code="180-25"))
    db_session.add(Trainee(branch_id="main", first_name="Олена", last_name="Слухачі", status="active", group_code="162-25"))
    db_session.commit()

    monkeypatch.setattr(
        "app.api.routes.journal_monitors.list_drive_child_folders",
        lambda _folder_id, service_account_json=None: [
            {
                "id": "drive-180",
                "name": "180-25 Штучний інтелект",
                "url": "https://drive.google.com/drive/folders/drive-180",
                "modified_time": None,
            },
            {
                "id": "drive-167",
                "name": "167-25 Організація трудових відносин",
                "url": "https://drive.google.com/drive/folders/drive-167",
                "modified_time": None,
            },
            {
                "id": "drive-162",
                "name": "162-25 Штучний інтелект",
                "url": "https://drive.google.com/drive/folders/drive-162",
                "modified_time": None,
            },
            {
                "id": "drive-999",
                "name": "999-25 Не опрацьовано",
                "url": "https://drive.google.com/drive/folders/drive-999",
                "modified_time": None,
            },
        ],
    )

    create_response = client.post(
        "/api/v1/journal-monitors",
        json={"name": "Журнали 2026", "folder_url": "https://drive.google.com/drive/folders/root-folder"},
        headers=auth_headers,
    )
    section_id = create_response.json()["id"]
    client.post(f"/api/v1/journal-monitors/{section_id}/sync", headers=auth_headers)

    export_response = client.get(
        f"/api/v1/journal-monitors/{section_id}/export?format=csv&status=schedule_only&has_schedule=true&has_trainees=false&q=відносин",
        headers=auth_headers,
    )

    assert export_response.status_code == 200
    assert "167-25" in export_response.text
    assert "180-25" not in export_response.text
    assert "162-25" not in export_response.text
    assert "999-25" not in export_response.text


def test_journal_monitor_export_filters_by_workload_presence(client, auth_headers, db_session, monkeypatch):
    scheduled_group = Group(branch_id="main", code="167-25", name="Трудові відносини", status=GroupStatus.ACTIVE)
    db_session.add(scheduled_group)
    db_session.flush()
    _seed_schedule(db_session, scheduled_group, "167-workload-filter")
    db_session.add(Trainee(branch_id="main", first_name="Олена", last_name="Слухачі", status="active", group_code="162-25"))
    db_session.commit()

    monkeypatch.setattr(
        "app.api.routes.journal_monitors.list_drive_child_folders",
        lambda _folder_id, service_account_json=None: [
            {
                "id": "drive-167",
                "name": "167-25 Є розклад і педнавантаження",
                "url": "https://drive.google.com/drive/folders/drive-167",
                "modified_time": None,
            },
            {
                "id": "drive-162",
                "name": "162-25 Немає педнавантаження",
                "url": "https://drive.google.com/drive/folders/drive-162",
                "modified_time": None,
            },
            {
                "id": "drive-999",
                "name": "999-25 Тільки педнавантаження",
                "url": "https://drive.google.com/drive/folders/drive-999",
                "modified_time": None,
            },
        ],
    )

    create_response = client.post(
        "/api/v1/journal-monitors",
        json={"name": "Журнали 2026", "folder_url": "https://drive.google.com/drive/folders/root-folder"},
        headers=auth_headers,
    )
    section_id = create_response.json()["id"]
    client.post(f"/api/v1/journal-monitors/{section_id}/sync", headers=auth_headers)

    for entry in db_session.query(journal_monitor.JournalMonitorEntry).filter(
        journal_monitor.JournalMonitorEntry.section_id == section_id,
        journal_monitor.JournalMonitorEntry.group_code.in_(["167-25", "999-25"]),
    ):
        entry.workload_status = "processed"
        entry.workload_hours = 10
        db_session.add(entry)
    db_session.commit()

    workload_only_response = client.get(
        f"/api/v1/journal-monitors/{section_id}/export?format=csv&workload=workload_only",
        headers=auth_headers,
    )
    without_workload_response = client.get(
        f"/api/v1/journal-monitors/{section_id}/export?format=csv&workload=without_workload",
        headers=auth_headers,
    )

    assert workload_only_response.status_code == 200
    assert "999-25" in workload_only_response.text
    assert "167-25" not in workload_only_response.text
    assert "162-25" not in workload_only_response.text
    assert without_workload_response.status_code == 200
    assert "162-25" in without_workload_response.text
    assert "167-25" not in without_workload_response.text
    assert "999-25" not in without_workload_response.text


def test_drive_folder_listing_uses_service_account_bearer_token(monkeypatch):
    monkeypatch.setattr(journal_monitor.settings, "google_drive_api_key", "")
    monkeypatch.setattr(
        journal_monitor.settings,
        "google_drive_service_account_json",
        '{"client_email":"drive-reader@example.iam.gserviceaccount.com","private_key":"-----BEGIN PRIVATE KEY-----\\nKEY\\n-----END PRIVATE KEY-----\\n","token_uri":"https://oauth2.googleapis.com/token"}',
    )
    monkeypatch.setattr(journal_monitor, "_get_service_account_access_token", lambda _raw_json=None: "service-token")

    captured: dict[str, object] = {}

    class FakeResponse:
        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return False

        def read(self):
            return (
                b'{"files":[{"id":"folder-1","name":"180-25 Journal","webViewLink":"https://drive/folder-1",'
                b'"modifiedTime":"2026-05-01T10:00:00Z"}]}'
            )

    def fake_urlopen(request, timeout):
        captured["url"] = request.full_url
        captured["authorization"] = request.headers.get("Authorization")
        captured["timeout"] = timeout
        return FakeResponse()

    monkeypatch.setattr(journal_monitor, "urlopen", fake_urlopen)

    folders = journal_monitor.list_drive_child_folders("root-folder")

    assert folders[0]["id"] == "folder-1"
    assert "key=" not in str(captured["url"])
    assert captured["authorization"] == "Bearer service-token"


def test_journal_monitor_sync_without_credentials_explains_service_account_setup(client, auth_headers, monkeypatch):
    monkeypatch.setattr(journal_monitor.settings, "google_drive_api_key", "")
    monkeypatch.setattr(journal_monitor.settings, "google_drive_service_account_json", "")

    create_response = client.post(
        "/api/v1/journal-monitors",
        json={"name": "Журнали без ключа", "folder_url": "https://drive.google.com/drive/folders/root-folder"},
        headers=auth_headers,
    )
    assert create_response.status_code == 201

    sync_response = client.post(
        f"/api/v1/journal-monitors/{create_response.json()['id']}/sync",
        headers=auth_headers,
    )

    assert sync_response.status_code == 502
    detail = sync_response.json()["detail"]
    assert "GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON" in detail
    assert "suptc-drive-journal-monitor" in detail


def test_journal_monitor_can_store_section_service_account_json(client, auth_headers, monkeypatch):
    monkeypatch.setattr(journal_monitor.settings, "google_drive_api_key", "")
    monkeypatch.setattr(journal_monitor.settings, "google_drive_service_account_json", "")

    create_response = client.post(
        "/api/v1/journal-monitors",
        json={"name": "Журнали з ключем", "folder_url": "https://drive.google.com/drive/folders/root-folder"},
        headers=auth_headers,
    )
    assert create_response.status_code == 201
    section_id = create_response.json()["id"]

    patch_response = client.patch(
        f"/api/v1/journal-monitors/{section_id}",
        json={
            "service_account_json": '{"client_email":"drive-reader@example.iam.gserviceaccount.com","private_key":"key"}'
        },
        headers=auth_headers,
    )
    assert patch_response.status_code == 200
    assert patch_response.json()["has_service_account_credentials"] is True
    assert "service_account_json" not in patch_response.json()

    captured: dict[str, object] = {}

    def fake_lister(folder_id: str, service_account_json: str | None = None):
        captured["folder_id"] = folder_id
        captured["service_account_json"] = service_account_json
        return []

    monkeypatch.setattr("app.api.routes.journal_monitors.list_drive_child_folders", fake_lister)

    sync_response = client.post(f"/api/v1/journal-monitors/{section_id}/sync", headers=auth_headers)
    assert sync_response.status_code == 200
    assert captured["folder_id"] == "root-folder"
    assert "drive-reader@example.iam.gserviceaccount.com" in str(captured["service_account_json"])


def test_journal_sync_creates_groups_from_drive_folders(client, auth_headers, db_session, monkeypatch):
    monkeypatch.setattr(
        "app.api.routes.journal_monitors.list_drive_child_folders",
        lambda _folder_id, service_account_json=None: [
            {
                "id": "drive-1-26",
                "name": "1-26 Організація трудових відносин в умовах воєнного стану",
                "url": "https://drive.google.com/drive/folders/drive-1-26",
                "modified_time": "2026-05-01T10:00:00Z",
            }
        ],
    )
    create_response = client.post(
        "/api/v1/journal-monitors",
        json={"name": "Журнали 2026", "folder_url": "https://drive.google.com/drive/folders/root-folder"},
        headers=auth_headers,
    )
    section_id = create_response.json()["id"]

    sync_response = client.post(f"/api/v1/journal-monitors/{section_id}/sync", headers=auth_headers)

    assert sync_response.status_code == 200
    entry = sync_response.json()["entries"][0]
    assert entry["group_code"] == "1-26"
    assert entry["has_group"] is True
    group = db_session.query(Group).filter(Group.code == "1-26").one()
    assert group.name == "Організація трудових відносин в умовах воєнного стану"
    groups_response = client.get("/api/v1/groups", headers=auth_headers)
    groups_payload = {item["code"]: item for item in groups_response.json()}
    assert groups_payload["1-26"]["year"] == 2026


def test_delete_journal_entry_and_background_tick_reimports_it(client, auth_headers, monkeypatch):
    monkeypatch.setattr(
        "app.api.routes.journal_monitors.list_drive_child_folders",
        lambda _folder_id, service_account_json=None: [
            {
                "id": "drive-46-26",
                "name": "46-26 Журнал",
                "url": "https://drive.google.com/drive/folders/drive-46-26",
                "modified_time": "2026-05-01T10:00:00Z",
            }
        ],
    )
    monkeypatch.setattr(
        journal_monitor,
        "list_drive_journal_workbook_files",
        lambda folder_id, service_account_json=None: [
            {"id": f"{folder_id}-xlsx", "name": "46-26 Журнал.xlsx", "mimeType": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"}
        ],
        raising=False,
    )
    monkeypatch.setattr(
        journal_monitor,
        "download_drive_file_bytes",
        lambda file_id, mime_type=None, service_account_json=None: _journal_combined_workbook_bytes(),
        raising=False,
    )
    create_response = client.post(
        "/api/v1/journal-monitors",
        json={"name": "Журнали 2026", "folder_url": "https://drive.google.com/drive/folders/root-folder"},
        headers=auth_headers,
    )
    section_id = create_response.json()["id"]
    sync_response = client.post(f"/api/v1/journal-monitors/{section_id}/sync", headers=auth_headers)
    entry_id = sync_response.json()["entries"][0]["id"]

    delete_response = client.delete(f"/api/v1/journal-monitors/{section_id}/entries/{entry_id}", headers=auth_headers)
    assert delete_response.status_code == 204
    assert client.get(f"/api/v1/journal-monitors/{section_id}", headers=auth_headers).json()["entries"] == []

    tick_response = client.post(
        f"/api/v1/journal-monitors/{section_id}/processing/background-tick?year=2026",
        headers=auth_headers,
    )

    assert tick_response.status_code == 200
    entry = tick_response.json()["entries"][0]
    assert entry["group_code"] == "46-26"
    assert entry["workload_status"] == "processed"
    assert entry["trainees_status"] == "processed"
    assert entry["trainee_count"] == 1


def test_background_tick_processes_existing_pending_entries_when_folder_sync_fails(
    client,
    auth_headers,
    db_session,
    monkeypatch,
):
    monkeypatch.setattr(
        "app.api.routes.journal_monitors.list_drive_child_folders",
        lambda *args, **kwargs: (_ for _ in ()).throw(RuntimeError("Drive root temporarily unavailable")),
    )
    monkeypatch.setattr(
        journal_monitor,
        "list_drive_journal_workbook_files",
        lambda folder_id, service_account_json=None: [
            {"id": f"{folder_id}-xlsx", "name": f"{folder_id}.xlsx", "mimeType": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"}
        ],
        raising=False,
    )
    monkeypatch.setattr(
        journal_monitor,
        "download_drive_file_bytes",
        lambda file_id, mime_type=None, service_account_json=None: _journal_combined_workbook_bytes(),
        raising=False,
    )
    create_response = client.post(
        "/api/v1/journal-monitors",
        json={"name": "Журнали 2026", "folder_url": "https://drive.google.com/drive/folders/root-folder"},
        headers=auth_headers,
    )
    section_id = create_response.json()["id"]
    db_session.add(
        journal_monitor.JournalMonitorEntry(
            section_id=section_id,
            branch_id="main",
            drive_file_id="drive-1-26",
            drive_url="https://drive.google.com/drive/folders/drive-1-26",
            journal_name="1-26 Журнал",
            group_code="1-26",
            workload_status="pending",
            trainees_status="pending",
        )
    )
    db_session.commit()

    tick_response = client.post(
        f"/api/v1/journal-monitors/{section_id}/processing/background-tick?year=2026",
        headers=auth_headers,
    )

    assert tick_response.status_code == 200
    payload = tick_response.json()
    assert "Drive root temporarily unavailable" in payload["last_sync_message"]
    entry = payload["entries"][0]
    assert entry["workload_status"] == "processed"
    assert entry["trainees_status"] == "processed"
    assert entry["trainee_count"] == 1


def test_background_tick_clears_all_pending_workloads_for_resynced_journals(
    client,
    auth_headers,
    monkeypatch,
):
    folders = [
        {
            "id": "drive-1-26",
            "name": "1-26 Журнал",
            "url": "https://drive.google.com/drive/folders/drive-1-26",
            "modified_time": "2026-05-01T10:00:00Z",
        },
        {
            "id": "drive-10-26",
            "name": "10-26 Журнал",
            "url": "https://drive.google.com/drive/folders/drive-10-26",
            "modified_time": "2026-05-01T11:00:00Z",
        },
        {
            "id": "drive-11-26",
            "name": "11-26 Журнал",
            "url": "https://drive.google.com/drive/folders/drive-11-26",
            "modified_time": "2026-05-01T12:00:00Z",
        },
    ]
    monkeypatch.setattr("app.api.routes.journal_monitors.list_drive_child_folders", lambda _folder_id, service_account_json=None: folders)
    monkeypatch.setattr(
        journal_monitor,
        "list_drive_journal_workbook_files",
        lambda folder_id, service_account_json=None: [
            {"id": f"{folder_id}-xlsx", "name": f"{folder_id}.xlsx", "mimeType": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"}
        ],
        raising=False,
    )
    monkeypatch.setattr(
        journal_monitor,
        "download_drive_file_bytes",
        lambda file_id, mime_type=None, service_account_json=None: _journal_combined_workbook_bytes(),
        raising=False,
    )
    create_response = client.post(
        "/api/v1/journal-monitors",
        json={"name": "Журнали 2026", "folder_url": "https://drive.google.com/drive/folders/root-folder"},
        headers=auth_headers,
    )
    section_id = create_response.json()["id"]

    tick_response = client.post(
        f"/api/v1/journal-monitors/{section_id}/processing/background-tick?year=2026",
        headers=auth_headers,
    )

    assert tick_response.status_code == 200
    entries = {entry["group_code"]: entry for entry in tick_response.json()["entries"]}
    assert {entries[code]["workload_status"] for code in ("1-26", "10-26", "11-26")} == {"processed"}
    assert sum(1 for code in ("1-26", "10-26", "11-26") if entries[code]["trainees_status"] == "processed") == 1


def test_delete_journal_entry_archives_group_trainees_and_resync_restores_them(client, auth_headers, db_session, monkeypatch):
    group = Group(branch_id="main", code="46-26", name="Журнал із листів", status=GroupStatus.ACTIVE)
    db_session.add(group)
    db_session.flush()
    _seed_schedule(db_session, group, "46")
    db_session.add(Trainee(branch_id="main", first_name="Іван", last_name="Петренко", status="active", group_code="46-26"))
    db_session.commit()
    monkeypatch.setattr(
        "app.api.routes.journal_monitors.list_drive_child_folders",
        lambda _folder_id, service_account_json=None: [
            {
                "id": "drive-46-26",
                "name": "46-26 Журнал із листів",
                "url": "https://drive.google.com/drive/folders/drive-46-26",
                "modified_time": "2026-05-01T10:00:00Z",
            }
        ],
    )
    monkeypatch.setattr(
        journal_monitor,
        "list_drive_journal_workbook_files",
        lambda folder_id, service_account_json=None: [
            {"id": f"{folder_id}-xlsx", "name": "46-26 Журнал.xlsx", "mimeType": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"}
        ],
        raising=False,
    )
    monkeypatch.setattr(
        journal_monitor,
        "download_drive_file_bytes",
        lambda file_id, mime_type=None, service_account_json=None: _journal_zv_workbook_bytes(
            [
                (1, "З-СНН-001", "Петренко Іван Іванович", "ч", "01.02.1990", "1234567890", "м. Львів", ""),
                (2, "З-СНН-002", "Коваль Олена Петрівна", "ж", "03.04.1992", "0987654321", "м. Київ", ""),
            ]
        ),
        raising=False,
    )
    create_response = client.post(
        "/api/v1/journal-monitors",
        json={"name": "Журнали 2026", "folder_url": "https://drive.google.com/drive/folders/root-folder"},
        headers=auth_headers,
    )
    section_id = create_response.json()["id"]
    sync_response = client.post(f"/api/v1/journal-monitors/{section_id}/sync", headers=auth_headers)
    entry_id = sync_response.json()["entries"][0]["id"]

    delete_response = client.delete(f"/api/v1/journal-monitors/{section_id}/entries/{entry_id}", headers=auth_headers)

    assert delete_response.status_code == 204
    assert "46-26" not in {item["code"] for item in client.get("/api/v1/groups", headers=auth_headers).json()}
    db_session.refresh(group)
    assert group.hidden_from_registry is True
    assert db_session.query(ScheduleSlot).filter(ScheduleSlot.group_id == group.id).count() == 1
    assert db_session.query(Trainee).filter(Trainee.group_code == "46-26", Trainee.is_deleted.is_(False)).count() == 0
    assert db_session.query(Trainee).filter(Trainee.is_deleted.is_(True)).count() == 1

    resync_response = client.post(
        f"/api/v1/journal-monitors/{section_id}/processing/background-tick?year=2026",
        headers=auth_headers,
    )

    assert resync_response.status_code == 200
    db_session.refresh(group)
    assert group.hidden_from_registry is False
    groups_payload = {item["code"]: item for item in client.get("/api/v1/groups", headers=auth_headers).json()}
    assert groups_payload["46-26"]["year"] == 2026
    assert db_session.query(Trainee).filter(Trainee.group_code == "46-26", Trainee.is_deleted.is_(False)).count() == 2


def test_bulk_delete_journal_entries_hides_related_groups(client, auth_headers, db_session, monkeypatch):
    db_session.add_all(
        [
            Trainee(branch_id="main", first_name="Іван", last_name="Перший", status="active", group_code="31-26"),
            Trainee(branch_id="main", first_name="Олена", last_name="Друга", status="active", group_code="32-26"),
        ]
    )
    db_session.commit()
    monkeypatch.setattr(
        "app.api.routes.journal_monitors.list_drive_child_folders",
        lambda _folder_id, service_account_json=None: [
            {
                "id": "drive-31-26",
                "name": "31-26 Перша група",
                "url": "https://drive.google.com/drive/folders/drive-31-26",
                "modified_time": "2026-05-01T10:00:00Z",
            },
            {
                "id": "drive-32-26",
                "name": "32-26 Друга група",
                "url": "https://drive.google.com/drive/folders/drive-32-26",
                "modified_time": "2026-05-01T11:00:00Z",
            },
        ],
    )
    create_response = client.post(
        "/api/v1/journal-monitors",
        json={"name": "Журнали 2026", "folder_url": "https://drive.google.com/drive/folders/root-folder"},
        headers=auth_headers,
    )
    section_id = create_response.json()["id"]
    sync_response = client.post(f"/api/v1/journal-monitors/{section_id}/sync", headers=auth_headers)
    entry_ids = [item["id"] for item in sync_response.json()["entries"]]

    delete_response = client.post(
        f"/api/v1/journal-monitors/{section_id}/entries/bulk-delete",
        json={"entry_ids": entry_ids},
        headers=auth_headers,
    )

    assert delete_response.status_code == 200
    assert delete_response.json()["deleted_count"] == 2
    assert set(delete_response.json()["deleted_ids"]) == set(entry_ids)
    assert {group.code for group in db_session.query(Group).filter(Group.hidden_from_registry.is_(True)).all()} == {"31-26", "32-26"}
    assert db_session.query(Trainee).filter(Trainee.group_code.in_(["31-26", "32-26"]), Trainee.is_deleted.is_(False)).count() == 0
    assert db_session.query(Trainee).filter(Trainee.is_deleted.is_(True)).count() == 2
    assert client.get(f"/api/v1/journal-monitors/{section_id}", headers=auth_headers).json()["entries"] == []
