"""Application settings, read from environment variables (see .env.example)."""

from functools import lru_cache

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    env: str = "development"  # development | test | production

    database_url: str = "postgresql+psycopg://avantdex:avantdex@localhost:5432/avantdex"

    # Chain (Arc Testnet by default). Testnet and mainnet values must never be mixed.
    chain_id: int = 5042002
    rpc_url: str = "https://rpc.testnet.arc.io"
    explorer_url: str = "https://explorer.testnet.arc.io"
    usdc_address: str = "0x3600000000000000000000000000000000000000"
    exchange_address: str = ""
    exchange_deploy_block: int = 0

    # Fee configuration is a constant in the contract; this mirrors it for the public /config endpoint.
    fee_collector: str = "0x136a2C17E0E6C077F48F489BeC6DBCE3202CEbd6"
    buyer_fee_bps: int = 50
    seller_fee_bps: int = 50

    # Auth
    jwt_secret: str = Field(default="", description="Random secret, at least 32 characters")
    session_hours: int = 12
    admin_session_hours: int = 2
    nonce_minutes: int = 10
    auth_domain: str = "localhost"
    auth_uri: str = "http://localhost"
    # Comma separated wallet addresses that receive the super_admin role on startup.
    bootstrap_admin_addresses: str = ""
    # Extra admins with specific roles, set from the environment. Format (comma between wallets, | between roles):
    #   ADMIN_ROLES=0xAAAA…:super_admin,0xBBBB…:project_reviewer|verification_admin
    admin_roles: str = ""
    require_two_person_approval: bool = False

    cors_origins: str = ""

    # Indexer
    indexer_batch_blocks: int = 2000
    indexer_poll_seconds: float = 2.0

    @property
    def bootstrap_admins(self) -> list[str]:
        return [a.strip().lower() for a in self.bootstrap_admin_addresses.split(",") if a.strip()]

    @property
    def env_admin_roles(self) -> dict[str, set[str]]:
        """Admin wallets and roles defined in the environment (BOOTSTRAP_ADMIN_ADDRESSES + ADMIN_ROLES)."""
        out: dict[str, set[str]] = {}
        for a in self.bootstrap_admins:
            out.setdefault(a, set()).add("super_admin")
        for entry in self.admin_roles.split(","):
            entry = entry.strip()
            if not entry or ":" not in entry:
                continue
            addr, roles = entry.split(":", 1)
            out.setdefault(addr.strip().lower(), set()).update(r.strip() for r in roles.split("|") if r.strip())
        return out

    @property
    def cors_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    s = Settings()
    if s.env == "production" and len(s.jwt_secret) < 32:
        raise RuntimeError("JWT_SECRET must be set to a random value of at least 32 characters in production")
    return s
