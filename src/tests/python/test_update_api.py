from __future__ import annotations

import hashlib
import io
import json
import os
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from contextlib import contextmanager, redirect_stdout
from http.client import HTTPConnection
from http.server import ThreadingHTTPServer
from pathlib import Path
from types import SimpleNamespace
from urllib.parse import urlsplit
from unittest.mock import patch

from e_kaiwa import maintenance_server
from e_kaiwa.access import AccessPolicy, SlidingWindowLimiter
from e_kaiwa.update_request import (
    DEFAULT_UPDATE_LINK_TOKEN_SHA256,
    UPDATE_API_PATH,
    UPDATE_LINK_PREFIX,
    UPDATE_LINK_TOKEN_HASH_ENV,
    request_update,
    update_link_authorized,
)

TEST_UPDATE_TOKEN = "test-update-token-0123456789abcdefghijklmnop"
TEST_UPDATE_TOKEN_SHA256 = hashlib.sha256(TEST_UPDATE_TOKEN.encode("utf-8")).hexdigest()


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


class UpdateLinkAuthTests(unittest.TestCase):
    def test_default_token_hash_is_valid_sha256(self) -> None:
        self.assertEqual(len(DEFAULT_UPDATE_LINK_TOKEN_SHA256), 64)
        int(DEFAULT_UPDATE_LINK_TOKEN_SHA256, 16)

    def test_matching_token_hash_is_authorized(self) -> None:
        with patch.dict(os.environ, {UPDATE_LINK_TOKEN_HASH_ENV: TEST_UPDATE_TOKEN_SHA256}):
            self.assertTrue(update_link_authorized(f"{UPDATE_LINK_PREFIX}{TEST_UPDATE_TOKEN}"))

    def test_wrong_token_is_rejected(self) -> None:
        with patch.dict(os.environ, {UPDATE_LINK_TOKEN_HASH_ENV: TEST_UPDATE_TOKEN_SHA256}):
            self.assertFalse(update_link_authorized(f"{UPDATE_LINK_PREFIX}wrong-token"))

    def test_invalid_hash_override_fails_closed(self) -> None:
        with patch.dict(os.environ, {UPDATE_LINK_TOKEN_HASH_ENV: "not-a-sha256"}):
            self.assertFalse(update_link_authorized(f"{UPDATE_LINK_PREFIX}{TEST_UPDATE_TOKEN}"))

    def test_extra_path_segment_is_rejected(self) -> None:
        with patch.dict(os.environ, {UPDATE_LINK_TOKEN_HASH_ENV: TEST_UPDATE_TOKEN_SHA256}):
            self.assertFalse(update_link_authorized(f"{UPDATE_LINK_PREFIX}{TEST_UPDATE_TOKEN}/extra"))


class UpdateApiContractTests(unittest.TestCase):
    @contextmanager
    def running_server(
        self,
        *,
        state: str = "requested",
        update_enabled: bool = True,
        rate_limit: int = 100,
        token_hash: str = TEST_UPDATE_TOKEN_SHA256,
    ):
        runtime = SimpleNamespace(access=AccessPolicy(mode="public"))
        limiter = SlidingWindowLimiter(rate_limit, 60)
        with (
            patch.dict(os.environ, {UPDATE_LINK_TOKEN_HASH_ENV: token_hash}),
            patch.object(maintenance_server, "updates_enabled", return_value=update_enabled),
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

    def get_raw(self, base_url: str, path: str) -> tuple[int, dict[str, str], bytes]:
        parsed = urlsplit(base_url)
        connection = HTTPConnection(parsed.hostname, parsed.port, timeout=2)
        try:
            connection.request("GET", path, headers={"User-Agent": "e-kaiwa-update-link-test"})
            response = connection.getresponse()
            body = response.read()
            headers = {key.lower(): value for key, value in response.getheaders()}
            return response.status, headers, body
        finally:
            connection.close()

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

    def test_disabled_update_api_fails_closed(self) -> None:
        with self.running_server(update_enabled=False) as (base_url, request_mock):
            with self.assertRaises(urllib.error.HTTPError) as caught:
                self.post(base_url)
        self.assertEqual(caught.exception.code, 503)
        request_mock.assert_not_called()

    def test_foreign_browser_origin_is_rejected(self) -> None:
        with self.running_server() as (base_url, request_mock):
            with self.assertRaises(urllib.error.HTTPError) as caught:
                self.post(base_url, origin="https://evil.example")
        self.assertEqual(caught.exception.code, 403)
        request_mock.assert_not_called()

    def test_public_update_api_is_rate_limited(self) -> None:
        with self.running_server(rate_limit=1) as (base_url, request_mock):
            status, _payload = self.post(base_url)
            self.assertEqual(status, 202)
            with self.assertRaises(urllib.error.HTTPError) as caught:
                self.post(base_url)
        self.assertEqual(caught.exception.code, 429)
        request_mock.assert_called_once_with()

    def test_get_api_update_does_not_trigger_update(self) -> None:
        with self.running_server() as (base_url, request_mock):
            status, _headers, _body = self.get_raw(base_url, UPDATE_API_PATH)
        self.assertEqual(status, 404)
        request_mock.assert_not_called()

    def test_valid_one_link_update_triggers_and_redirects_to_status(self) -> None:
        with self.running_server() as (base_url, request_mock):
            status, headers, _body = self.get_raw(
                base_url,
                f"{UPDATE_LINK_PREFIX}{TEST_UPDATE_TOKEN}",
            )
        self.assertEqual(status, 303)
        self.assertEqual(headers.get("location"), "/maintenance/status.json")
        self.assertEqual(headers.get("cache-control"), "no-store")
        self.assertEqual(headers.get("referrer-policy"), "no-referrer")
        request_mock.assert_called_once_with()

    def test_wrong_one_link_token_returns_404(self) -> None:
        with self.running_server() as (base_url, request_mock):
            status, _headers, _body = self.get_raw(base_url, f"{UPDATE_LINK_PREFIX}wrong-token")
        self.assertEqual(status, 404)
        request_mock.assert_not_called()

    def test_invalid_token_configuration_returns_404(self) -> None:
        with self.running_server(token_hash="invalid") as (base_url, request_mock):
            status, _headers, _body = self.get_raw(
                base_url,
                f"{UPDATE_LINK_PREFIX}{TEST_UPDATE_TOKEN}",
            )
        self.assertEqual(status, 404)
        request_mock.assert_not_called()

    def test_disabled_one_link_update_returns_503(self) -> None:
        with self.running_server(update_enabled=False) as (base_url, request_mock):
            status, _headers, _body = self.get_raw(
                base_url,
                f"{UPDATE_LINK_PREFIX}{TEST_UPDATE_TOKEN}",
            )
        self.assertEqual(status, 503)
        request_mock.assert_not_called()

    def test_one_link_update_uses_same_rate_limit(self) -> None:
        with self.running_server(rate_limit=1) as (base_url, request_mock):
            first_status, _headers, _body = self.get_raw(
                base_url,
                f"{UPDATE_LINK_PREFIX}{TEST_UPDATE_TOKEN}",
            )
            second_status, _headers, _body = self.get_raw(
                base_url,
                f"{UPDATE_LINK_PREFIX}{TEST_UPDATE_TOKEN}",
            )
        self.assertEqual(first_status, 303)
        self.assertEqual(second_status, 429)
        request_mock.assert_called_once_with()

    def test_update_token_is_redacted_from_application_log(self) -> None:
        output = io.StringIO()
        with redirect_stdout(output):
            with self.running_server() as (base_url, request_mock):
                status, _headers, _body = self.get_raw(
                    base_url,
                    f"{UPDATE_LINK_PREFIX}{TEST_UPDATE_TOKEN}",
                )
        self.assertEqual(status, 303)
        request_mock.assert_called_once_with()
        log_text = output.getvalue()
        self.assertNotIn(TEST_UPDATE_TOKEN, log_text)
        self.assertIn(f"{UPDATE_LINK_PREFIX}<redacted>", log_text)


if __name__ == "__main__":
    unittest.main()
