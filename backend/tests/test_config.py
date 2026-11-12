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
