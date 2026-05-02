def test_api_responses_prevent_search_indexing(client):
    response = client.get("/health")

    assert response.headers["x-robots-tag"] == "noindex, nofollow, noarchive, nosnippet, noimageindex"
