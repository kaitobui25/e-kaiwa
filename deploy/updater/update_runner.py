from __future__ import annotations

import fcntl
import hashlib
import json
import os
import re
import shutil
import subprocess
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Sequence

try:
    from .update_checks import CheckResult, run_all_checks
    from .update_status import StatusWriter
except ImportError:
    from update_checks import CheckResult, run_all_checks
    from update_status import StatusWriter

REPO_ROOT = Path(os.environ.get("E_KAIWA_REPO", "/home/ubuntu/e-kaiwa"))
PYTHON_BIN = Path(os.environ.get("E_KAIWA_PYTHON", "/home/ubuntu/e-kaiwa/.venv/bin/python"))
STATUS_PATH = Path(os.environ.get("E_KAIWA_UPDATE_STATUS", "/var/lib/ekaiwa-update/status.json"))
REQUEST_PATH = Path(os.environ.get("E_KAIWA_UPDATE_REQUEST", "/home/ubuntu/.local/state/e-kaiwa/update-request"))
LOCK_PATH = Path(os.environ.get("E_KAIWA_UPDATE_LOCK", "/run/ekaiwa-update.lock"))
SERVICE_NAME = os.environ.get("E_KAIWA_SERVICE", "ekaiwa.service")
APP_USER = os.environ.get("E_KAIWA_USER", "ubuntu")
GRACE_SECONDS = float(os.environ.get("E_KAIWA_UPDATE_GRACE", "3"))
HEALTH_URL = os.environ.get("E_KAIWA_HEALTH_URL", "http://127.0.0.1:7860/health")
VERSION_FILE = Path("src/e_kaiwa/__init__.py")
UPDATER_INSTALL_DIR = Path(os.environ.get("E_KAIWA_UPDATER_INSTALL", "/opt/ekaiwa-updater"))
VERSION_RE = re.compile(r'^__version__\s*=\s*["\']([^"\']+)["\']', re.MULTILINE)
PROGRESS = {
    "Python tests": 45,
    "Browser tests": 60,
    "Python compile": 72,
    "JavaScript syntax": 82,
}


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def short_sha(value: str) -> str:
    return str(value or "")[:12]


def read_version_text(text: str) -> str:
    match = VERSION_RE.search(text)
    if not match:
        raise RuntimeError("app version not found in src/e_kaiwa/__init__.py")
    return match.group(1).strip()


def file_hash(path: Path) -> str:
    if not path.is_file():
        return "missing"
    return hashlib.sha256(path.read_bytes()).hexdigest()


def command(args: Sequence[str], *, as_user: bool = False, timeout: int = 120) -> subprocess.CompletedProcess[str]:
    cmd = list(args)
    if as_user and os.geteuid() == 0:
        cmd = ["runuser", "-u", APP_USER, "--", *cmd]
    return subprocess.run(
        cmd,
        cwd=REPO_ROOT,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        timeout=timeout,
        check=False,
    )


def checked(args: Sequence[str], *, as_user: bool = False, timeout: int = 120) -> str:
    result = command(args, as_user=as_user, timeout=timeout)
    if result.returncode != 0:
        detail = " ".join((result.stderr or result.stdout or "").strip().split())[-300:]
        raise RuntimeError(detail or f"command failed: {' '.join(args)}")
    return result.stdout.strip()


def git(*args: str, timeout: int = 120) -> str:
    return checked(["git", "-C", str(REPO_ROOT), *args], as_user=True, timeout=timeout)


def git_version(ref: str) -> str:
    text = git("show", f"{ref}:{VERSION_FILE.as_posix()}")
    return read_version_text(text)


def refresh_installed_updater() -> None:
    source_dir = REPO_ROOT / "deploy" / "updater"
    if not source_dir.is_dir() or not UPDATER_INSTALL_DIR.is_dir():
        return
    for name in ("update_status.py", "update_checks.py", "update_runner.py"):
        source = source_dir / name
        if source.is_file():
            shutil.copy2(source, UPDATER_INSTALL_DIR / name)


def public_failures(results: list[CheckResult], operational: list[str]) -> list[str]:
    failures = [item for item in operational if item]
    for result in results:
        if not result.ok:
            suffix = f": {result.summary}" if result.summary else ""
            failures.append(f"{result.name}{suffix}")
    return [item[:220] for item in failures[:12]]


def health_ready(expected_revision: str, expected_version: str, timeout: int = 25) -> tuple[bool, str]:
    deadline = time.monotonic() + timeout
    last_error = "health unavailable"
    while time.monotonic() < deadline:
        try:
            with urllib.request.urlopen(HEALTH_URL, timeout=2) as response:
                payload = json.loads(response.read().decode("utf-8"))
            if not payload.get("ok"):
                last_error = "health ok=false"
            elif short_sha(payload.get("revision", "")) != short_sha(expected_revision):
                last_error = "revision mismatch"
            elif str(payload.get("version", "")) != str(expected_version):
                last_error = "version mismatch"
            else:
                return True, ""
        except (OSError, ValueError, urllib.error.URLError) as exc:
            last_error = str(exc)[:160]
        time.sleep(0.75)
    return False, last_error


def main() -> int:
    writer = StatusWriter(STATUS_PATH)
    update_id = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    base: dict[str, Any] = {
        "schema": 1,
        "update_id": update_id,
        "state": "preparing",
        "progress": 0,
        "message": "Preparing update",
        "from_version": "",
        "to_version": "",
        "from_revision": "",
        "to_revision": "",
        "failures": [],
        "updated_at": now_iso(),
    }

    def publish(state: str, progress: int, message: str, *, failures: list[str] | None = None) -> None:
        base.update(
            state=state,
            progress=max(0, min(100, int(progress))),
            message=str(message)[:120],
            failures=failures if failures is not None else base.get("failures", []),
            updated_at=now_iso(),
        )
        writer.write(base)

    LOCK_PATH.parent.mkdir(parents=True, exist_ok=True)
    lock_handle = LOCK_PATH.open("a+")
    try:
        fcntl.flock(lock_handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        REQUEST_PATH.unlink(missing_ok=True)
        return 0

    stopped = False
    stop_attempted = False
    check_results: list[CheckResult] = []
    operational: list[str] = []
    try:
        current_revision = git("rev-parse", "HEAD")
        current_version = read_version_text((REPO_ROOT / VERSION_FILE).read_text(encoding="utf-8"))
        base.update(from_revision=short_sha(current_revision), from_version=current_version)

        publish("preparing", 0, "Fetching Git")
        git("fetch", "origin", "main", timeout=180)
        target_revision = git("rev-parse", "origin/main")
        target_version = git_version("origin/main")
        base.update(to_revision=short_sha(target_revision), to_version=target_version)

        if current_revision == target_revision:
            publish("already_latest", 100, "Already latest")
            return 0

        dirty = git("status", "--porcelain", "--untracked-files=no")
        if dirty:
            publish("failed", 100, "Local tracked changes", failures=["Git: local tracked changes"])
            return 1

        ancestor = command(
            ["git", "-C", str(REPO_ROOT), "merge-base", "--is-ancestor", "HEAD", "origin/main"],
            as_user=True,
            timeout=30,
        )
        if ancestor.returncode != 0:
            publish("failed", 100, "Non-fast-forward update", failures=["Git: non-fast-forward"])
            return 1

        old_requirements = file_hash(REPO_ROOT / "src" / "requirements.txt")
        publish("preparing", 5, "Maintenance starting")
        time.sleep(max(0.0, GRACE_SECONDS))

        publish("stopping", 10, "Stopping E-KAIWA")
        stop_attempted = True
        checked(["systemctl", "stop", SERVICE_NAME], timeout=45)
        stopped = True

        try:
            publish("updating", 20, "Applying Git update")
            git("merge", "--ff-only", "origin/main", timeout=120)
        except Exception as exc:
            operational.append(f"Git update: {str(exc)[:160]}")

        deployed_revision = git("rev-parse", "HEAD")
        deployed_version = read_version_text((REPO_ROOT / VERSION_FILE).read_text(encoding="utf-8"))
        base.update(to_revision=short_sha(deployed_revision), to_version=deployed_version)

        new_requirements = file_hash(REPO_ROOT / "src" / "requirements.txt")
        publish("dependencies", 35, "Checking dependencies")
        if old_requirements != new_requirements:
            try:
                checked(
                    [str(PYTHON_BIN), "-m", "pip", "install", "-r", str(REPO_ROOT / "src" / "requirements.txt")],
                    as_user=True,
                    timeout=420,
                )
            except Exception as exc:
                operational.append(f"Dependencies: {str(exc)[:160]}")

        def on_check(name: str) -> None:
            publish("testing", PROGRESS.get(name, 45), f"Running {name}", failures=public_failures(check_results, operational))

        check_results = run_all_checks(REPO_ROOT, PYTHON_BIN, on_start=on_check)
        failures = public_failures(check_results, operational)
        publish("checks_complete", 90, "Checks complete", failures=failures)
        try:
            refresh_installed_updater()
        except Exception as exc:
            operational.append(f"Updater refresh: {str(exc)[:160]}")

    except Exception as exc:
        operational.append(f"Updater: {str(exc)[:180]}")
        publish(
            "checks_complete" if stop_attempted else "failed",
            90 if stop_attempted else 100,
            "Update encountered an error",
            failures=public_failures(check_results, operational),
        )
    finally:
        REQUEST_PATH.unlink(missing_ok=True)

    if not stop_attempted:
        return 1 if operational else 0

    publish("starting", 92, "Starting E-KAIWA", failures=public_failures(check_results, operational))
    try:
        checked(["systemctl", "start", SERVICE_NAME], timeout=45)
    except Exception as exc:
        operational.append(f"Start: {str(exc)[:160]}")

    try:
        deployed_revision = git("rev-parse", "HEAD")
        deployed_version = read_version_text((REPO_ROOT / VERSION_FILE).read_text(encoding="utf-8"))
    except Exception as exc:
        publish(
            "start_failed",
            100,
            "Could not verify deployed code",
            failures=public_failures(check_results, [*operational, str(exc)]),
        )
        return 1

    publish("health", 97, "Waiting for health", failures=public_failures(check_results, operational))
    ready, health_error = health_ready(deployed_revision, deployed_version)
    if not ready:
        operational.append(f"Health: {health_error}")
        publish("start_failed", 100, "E-KAIWA failed health check", failures=public_failures(check_results, operational))
        return 1

    failures = public_failures(check_results, operational)
    publish("complete", 100, "Update complete", failures=failures)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
