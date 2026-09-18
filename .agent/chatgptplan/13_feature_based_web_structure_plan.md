# 13 — Feature-based `src/web` structure plan

## Goal

Reorganize `src/web` by feature/responsibility so agents can locate and debug code faster without changing runtime behavior.

This plan is intentionally a **filesystem/route/import migration only**. Do not mix it with a functional refactor of `live.js`, CSS redesign, PWA work, or other product changes.

## Current findings

Current `src/web` is flat except for `assets/`.

Important observations:

- `live.js` is the largest frontend file (~59 KB) and coordinates realtime session state, mic/audio, turns, reconnect, idle timeout, settings, and UI events.
- `live.css` and `public.css` are both ~28 KB and form a base + public-mode override layer.
- UI code is already partly modular: `ui.js`, `ui_render.js`, `ui_overlay.js`, `ui_icons.js`.
- Maintenance is already a distinct feature: `maintenance.js`, `maintenance_bootstrap.js`, `ui_maintenance.js`, `maintenance.css`.
- Cross-feature policies exist: `preferences.js`, `language_policy.js`, `replay_policy.js`.
- Static frontend routes are explicitly mapped in both:
  - `src/e_kaiwa/server.py`
  - `src/e_kaiwa/maintenance_server.py`
- `live.html` currently loads root-level CSS/JS URLs.
- JS unit tests import files directly from the current flat filesystem paths.
- Several Python UI tests hardcode `SRC / "web" / "<file>"`.
- `.github/workflows/ci.yml` currently syntax-checks only `src/web/*.js`; after introducing subfolders this must become recursive or the check will silently miss frontend JS.
- `test_frontend_static_assets.py` currently scans only top-level JS/CSS files; it also must become recursive.

## Target structure

Keep the single HTML entrypoint at the web root. Group implementation files by feature.

```text
src/web/
├── live.html
├── assets/
│   └── ...
├── live/
│   ├── main.js
│   ├── audio.js
│   ├── idle.js
│   └── recovery.js
├── ui/
│   ├── controller.js
│   ├── render.js
│   ├── overlay.js
│   ├── icons.js
│   ├── base.css
│   └── public.css
├── maintenance/
│   ├── controller.js
│   ├── bootstrap.js
│   ├── overlay.js
│   └── style.css
└── shared/
    ├── language_policy.js
    ├── preferences.js
    └── replay_policy.js
```

### Why keep `live.html` at the root?

There is only one page entrypoint. Moving it into another folder adds nesting without improving feature discovery. The implementation code is what benefits from feature grouping.

## Exact file mapping

| Current | Target |
| --- | --- |
| `live.js` | `live/main.js` |
| `audio.js` | `live/audio.js` |
| `live_idle.js` | `live/idle.js` |
| `live_recovery.js` | `live/recovery.js` |
| `ui.js` | `ui/controller.js` |
| `ui_render.js` | `ui/render.js` |
| `ui_overlay.js` | `ui/overlay.js` |
| `ui_icons.js` | `ui/icons.js` |
| `live.css` | `ui/base.css` |
| `public.css` | `ui/public.css` |
| `maintenance.js` | `maintenance/controller.js` |
| `maintenance_bootstrap.js` | `maintenance/bootstrap.js` |
| `ui_maintenance.js` | `maintenance/overlay.js` |
| `maintenance.css` | `maintenance/style.css` |
| `language_policy.js` | `shared/language_policy.js` |
| `preferences.js` | `shared/preferences.js` |
| `replay_policy.js` | `shared/replay_policy.js` |

`assets/` and `live.html` stay in place.

## Browser URL policy

Make browser URLs mirror the feature folders.

Example:

```text
/live/main.js
/live/audio.js
/live/idle.js
/live/recovery.js

/ui/controller.js
/ui/render.js
/ui/overlay.js
/ui/icons.js
/ui/base.css
/ui/public.css

/maintenance/controller.js
/maintenance/bootstrap.js
/maintenance/overlay.js
/maintenance/style.css

/shared/language_policy.js
/shared/preferences.js
/shared/replay_policy.js
```

Do **not** add a broad generic static-file server for all of `src/web` during this migration.

Keep explicit static route mappings in Python. This preserves the current security model and keeps the change easy to review.

The existing safe `/assets/` handler remains unchanged.

## Required import updates

### `live/main.js`

Expected dependency directions:

```text
../shared/language_policy.js
../shared/preferences.js
./audio.js
../ui/controller.js
./recovery.js
./idle.js
../shared/replay_policy.js
```

### `shared/preferences.js`

```text
./language_policy.js
```

### `ui/controller.js`

```text
../shared/preferences.js
../shared/replay_policy.js
./icons.js
./render.js
./overlay.js
```

### `ui/render.js`

```text
../shared/replay_policy.js
./icons.js
```

### `ui/overlay.js`

```text
./render.js
../shared/replay_policy.js
```

### `maintenance/bootstrap.js`

```text
./controller.js
./overlay.js
```

## Required `live.html` updates

Preserve CSS load order:

1. fonts
2. base UI
3. public-mode UI override
4. maintenance UI

Target references:

```html
<link rel="stylesheet" href="/assets/fonts/fonts.css">
<link rel="stylesheet" href="/ui/base.css">
<link rel="stylesheet" href="/ui/public.css">
<link rel="stylesheet" href="/maintenance/style.css">

<script type="module" src="/live/main.js"></script>
<script type="module" src="/maintenance/bootstrap.js"></script>
```

Do not alter HTML structure or UI behavior in this task.

## Server changes

### `src/e_kaiwa/server.py`

Update explicit static routes for:

- `/live/*`
- `/ui/*`
- `/shared/*`

Root routes `/` and `/index.html` continue serving `WEB_DIR / "live.html"`.

### `src/e_kaiwa/maintenance_server.py`

Update explicit static routes for `/maintenance/*`.

Do not move maintenance routing into the base server as part of this task. That would combine two independent refactors.

## Test updates

### JS tests

Update direct filesystem imports/readFile paths:

- `audio.test.mjs` → `web/live/audio.js`
- `live_idle.test.mjs` → `web/live/idle.js`
- `live_idle_reconnect.test.mjs` → `web/live/main.js`
- `live_recovery.test.mjs` → `web/live/recovery.js`
- `live_target_language.test.mjs` → `web/live/main.js`
- `mic_lifecycle.test.mjs` → `web/live/main.js`
- `language_policy.test.mjs` → `web/shared/language_policy.js`
- `preferences.test.mjs` → `web/shared/preferences.js`
- `maintenance*.test.mjs` → `web/maintenance/controller.js`
- `ui.test.mjs` → new `shared/` and `ui/` paths
- `ui_overlay.test.mjs` → `web/ui/overlay.js`

Do not change test intent.

### Python tests

Update constants in UI tests that reference flat files, especially:

- `test_frontend_settings.py`
- `test_compact_coach_ui.py`
- `test_language_rescue_ui.py`
- `test_settings_mobile_ui.py`

Also update assertions that check exact import strings or static route strings.

### Static asset regression test

Change `test_frontend_static_assets.py` from top-level `WEB_DIR.iterdir()` to recursive discovery.

It should:

1. recursively find all `.js` and `.css` files outside `assets/`;
2. request the matching nested URL;
3. assert HTTP 200;
4. assert correct Content-Type.

This makes the test stronger than the current flat-directory version.

## CI update — mandatory

Current CI uses:

```sh
for file in src/web/*.js; do
  node --input-type=module --check < "$file"
done
```

After the move, that no longer covers nested modules.

Replace it with a recursive JS syntax check, for example using `find src/web -type f -name '*.js'`.

The exact shell implementation should fail if any nested JS file has invalid syntax.

## Implementation sequence

### Phase 1 — Pure file moves

Move files to the target folders using rename/move operations.

Do not change logic.

### Phase 2 — Repair paths

Update:

- module imports;
- `live.html` URLs;
- Python static route mappings.

At this point the application should be behaviorally identical.

### Phase 3 — Repair tests and CI

Update:

- JS test import paths;
- Python test filesystem paths and exact-string assertions;
- recursive static asset test;
- recursive JS syntax check in CI.

### Phase 4 — Verification

Run:

```text
python -m unittest discover -s src/tests/python -p "test_*.py"
node --test src/tests/js/*.test.mjs
python -m compileall -q src/e_kaiwa src/app.py src/tests/system/check_system.py deploy/updater
recursive JS syntax check
```

Then verify the server can serve at minimum:

```text
/
/ui/base.css
/ui/public.css
/live/main.js
/live/audio.js
/live/idle.js
/live/recovery.js
/shared/preferences.js
/shared/language_policy.js
/shared/replay_policy.js
/maintenance/bootstrap.js
/maintenance/style.css
/assets/fonts/fonts.css
```

## Acceptance criteria

- No frontend behavior changes.
- No settings/config changes.
- No API changes.
- No realtime/Coach logic changes.
- No visual/CSS rule changes.
- All frontend files have one clear feature home.
- Root `src/web` contains only:
  - `live.html`
  - `assets/`
  - feature folders.
- All JS/Python tests pass.
- CI syntax-checks nested JS recursively.
- Static asset regression test detects an unserved nested JS/CSS file.
- Existing `/assets/` traversal protection remains intact.

## Explicit non-goals

Do not do these in the same implementation:

- split the internal logic of `live/main.js`;
- merge/rewrite CSS;
- introduce a bundler;
- introduce npm/Vite/Webpack;
- change URLs to hashed assets;
- add PWA/service worker;
- replace the explicit static-route security model;
- redesign UI;
- rename APIs or backend modules.

## Follow-up after this migration

Once the folder move is stable, evaluate `live/main.js` separately.

The next refactor, if needed, should target its responsibilities rather than create more folders. Candidate boundaries are session/WebSocket lifecycle, turn lifecycle, and mic/input orchestration.

That should be a separate plan and commit so regressions can be isolated easily.
