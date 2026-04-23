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

