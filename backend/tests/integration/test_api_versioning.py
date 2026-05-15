def test_api_v1_responses_echo_supported_version(client):
    response = client.post(
        "/api/v1/auth/login",
        json={"username": "admin", "password": "Admin123!"},
        headers={"X-API-Version": "1"},
    )

    assert response.status_code == 200
    assert response.headers["X-API-Version"] == "1"


def test_api_rejects_unsupported_version_header(client):
    response = client.post(
        "/api/v1/auth/login",
        json={"username": "admin", "password": "Admin123!"},
        headers={"X-API-Version": "2"},
    )

    assert response.status_code == 400
    assert response.json()["detail"] == "Unsupported API version"
