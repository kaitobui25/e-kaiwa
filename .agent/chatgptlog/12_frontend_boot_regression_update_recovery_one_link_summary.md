# Chat summary — frontend boot regression, recovery update API, one-link phone update

Date: 2026-09-17

## Context

The production E-KAIWA mobile UI became stuck on its initial loading state: `Loading…`, `Loading settings…`, disabled microphone, and `Connecting…`.

The user wanted the root cause found first, then fixed with regression coverage, and later wanted a very simple phone-only recovery update flow: ideally opening one URL should trigger an update.

## Frontend boot regression

The UI state matched the untouched initial HTML state in `src/web/live.html`, which meant the frontend bootstrap JavaScript had not completed.

`src/web/live.js` is an ES module. If any relative import fails, browser module evaluation aborts before `bootstrap()` runs.

The confirmed regression was introduced by commit:

- `8b41218952c539146af51fc67f5c2628655ba3b6`
- version `0.18`
- replay UX refactor

That change added `src/web/replay_policy.js` and imported it from multiple frontend modules, including `live.js`, but the production HTTP server did not expose `/replay_policy.js`.

Production result:

```text
/live.js                    -> 200
/replay_policy.js           -> 404
ES module graph             -> abort
bootstrap()                 -> never runs
UI                          -> stays on Loading...
```

The replay logic itself was reasonable: replay availability was centralized through `hasPlayableReplay(turn)` and required valid `Int16Array` PCM with a minimum sample count. The integration mistake was forgetting to add the new JS module to the server static routes.

## Why tests originally missed it

Existing JavaScript tests imported files directly from the repository filesystem through Node, so `replay_policy.js` existed and tests passed.

The system check only fetched a few top-level endpoints such as `/`, `/live.css`, and `/live.js`. It did not recursively follow the ES module dependency graph, so it did not detect that `/live.js` depended on a missing HTTP route.

This created the important distinction:

```text
file exists in repository != file is actually served to browser
```

## Fix for the loading regression

The following changes were put on `main`:

- `e5d7b96563d85273d2ca5e1a434da0538a7de040` — serve `/replay_policy.js`
- `995e78887a5a9057746462d04b56e873a081e364` — add regression coverage that checks browser assets are served
- `2076b73e4644c6d2eb95ab2cd6a036886a7e57df` — bump version to `0.19`

The new regression test is intended to fail when a frontend JS/CSS file exists but the application server does not serve it correctly.

## Phone recovery update API — version 0.20

Because the user only had a phone and no VPS shell access, the next problem was how to trigger self-update when the normal Update button or frontend UI is broken.

The existing updater architecture already used a fixed marker file watched by systemd, so the application-side recovery API was kept deliberately small.

Stable API contract:

```text
POST /api/update
```

Behavior:

```text
POST /api/update
  -> validate update is enabled
  -> public-origin/rate-limit checks
  -> call request_update()
  -> create the fixed systemd update-request marker
  -> privileged updater performs fetch/test/restart/health flow
```

Important design constraints:

- API cannot accept arbitrary Git URL, branch, command, or filesystem path.
- Git/test/deploy logic remains in the privileged updater service.
- Repeated requests are idempotent while a marker is already pending.
- Public foreign browser origins are rejected.
- Native phone HTTP clients without an `Origin` header are supported.
- This API depends on the E-KAIWA Python process still being alive. It is not an independent rescue daemon.

Version `0.20` hardened and documented this contract and added tests covering requested/already-pending, disabled update, foreign origin, rate limit, and GET-not-allowed behavior.

## User requirement: "open one link and update"

The user explicitly preferred `simple is best` and did not want an extra gateway/service architecture.

Final simplified plan:

```text
https://<domain>/u/<SECRET>
```

Opening the URL performs:

```text
GET /u/<token>
  -> validate token
  -> rate limit
  -> request_update()
  -> redirect to maintenance status
```

No additional updater service, gateway service, frontend page, JavaScript bundle, or Caddy rule was added for this feature.

## One-link update implementation — version 0.21

Implemented in branch `feature/one-link-update`, tested, then fast-forwarded into `main`.

Main implementation files:

- `src/e_kaiwa/update_request.py`
- `src/e_kaiwa/maintenance_server.py`
- `src/tests/python/test_update_api.py`
- `deploy/OPERATIONS.md`
- `src/e_kaiwa/__init__.py`

Version was bumped to `0.21`.

Security/maintenance choices:

- The update URL token is checked using SHA-256 + `hmac.compare_digest`.
- Plaintext token is not committed to the repository.
- Only a fixed update marker can be created.
- Invalid token/configuration fails closed.
- Route is rate-limited.
- The token is intentionally not written to application logs.
- The plaintext token/link is intentionally omitted from this chat log; future agents should not copy secrets into repository logs.

The one-link route still has the same architectural limitation as `/api/update`: if `ekaiwa.service` itself is completely down, the route is unavailable.

## Tests

GitHub Actions `Core checks` passed for the feature branch and again after updating `main`.

Verified passing steps on `main` included:

```text
Install runtime dependencies       PASS
Python core regression tests       PASS
Browser module tests               PASS
Python syntax check                PASS
Browser JavaScript syntax check    PASS
```

The one-link/update tests cover the key cases: authorized link, wrong token, invalid configuration, update disabled, rate limiting, redirect behavior, duplicate request state, and protection against leaking the token into normal app logging.

## Bootstrap problem for the first deployment

After `0.21` was merged, the VPS was still running the older code, so opening `/u/<token>` initially returned HTTP `404`.

That was expected: the one-link route cannot be used until the VPS has downloaded the version that contains the route.

The user only had a phone. For the one-time bootstrap:

- iPhone option discussed: Shortcuts -> `POST https://ekaiwa.duckdns.org/api/update`
- Android option discussed: HTTP Shortcuts or Termux

The user used Termux successfully:

```bash
curl -X POST https://ekaiwa.duckdns.org/api/update
```

Response:

```json
{"ok": true, "state": "requested"}
```

That confirms the old VPS backend accepted the update request and triggered the updater marker.

The conversation ended before the user confirmed the final updater state from `/maintenance/status.json`, so do not assume deployment completion solely from this log.

## Current intended operating flow

Once the VPS is actually running `0.21` or newer:

```text
phone opens private one-link URL
    -> E-KAIWA backend validates token
    -> request_update()
    -> systemd path notices marker
    -> ekaiwa-update.service runs
    -> git fetch / fast-forward / tests / restart / health check
    -> browser is redirected to maintenance status
```

For normal UI-driven updates, `POST /api/update` remains available as the stable API contract.

## Important lessons for future agents

1. Any new browser ES module must be verified through the actual HTTP serving layer, not only filesystem imports in Node tests.
2. When adding a frontend dependency, test that every browser-visible static dependency returns `200` with the correct content type.
3. Keep update-trigger HTTP handlers thin; deployment logic belongs in the privileged updater.
4. Prefer the existing fixed marker + systemd updater flow over adding parallel deployment mechanisms.
5. Do not place plaintext recovery/update tokens in Git commits, chat logs, operational logs, or test fixtures.
6. A successful `{"state":"requested"}` only proves the update was queued, not that deployment completed. Check `/maintenance/status.json` or updater logs before claiming success.
