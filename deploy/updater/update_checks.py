from __future__ import annotations

import os
import shutil
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Sequence


@dataclass(frozen=True)
class CheckResult:
    name: str
    ok: bool
    summary: str = ""


def _tail(text: str, limit: int = 240) -> str:
    compact = " ".join((text or "").strip().split())
    return compact[-limit:] if compact else ""


def _check_environment(cwd: Path) -> dict[str, str]:
    env = os.environ.copy()
    src = str(cwd / "src")
    existing = env.get("PYTHONPATH", "").strip()
    env["PYTHONPATH"] = src if not existing else f"{src}{os.pathsep}{existing}"
    return env


def _as_app_user(args: Sequence[str], as_user: bool) -> list[str]:
    command = list(args)
    if as_user and os.geteuid() == 0:
        app_user = os.environ.get("E_KAIWA_USER", "ubuntu")
        return ["runuser", "-u", app_user, "--", *command]
    return command


def run_command(
    name: str,
    args: Sequence[str],
    *,
    cwd: Path,
    timeout: int = 180,
    as_user: bool = False,
    input_text: str | None = None,
) -> CheckResult:
    try:
        result = subprocess.run(
            _as_app_user(args, as_user),
            cwd=cwd,
            env=_check_environment(cwd),
            text=True,
            input=input_text,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=timeout,
            check=False,
        )
    except FileNotFoundError:
        return CheckResult(name, False, f"{args[0]} unavailable")
    except subprocess.TimeoutExpired:
        return CheckResult(name, False, "timed out")
    except OSError as exc:
        return CheckResult(name, False, str(exc)[:160])

    if result.returncode == 0:
        return CheckResult(name, True, "")
    detail = _tail(result.stderr) or _tail(result.stdout) or f"exit {result.returncode}"
    return CheckResult(name, False, detail)


def run_js_syntax(repo_root: Path, *, node: str = "node") -> CheckResult:
    web_dir = repo_root / "src" / "web"
    failures: list[str] = []
    for path in sorted(web_dir.glob("*.js")):
        result = run_command(
            f"JS syntax {path.name}",
            [node, "--input-type=module", "--check"],
            cwd=repo_root,
            timeout=30,
            as_user=True,
            input_text=path.read_text(encoding="utf-8"),
        )
        if not result.ok:
            failures.append(path.name)
    if failures:
        return CheckResult("JavaScript syntax", False, ", ".join(failures[:8]))
    return CheckResult("JavaScript syntax", True, "")


def run_all_checks(
    repo_root: Path,
    python_bin: Path,
    *,
    on_start: Callable[[str], None] | None = None,
) -> list[CheckResult]:
    checks: list[tuple[str, Callable[[], CheckResult]]] = [
        (
            "Python tests",
            lambda: run_command(
                "Python tests",
                [str(python_bin), "-m", "unittest", "discover", "-s", "src/tests/python", "-p", "test_*.py"],
                cwd=repo_root,
                timeout=240,
                as_user=True,
            ),
        ),
        (
            "Browser tests",
            lambda: run_command(
                "Browser tests",
                ["node", "--test", *[str(path) for path in sorted((repo_root / "src" / "tests" / "js").glob("*.test.mjs"))]],
                cwd=repo_root,
                timeout=240,
                as_user=True,
            ) if shutil.which("node") else CheckResult("Browser tests", False, "node unavailable"),
        ),
        (
            "Python compile",
            lambda: run_command(
                "Python compile",
                [str(python_bin), "-m", "compileall", "-q", "src/e_kaiwa", "src/app.py"],
                cwd=repo_root,
                timeout=120,
                as_user=True,
            ),
        ),
        (
            "JavaScript syntax",
            lambda: run_js_syntax(repo_root) if shutil.which("node") else CheckResult("JavaScript syntax", False, "node unavailable"),
        ),
    ]

    results: list[CheckResult] = []
    for name, action in checks:
        if on_start:
            on_start(name)
        try:
            results.append(action())
        except Exception as exc:
            results.append(CheckResult(name, False, f"runner error: {str(exc)[:140]}"))
    return results
