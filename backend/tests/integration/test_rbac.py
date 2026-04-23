from app.core.security import hash_password
from app.models import Role, RoleName, User


def test_teacher_cannot_create_group(client, db_session):
    teacher_role = db_session.query(Role).filter(Role.name == RoleName.TEACHER).one()
    teacher_user = User(
        username="teacher1",
        password_hash=hash_password("Teacher123!"),
        full_name="Тестовий Викладач",
        roles=[teacher_role],
        is_active=True,
        branch_id="main",
    )
    db_session.add(teacher_user)
    db_session.commit()

    login_response = client.post(
        "/api/v1/auth/login",
        json={"username": "teacher1", "password": "Teacher123!"},
    )
    assert login_response.status_code == 200
    access_token = login_response.json()["access_token"]

    create_group_response = client.post(
        "/api/v1/groups",
        json={"code": "GRP-403", "name": "Forbidden group", "capacity": 10, "status": "planned"},
        headers={"Authorization": f"Bearer {access_token}"},
    )
    assert create_group_response.status_code == 403

