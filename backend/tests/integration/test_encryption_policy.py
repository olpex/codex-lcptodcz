from app.core.security import hash_password
from app.models import Role, RoleName, Trainee, User


def test_personal_data_encrypted_at_rest_and_decrypted_in_api(client, auth_headers, db_session):
    raw_phone = "+380501112233"
    raw_email = "student@example.com"
    raw_document = "AA123456"

    create_response = client.post(
        "/api/v1/trainees",
        headers=auth_headers,
        json={
            "first_name": "Олег",
            "last_name": "Тестовий",
            "status": "active",
            "phone": raw_phone,
            "email": raw_email,
            "id_document": raw_document,
        },
    )
    assert create_response.status_code == 201
    trainee_id = create_response.json()["id"]

    row = db_session.get(Trainee, trainee_id)
    assert row is not None
    assert row.phone_encrypted and row.phone_encrypted != raw_phone
    assert row.email_encrypted and row.email_encrypted != raw_email
    assert row.id_document_encrypted and row.id_document_encrypted != raw_document

    read_response = client.get(f"/api/v1/trainees/{trainee_id}", headers=auth_headers)
    assert read_response.status_code == 200
    payload = read_response.json()
    assert payload["phone"] == raw_phone
    assert payload["email"] == raw_email
    assert payload["id_document"] == raw_document


def test_teacher_cannot_create_trainee(client, db_session):
    teacher_role = db_session.query(Role).filter(Role.name == RoleName.TEACHER).one()
    teacher = User(
        username="readonly_teacher",
        password_hash=hash_password("Teacher123!"),
        full_name="Readonly Teacher",
        roles=[teacher_role],
        is_active=True,
        branch_id="main",
    )
    db_session.add(teacher)
    db_session.commit()

    teacher_login = client.post(
        "/api/v1/auth/login",
        json={"username": "readonly_teacher", "password": "Teacher123!"},
    )
    assert teacher_login.status_code == 200
    token = teacher_login.json()["access_token"]

    create_response = client.post(
        "/api/v1/trainees",
        headers={"Authorization": f"Bearer {token}"},
        json={"first_name": "X", "last_name": "Y", "status": "active"},
    )
    assert create_response.status_code == 403
