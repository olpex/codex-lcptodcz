from datetime import date


def test_auth_login_and_me(client):
    login_response = client.post("/api/v1/auth/login", json={"username": "admin", "password": "Admin123!"})
    assert login_response.status_code == 200
    payload = login_response.json()
    assert payload["access_token"]
    assert payload["refresh_token"]

    me_response = client.get(
        "/api/v1/auth/me",
        headers={"Authorization": f"Bearer {payload['access_token']}"},
    )
    assert me_response.status_code == 200
    me_payload = me_response.json()
    role_names = [role["name"] for role in me_payload["roles"]]
    assert "admin" in role_names


def test_group_trainee_enrollment_flow(client, auth_headers):
    trainee_response = client.post(
        "/api/v1/trainees",
        json={"first_name": "Марина", "last_name": "Іваненко", "status": "active"},
        headers=auth_headers,
    )
    assert trainee_response.status_code == 201
    trainee_id = trainee_response.json()["id"]

    group_response = client.post(
        "/api/v1/groups",
        json={"code": "GRP-001", "name": "Тестова група", "capacity": 25, "status": "planned"},
        headers=auth_headers,
    )
    assert group_response.status_code == 201
    group_id = group_response.json()["id"]

    enroll_response = client.post(
        f"/api/v1/groups/{group_id}/enroll",
        json={"trainee_id": trainee_id},
        headers=auth_headers,
    )
    assert enroll_response.status_code == 201
    assert enroll_response.json()["status"] == "active"


def test_schedule_workload_and_kpi_flow(client, auth_headers):
    teacher_response = client.post(
        "/api/v1/teachers",
        json={"first_name": "Тест", "last_name": "Викладач", "hourly_rate": 0, "annual_load_hours": 100, "is_active": True},
        headers=auth_headers,
    )
    assert teacher_response.status_code == 201

    group_response = client.post(
        "/api/v1/groups",
        json={"code": "GRP-002", "name": "Група для розкладу", "capacity": 20, "status": "active"},
        headers=auth_headers,
    )
    assert group_response.status_code == 201

    schedule_response = client.post(
        "/api/v1/schedule/generate",
        json={"start_date": date.today().isoformat(), "days": 3},
        headers=auth_headers,
    )
    assert schedule_response.status_code == 200
    assert len(schedule_response.json()) > 0

    workload_response = client.get("/api/v1/teacher-workload", headers=auth_headers)
    assert workload_response.status_code == 200
    assert isinstance(workload_response.json(), list)

    kpi_response = client.get("/api/v1/dashboard/kpi", headers=auth_headers)
    assert kpi_response.status_code == 200
    kpi_payload = kpi_response.json()
    assert kpi_payload["active_groups"] >= 1
