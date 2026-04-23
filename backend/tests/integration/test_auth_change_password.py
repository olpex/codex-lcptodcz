def test_change_password_flow(client, auth_headers):
    change_response = client.post(
        "/api/v1/auth/change-password",
        headers=auth_headers,
        json={"current_password": "Admin123!", "new_password": "Admin12345!"},
    )
    assert change_response.status_code == 200
    assert "Пароль успішно змінено" in change_response.json()["message"]

    old_login = client.post("/api/v1/auth/login", json={"username": "admin", "password": "Admin123!"})
    assert old_login.status_code == 401

    new_login = client.post("/api/v1/auth/login", json={"username": "admin", "password": "Admin12345!"})
    assert new_login.status_code == 200
    assert "access_token" in new_login.json()


def test_admin_reset_password_flow(client):
    old_login = client.post("/api/v1/auth/login", json={"username": "admin", "password": "Admin123!"})
    assert old_login.status_code == 200

    reset_response = client.post(
        "/api/v1/auth/admin-reset-password",
        json={
            "username": "admin",
            "reset_token": "test-admin-reset-token",
            "new_password": "ResetPass123!",
        },
    )
    assert reset_response.status_code == 200
    assert "Пароль адміністратора скинуто" in reset_response.json()["message"]

    stale_refresh = old_login.json()["refresh_token"]
    stale_refresh_response = client.post("/api/v1/auth/refresh", json={"refresh_token": stale_refresh})
    assert stale_refresh_response.status_code == 401

    old_password_login = client.post("/api/v1/auth/login", json={"username": "admin", "password": "Admin123!"})
    assert old_password_login.status_code == 401

    new_password_login = client.post("/api/v1/auth/login", json={"username": "admin", "password": "ResetPass123!"})
    assert new_password_login.status_code == 200


def test_admin_reset_password_rejects_invalid_token(client):
    reset_response = client.post(
        "/api/v1/auth/admin-reset-password",
        json={
            "username": "admin",
            "reset_token": "wrong-token",
            "new_password": "ResetPass123!",
        },
    )
    assert reset_response.status_code == 403
