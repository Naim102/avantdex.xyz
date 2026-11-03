"""Process-wide start-up state shared by the app and the /health endpoint."""

import re

state: dict[str, object] = {"migrated": False, "error": ""}


def mask(text: str) -> str:
    """Hide passwords inside connection strings before anything is logged or returned."""
    return re.sub(r"(://[^:/@\s]+:)[^@\s]+@", r"\1***@", text)
