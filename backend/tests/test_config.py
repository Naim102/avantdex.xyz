from app.config import Settings


def test_blank_environment_variables_use_the_defaults(monkeypatch):
    """Coolify passes variables it has no value for as empty strings; they must not stop the API from starting."""
    for name in ("OPS_INTERVAL_SECONDS", "KEEPER_COMPLETE_MARKETS", "KEEPER_MAX_GAS_GWEI", "EXCHANGE_DEPLOY_BLOCK"):
        monkeypatch.setenv(name, "")
    s = Settings()
    assert s.ops_interval_seconds == 60.0
    assert s.keeper_complete_markets is False
    assert s.keeper_max_gas_gwei == 25
    assert s.exchange_deploy_block == 0


def test_config_exposes_circle_wallet_only_when_a_client_key_is_set(client, monkeypatch):
    from app.config import get_settings

    cctp = client.get("/api/config").json()["cctp"]
    assert cctp == {"api_url": "https://iris-api-sandbox.circle.com"}
    off = client.get("/api/config").json()["circle_wallet"]
    assert off["enabled"] is False and off["client_key"] == ""
    monkeypatch.setenv("CIRCLE_CLIENT_KEY", "  TEST_API_KEY:abc:def  ")
    monkeypatch.setenv("CIRCLE_CLIENT_URL", "")  # a blank variable (Coolify) means the default
    get_settings.cache_clear()
    try:
        on = client.get("/api/config").json()["circle_wallet"]
        assert on["enabled"] is True and on["client_key"] == "TEST_API_KEY:abc:def"
        assert on["client_url"] == "https://modular-sdk.circle.com/v1/rpc/w3s/buidl" and on["paymaster"] is True
    finally:
        monkeypatch.undo()
        get_settings.cache_clear()


def test_cctp_api_url_must_be_https_and_loses_a_trailing_slash(monkeypatch):
    import pytest
    from pydantic import ValidationError

    monkeypatch.setenv("CCTP_API_URL", " https://iris-api.circle.com/ ")
    assert Settings().cctp_api_url == "https://iris-api.circle.com"
    monkeypatch.setenv("CCTP_API_URL", "http://iris.example")
    with pytest.raises(ValidationError):
        Settings()
    monkeypatch.setenv("CCTP_API_URL", "")  # blank (Coolify) means the sandbox default
    assert Settings().cctp_api_url == "https://iris-api-sandbox.circle.com"
