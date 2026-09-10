from __future__ import annotations

import os
import subprocess
from pathlib import Path

from . import __version__
from .config import PROJECT_ROOT


def app_version() -> str:
    return str(__version__).strip()


def git_revision(project_root: Path = PROJECT_ROOT) -> str:
    override = os.environ.get("E_KAIWA_REVISION", "").strip()
    if override:
        return override[:12]
    try:
        result = subprocess.run(
            ["git", "-C", str(project_root), "rev-parse", "--short=12", "HEAD"],
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            timeout=2,
            check=False,
        )
    except (OSError, subprocess.SubprocessError):
        return "unknown"
    value = result.stdout.strip()
    return value[:12] if result.returncode == 0 and value else "unknown"
