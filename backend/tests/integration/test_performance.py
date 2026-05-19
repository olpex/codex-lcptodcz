from app.api.routes import performance as performance_route
from app.models import Performance


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


def test_performance_list_uses_unfiltered_branch_cache(client, auth_headers, db_session, monkeypatch):
    group_resp = client.post(
        "/api/v1/groups",
        json={"code": "PRF-CACHE", "name": "Performance Cache", "capacity": 30, "status": "active"},
        headers=auth_headers,
    )
    trainee_resp = client.post(
        "/api/v1/trainees",
        json={"first_name": "Кеш", "last_name": "Слухач", "status": "active"},
        headers=auth_headers,
    )
    create_resp = client.post(
        "/api/v1/performance",
        json={
            "group_id": group_resp.json()["id"],
            "trainee_id": trainee_resp.json()["id"],
            "progress_pct": 75,
            "attendance_pct": 88,
            "employment_flag": False,
        },
        headers=auth_headers,
    )
    assert create_resp.status_code == 201
    performance_id = create_resp.json()["id"]
    cache: dict[str, list[dict]] = {}
    cache_sets: list[tuple[str, int]] = []

    monkeypatch.setattr(performance_route, "cache_get_json", lambda key: cache.get(key))

    def fake_cache_set(key: str, payload: list[dict], ttl_seconds: int) -> None:
        cache[key] = payload
        cache_sets.append((key, ttl_seconds))

    monkeypatch.setattr(performance_route, "cache_set_json", fake_cache_set)

    first = client.get("/api/v1/performance", headers=auth_headers)
    assert first.status_code == 200
    first_payload = first.json()
    assert first_payload[0]["id"] == performance_id

    entity = db_session.get(Performance, performance_id)
    entity.progress_pct = 12
    db_session.add(entity)
    db_session.commit()

    second = client.get("/api/v1/performance", headers=auth_headers)
    filtered = client.get(f"/api/v1/performance?group_id={group_resp.json()['id']}", headers=auth_headers)

    assert second.status_code == 200
    assert second.json() == first_payload
    assert filtered.status_code == 200
    assert filtered.json()[0]["progress_pct"] == 12
    assert cache_sets == [("performance:list:main:v1", 60)]


def test_performance_mutations_invalidate_list_and_dashboard_kpi_cache(client, auth_headers, monkeypatch):
    group_resp = client.post(
        "/api/v1/groups",
        json={"code": "PRF-INV", "name": "Performance Invalidation", "capacity": 30, "status": "active"},
        headers=auth_headers,
    )
    trainee_resp = client.post(
        "/api/v1/trainees",
        json={"first_name": "Інвалідація", "last_name": "Слухач", "status": "active"},
        headers=auth_headers,
    )
    deleted_keys: list[str] = []
    monkeypatch.setattr(performance_route, "cache_delete", lambda key: deleted_keys.append(key))
    monkeypatch.setattr(performance_route, "_current_plan_year", lambda: 2026)

    create_resp = client.post(
        "/api/v1/performance",
        json={
            "group_id": group_resp.json()["id"],
            "trainee_id": trainee_resp.json()["id"],
            "progress_pct": 75,
            "attendance_pct": 88,
            "employment_flag": False,
        },
        headers=auth_headers,
    )
    assert create_resp.status_code == 201
    performance_id = create_resp.json()["id"]
    assert deleted_keys == ["performance:list:main:v1", "dashboard:kpi:main:2026"]
    deleted_keys.clear()

    update_resp = client.put(
        f"/api/v1/performance/{performance_id}",
        json={"employment_flag": True},
        headers=auth_headers,
    )
    assert update_resp.status_code == 200
    assert deleted_keys == ["performance:list:main:v1", "dashboard:kpi:main:2026"]
    deleted_keys.clear()

    delete_resp = client.delete(f"/api/v1/performance/{performance_id}", headers=auth_headers)
    assert delete_resp.status_code == 204
    assert deleted_keys == ["performance:list:main:v1", "dashboard:kpi:main:2026"]
