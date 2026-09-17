from __future__ import annotations

import json
import os
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from contextlib import contextmanager
from http.server import ThreadingHTTPServer
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from e_kaiwa.access import AccessPolicy, SlidingWindowLimiter
from e_kaiwa import maintenance_server
from e_kaiwa.update_request import UPDATE_API_PATH, request_update


class UpdateRequestTests(unittest.TestCase):
    def test_request_update_is_idempotent_while_pending(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            request_path = Path(tmp) / "update-request"
            with patch.dict(os.environ, {"E_KAIWA_UPDATE_ENABLED": "true"}):
                self.assertEqual(request_update(request_path), "requested")
                self.assertEqual(request_update(request_path), "already_pending")
            self.assertEqual(request_path.read_text(encoding="utf-8"), "update\n")

    def test_request_update_fails_closed_when_disabled(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            request_path = Path(tmp) / "update-request"
            with patch.dict(os.environ, {"E_KAIWA_UPDATE_ENABLED": "false"}):
                with self.assertRaisesRegex(RuntimeError, "not enabled"):
                    request_update(request_path)
            self.assertFalse(request_path.exists())


class UpdateApiContractTests(unittest.TestCase):
    @contextmanager
    def running_server(self, *, state: str = "requested"):
        runtime = SimpleNamespace(access=AccessPolicy(mode="public"))
        limiter = SlidingWindowLimiter(100, 60)
        with (
            patch.object(maintenance_server, "updates_enabled", return_value=True),
            patch.object(maintenance_server, "request_update", return_value=state) as request_mock,
            patch.object(maintenance_server, "_UPDATE_LIMITER", limiter),
            patch.object(maintenance_server, "git_revision", return_value="test-revision"),
            patch.object(maintenance_server, "app_version", return_value="test-version"),
        ):
            handler = maintenance_server.make_handler(runtime)
            server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
            server.daemon_threads = True
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            host, port = server.server_address[:2]
            try:
                yield f"http://{host}:{port}", request_mock
            finally:
                server.shutdown()
                server.server_close()
                thread.join(timeout=2)

    def post(self, base_url: str, *, origin: str | None = None) -> tuple[int, dict]:
        request = urllib.request.Request(
            f"{base_url}{UPDATE_API_PATH}",
            data=b"",
            method="POST",
            headers={"User-Agent": "e-kaiwa-update-api-test"},
        )
        if origin:
            request.add_header("Origin", origin)
        with urllib.request.urlopen(request, timeout=2) as response:
            return response.status, json.loads(response.read().decode("utf-8"))

    def test_phone_style_post_without_origin_triggers_update(self) -> None:
        with self.running_server(state="requested") as (base_url, request_mock):
            status, payload = self.post(base_url)
        self.assertEqual(status, 202)
        self.assertEqual(payload, {"ok": True, "state": "requested"})
        request_mock.assert_called_once_with()

    def test_pending_request_returns_stable_state(self) -> None:
        with self.running_server(state="already_pending") as (base_url, request_mock):
            status, payload = self.post(base_url)
        self.assertEqual(status, 202)
        self.assertEqual(payload["state"], "already_pending")
        request_mock.assert_called_once_with()

    def test_foreign_browser_origin_is_rejected(self) -> None:
        with self.running_server() as (base_url, request_mock):
            with self.assertRaises(urllib.error.HTTPError) as caught:
                self.post(base_url, origin="https://evil.example")
        self.assertEqual(caught.exception.code, 403)
        request_mock.assert_not_called()

    def test_get_does_not_trigger_update(self) -> None:
        with self.running_server() as (base_url, request_mock):
            with self.assertRaises(urllib.error.HTTPError) as caught:
                urllib.request.urlopen(f"{base_url}{UPDATE_API_PATH}", timeout=2)
        self.assertEqual(caught.exception.code, 404)
        request_mock.assert_not_called()


if __name__ == "__main__":
    unittest.main()
