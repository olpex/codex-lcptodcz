from app.core.crypto import cipher
from app.core.security import (
    create_access_token,
    create_refresh_token,
    decode_token,
    hash_password,
    verify_password,
)


def test_hash_and_verify_password():
    raw = "SuperStrong123!"
    hashed = hash_password(raw)
    assert hashed != raw
    assert verify_password(raw, hashed)
    assert not verify_password("wrong-password", hashed)


def test_access_and_refresh_tokens_decode():
    access, access_exp = create_access_token("42", {"roles": ["admin"]})
    refresh, refresh_exp, jti = create_refresh_token("42")

    access_payload = decode_token(access)
    refresh_payload = decode_token(refresh)

    assert access_payload["sub"] == "42"
    assert access_payload["type"] == "access"
    assert access_payload["roles"] == ["admin"]
    assert access_payload["exp"] > 0
    assert access_exp is not None

    assert refresh_payload["sub"] == "42"
    assert refresh_payload["type"] == "refresh"
    assert refresh_payload["jti"] == jti
    assert refresh_payload["exp"] > 0
    assert refresh_exp is not None


def test_crypto_roundtrip():
    source = "test@example.com"
    encrypted = cipher.encrypt(source)
    assert encrypted and encrypted != source
    decrypted = cipher.decrypt(encrypted)
    assert decrypted == source

