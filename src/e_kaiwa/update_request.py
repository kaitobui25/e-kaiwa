from __future__ import annotations

import hashlib
import hmac
import os
from pathlib import Path

UPDATE_API_PATH = "/api/update"
UPDATE_LINK_PREFIX = "/u/"
UPDATE_LINK_TOKEN_HASH_ENV = "E_KAIWA_UPDATE_LINK_TOKEN_SHA256"
DEFAULT_UPDATE_LINK_TOKEN_SHA256 = "be36357a359c7cef16f7d63e5a534649c2bdf0c2867724847013e28bbc50e31b"
DEFAULT_UPDATE_REQUEST_PATH = Path(
    os.environ.get(
        "E_KAIWA_UPDATE_REQUEST_PATH",
        "/home/ubuntu/.local/state/e-kaiwa/update-request",
    )
)


def updates_enabled() -> bool:
    return os.environ.get("E_KAIWA_UPDATE_ENABLED", "").strip().lower() in {"1", "true", "yes"}


def _sha256_hex(value: object) -> str:
    text = str(value or "").strip().lower()
    if len(text) != 64:
        return ""
    try:
        int(text, 16)
    except ValueError:
        return ""
    return text


def configured_update_link_token_sha256() -> str:
    override = os.environ.get(UPDATE_LINK_TOKEN_HASH_ENV)
    if override is None or not override.strip():
        return DEFAULT_UPDATE_LINK_TOKEN_SHA256
    return _sha256_hex(override)


def is_update_link(path: str) -> bool:
    return str(path or "").startswith(UPDATE_LINK_PREFIX)


def update_link_authorized(path: str) -> bool:
    path = str(path or "")
    if not is_update_link(path):
        return False

    token = path[len(UPDATE_LINK_PREFIX) :]
    if not token or "/" in token or len(token) > 128:
        return False

    expected = configured_update_link_token_sha256()
    if not expected:
        return False

    actual = hashlib.sha256(token.encode("utf-8")).hexdigest()
    return hmac.compare_digest(actual, expected)


def create_update_request(path: Path = DEFAULT_UPDATE_REQUEST_PATH) -> bool:
    """Create the fixed systemd.path marker. Return False when already pending."""
    target = Path(path)
    if not target.parent.is_dir():
        raise RuntimeError("update service is not provisioned")
    try:
        fd = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    except FileExistsError:
        return False
    try:
        os.write(fd, b"update\n")
    finally:
        os.close(fd)
    return True


def request_update(path: Path = DEFAULT_UPDATE_REQUEST_PATH) -> str:
    """Request the privileged updater and return the public request state."""
    if not updates_enabled():
        raise RuntimeError("self-update is not enabled on this host")
    created = create_update_request(path)
    return "requested" if created else "already_pending"
