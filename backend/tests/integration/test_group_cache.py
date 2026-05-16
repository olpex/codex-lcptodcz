from app.api.routes import groups as groups_route
from app.api.routes import schedule as schedule_route
from app.models import Group, GroupStatus


def test_group_list_uses_branch_cache(client, auth_headers, monkeypatch):
    cached_payload = [
        {
            "id": 321,
            "branch_id": "main",
            "code": "CACHE-26",
            "name": "Кешована група",
            "capacity": 25,
            "status": "active",
            "hidden_from_registry": False,
            "start_date": "2026-03-01",
            "end_date": "2026-03-31",
            "year": 2026,
            "created_at": "2026-02-01T09:00:00Z",
        }
    ]
    requested_keys: list[str] = []

    def fake_cache_get_json(key: str):
        requested_keys.append(key)
        return cached_payload

    monkeypatch.setattr(groups_route, "cache_get_json", fake_cache_get_json, raising=False)

    response = client.get("/api/v1/groups", headers=auth_headers)

    assert response.status_code == 200
    assert response.json()[0]["code"] == "CACHE-26"
    assert requested_keys == ["groups:list:main:v1"]


def test_group_list_stores_uncached_branch_response(client, auth_headers, db_session, monkeypatch):
    group = Group(branch_id="main", code="SET-26", name="Група для кешу", status=GroupStatus.ACTIVE)
    db_session.add(group)
    db_session.commit()
    stored_payloads: list[tuple[str, list[dict], int]] = []

    monkeypatch.setattr(groups_route, "cache_get_json", lambda key: None, raising=False)
    monkeypatch.setattr(
        groups_route,
        "cache_set_json",
        lambda key, payload, ttl_seconds: stored_payloads.append((key, payload, ttl_seconds)),
        raising=False,
    )

    response = client.get("/api/v1/groups", headers=auth_headers)

    assert response.status_code == 200
    assert stored_payloads
    key, payload, ttl_seconds = stored_payloads[0]
    assert key == "groups:list:main:v1"
    assert ttl_seconds == 60
    assert any(item["code"] == "SET-26" for item in payload)


def test_group_mutation_invalidates_branch_cache(client, auth_headers, monkeypatch):
    invalidated_branches: list[str] = []
    monkeypatch.setattr(
        groups_route,
        "invalidate_group_list_cache",
        lambda branch_id: invalidated_branches.append(branch_id),
        raising=False,
    )

    response = client.post(
        "/api/v1/groups",
        json={"code": "INV-26", "name": "Група зі скиданням кешу", "capacity": 25, "status": "planned"},
        headers=auth_headers,
    )

    assert response.status_code == 201
    assert invalidated_branches == ["main"]


def test_schedule_mutation_invalidates_group_branch_cache(client, auth_headers, db_session, monkeypatch):
    from tests.integration.test_schedule_delete import _seed_schedule_group

    group, _teacher = _seed_schedule_group(db_session, code="SCH-INV-26", hours=4)
    invalidated_branches: list[str] = []
    monkeypatch.setattr(
        schedule_route,
        "invalidate_group_list_cache",
        lambda branch_id: invalidated_branches.append(branch_id),
        raising=False,
    )

    response = client.delete(f"/api/v1/schedule/groups/{group.id}", headers=auth_headers)

    assert response.status_code == 200
    assert invalidated_branches == ["main"]
