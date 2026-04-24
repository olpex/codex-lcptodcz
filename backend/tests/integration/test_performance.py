def test_performance_crud_flow(client, auth_headers):
    group_resp = client.post(
        "/api/v1/groups",
        json={"code": "PRF-1", "name": "Performance Group", "capacity": 30, "status": "active"},
        headers=auth_headers,
    )
    assert group_resp.status_code == 201
    group_id = group_resp.json()["id"]

    trainee_resp = client.post(
        "/api/v1/trainees",
        json={"first_name": "Тест", "last_name": "Слухач", "status": "active"},
        headers=auth_headers,
    )
    assert trainee_resp.status_code == 201
    trainee_id = trainee_resp.json()["id"]

    create_resp = client.post(
        "/api/v1/performance",
        json={
            "group_id": group_id,
            "trainee_id": trainee_id,
            "progress_pct": 75,
            "attendance_pct": 88,
            "employment_flag": False,
        },
        headers=auth_headers,
    )
    assert create_resp.status_code == 201
    performance_id = create_resp.json()["id"]

    list_resp = client.get("/api/v1/performance", headers=auth_headers)
    assert list_resp.status_code == 200
    assert any(item["id"] == performance_id for item in list_resp.json())

    update_resp = client.put(
        f"/api/v1/performance/{performance_id}",
        json={"progress_pct": 92, "attendance_pct": 91, "employment_flag": True},
        headers=auth_headers,
    )
    assert update_resp.status_code == 200
    assert update_resp.json()["employment_flag"] is True

    delete_resp = client.delete(f"/api/v1/performance/{performance_id}", headers=auth_headers)
    assert delete_resp.status_code == 204
