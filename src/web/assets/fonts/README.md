# Be Vietnam Pro webfonts

Intended files:
- BeVietnamPro-Regular.woff2 — 400
- BeVietnamPro-Medium.woff2 — 500
- BeVietnamPro-SemiBold.woff2 — 600
- BeVietnamPro-Bold.woff2 — 700
- BeVietnamPro-ExtraBold.woff2 — 800

These binary files are intentionally fetched from the official upstream repository
by `scripts/fetch-fonts.ps1` (Windows) or `scripts/fetch-fonts.sh` (Linux/macOS).

After fetching, either:
1. `@import url("./assets/fonts/fonts.css");` from `src/web/live.css`, or
2. copy the five `@font-face` rules into the existing stylesheet.

For this app, prefer option 2 if keeping CSS requests/files minimal is more important.
Do not add a Google Fonts runtime dependency after self-hosting.
