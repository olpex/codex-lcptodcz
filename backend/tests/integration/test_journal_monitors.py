from datetime import datetime, timezone

from app.models import Group, GroupStatus, Room, ScheduleSlot, Subject, Teacher, Trainee
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

    def fake_drive_folders(_folder_id: str):
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

    detail_response = client.get(f"/api/v1/journal-monitors/{section_id}", headers=auth_headers)
    assert detail_response.status_code == 200
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
        lambda _folder_id: [
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


def test_drive_folder_listing_uses_service_account_bearer_token(monkeypatch):
    monkeypatch.setattr(journal_monitor.settings, "google_drive_api_key", "")
    monkeypatch.setattr(
        journal_monitor.settings,
        "google_drive_service_account_json",
        '{"client_email":"drive-reader@example.iam.gserviceaccount.com","private_key":"-----BEGIN PRIVATE KEY-----\\nKEY\\n-----END PRIVATE KEY-----\\n","token_uri":"https://oauth2.googleapis.com/token"}',
    )
    monkeypatch.setattr(journal_monitor, "_get_service_account_access_token", lambda: "service-token")

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
