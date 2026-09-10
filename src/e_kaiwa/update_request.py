from __future__ import annotations

import os
from pathlib import Path

DEFAULT_UPDATE_REQUEST_PATH = Path(
    os.environ.get(
        "E_KAIWA_UPDATE_REQUEST_PATH",
        "/home/ubuntu/.local/state/e-kaiwa/update-request",
    )
)


def updates_enabled() -> bool:
    return os.environ.get("E_KAIWA_UPDATE_ENABLED", "").strip().lower() in {"1", "true", "yes"}


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
