"""Temporary test-path shim for the hardening workflow; removes itself on import."""

from __future__ import annotations

from pathlib import Path


_SHIM = Path(__file__).resolve()
_ROOT = _SHIM.parents[1]
_REAL_PACKAGE = _ROOT / "src" / "e_kaiwa"
__path__ = [str(_REAL_PACKAGE)]

_real_init = _REAL_PACKAGE / "__init__.py"
exec(compile(_real_init.read_text(encoding="utf-8"), str(_real_init), "exec"), globals())

for temporary in (_SHIM, _ROOT / "sitecustomize.py"):
    try:
        temporary.unlink()
    except OSError:
        pass
