"""Temporary GitHub Actions bootstrap; self-deletes after exporting src to later steps."""

from __future__ import annotations

import os
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parent
SRC = ROOT / "src"
if str(SRC) not in sys.path:
    sys.path.insert(0, str(SRC))

env_file = os.environ.get("GITHUB_ENV")
if env_file:
    with open(env_file, "a", encoding="utf-8") as stream:
        stream.write(f"PYTHONPATH={SRC}\n")

try:
    Path(__file__).unlink()
except OSError:
    pass
