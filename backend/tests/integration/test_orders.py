from datetime import date


def test_order_update_and_delete(client, auth_headers):
    create_response = client.post(
        "/api/v1/orders",
        headers=auth_headers,
        json={
            "order_number": "ORD-1",
            "order_type": "internal",
            "order_date": date.today().isoformat(),
            "status": "draft",
            "payload_json": {"source": "test"},
        },
    )
    assert create_response.status_code == 201
    order_id = create_response.json()["id"]

    update_response = client.put(
        f"/api/v1/orders/{order_id}",
        headers=auth_headers,
        json={
            "order_number": "ORD-1A",
            "status": "approved",
        },
    )
    assert update_response.status_code == 200
    assert update_response.json()["order_number"] == "ORD-1A"
    assert update_response.json()["status"] == "approved"

    delete_response = client.delete(f"/api/v1/orders/{order_id}", headers=auth_headers)
    assert delete_response.status_code == 204

