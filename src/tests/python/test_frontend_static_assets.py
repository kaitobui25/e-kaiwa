from __future__ import annotations

import threading
import unittest
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer

from e_kaiwa.config import WEB_DIR
from e_kaiwa.maintenance_server import make_handler


class FrontendStaticAssetTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        handler = make_handler(object())
        cls.server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
        cls.server.daemon_threads = True
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        host, port = cls.server.server_address[:2]
        cls.base_url = f"http://{host}:{port}"

    @classmethod
    def tearDownClass(cls) -> None:
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join(timeout=2)

    def test_all_browser_js_and_css_files_are_served(self) -> None:
        assets = sorted(
            path for path in WEB_DIR.iterdir()
            if path.is_file() and path.suffix in {".js", ".css"}
        )
        self.assertTrue(assets, "no frontend assets found")

        failures: list[str] = []
        for asset in assets:
            expected_type = "text/javascript" if asset.suffix == ".js" else "text/css"
            try:
                with urllib.request.urlopen(f"{self.base_url}/{asset.name}", timeout=2) as response:
                    status = response.status
                    content_type = response.headers.get("Content-Type", "")
            except urllib.error.HTTPError as exc:
                failures.append(f"{asset.name}: HTTP {exc.code}")
                continue
            except Exception as exc:
                failures.append(f"{asset.name}: {exc}")
                continue

            if status != 200:
                failures.append(f"{asset.name}: HTTP {status}")
            elif expected_type not in content_type:
                failures.append(f"{asset.name}: unexpected Content-Type {content_type!r}")

        self.assertEqual(
            failures,
            [],
            "frontend files exist in src/web but are not correctly served:\n" + "\n".join(failures),
        )


if __name__ == "__main__":
    unittest.main()
