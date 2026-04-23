import time

import pytest


@pytest.mark.perf
def test_kpi_endpoint_basic_load(client, auth_headers):
    started = time.perf_counter()
    total = 30
    for _ in range(total):
        response = client.get("/api/v1/dashboard/kpi", headers=auth_headers)
        assert response.status_code == 200
    elapsed = time.perf_counter() - started
    avg = elapsed / total
    assert avg < 0.2

