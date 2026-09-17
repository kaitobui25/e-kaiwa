# E-KAIWA VPS operations

## Phone update trigger

There are two update entry points. Both only create the fixed systemd update-request marker; Git/test/deploy logic stays inside the privileged updater.

### One-link phone update

The simple phone recovery flow is:

```text
GET /u/<token>
```

Opening the full HTTPS URL in a browser immediately requests an update, then redirects to:

```text
/maintenance/status.json
```

The plaintext token is not stored in the repository. The application stores only its SHA-256 hash and compares hashes in constant time. The built-in bootstrap token can later be rotated by setting `E_KAIWA_UPDATE_LINK_TOKEN_SHA256` to a new SHA-256 hash and restarting `ekaiwa.service`.

Security/operational rules:

- Treat the full `/u/<token>` URL like a password. Do not share it.
- The application redacts the token from its own HTTP log.
- The URL may still exist in browser history or reverse-proxy access logs if those logs are enabled.
- Invalid tokens return `404` and do not create an update request.
- Valid one-link requests use the same public update rate limit as the normal API.
- The link cannot supply a Git URL, branch, command, or filesystem path.
- This is a recovery path for a broken frontend. It still requires the E-KAIWA Python server process to be running.

### Programmatic update API

The existing API remains:

```text
POST /api/update
```

It has no request body. Successful responses use HTTP `202`:

```json
{"ok":true,"state":"requested"}
```

If an update request is already waiting:

```json
{"ok":true,"state":"already_pending"}
```

Public browser requests from a foreign `Origin` are rejected and public update requests are rate-limited. A native phone HTTP client may send no `Origin`.

The route names, token validation, and update-request state mapping live in `src/e_kaiwa/update_request.py`. `maintenance_server.py` only handles HTTP validation/rate limiting and delegates the request. Keep Git/test/deploy logic inside the privileged updater, not inside the API handler.

The privileged updater still enforces `origin/main`, fast-forward-only Git updates, a single updater lock, tests, service restart, and health verification.

## Runtime logs

E-KAIWA intentionally keeps application-session logs and privileged updater logs in different locations.

### Conversation logs

```text
/home/ubuntu/e-kaiwa/runtime_logs/YYYY-MM-DD/<session>/conversation.jsonl
```

One directory per session. Contains conversation/Coach turn data and runtime metrics for that session.

### UI event log

```text
/home/ubuntu/e-kaiwa/runtime_logs/YYYY-MM-DD/ui_events.jsonl
```

Contains browser/UI diagnostics such as Settings, maintenance/update UI events, and realtime recovery events. Do not log auth tokens or session-resumption handles.

### Updater history and status

```text
/var/lib/ekaiwa-update/updater.jsonl
/var/lib/ekaiwa-update/status.json
```

`updater.jsonl` is the append-only privileged updater history. It records update state transitions, check results, service start and health results. It is deliberately outside the repository `runtime_logs/` tree.

`status.json` is the compact current updater state served to the maintenance UI.

Useful commands:

```bash
sudo ls -lah /var/lib/ekaiwa-update/
sudo tail -n 100 /var/lib/ekaiwa-update/updater.jsonl
sudo cat /var/lib/ekaiwa-update/status.json
sudo journalctl -u ekaiwa-update.service -n 200 --no-pager
sudo journalctl -u ekaiwa.service -n 200 --no-pager
```

## Browser-test Node environment

The updater service runs outside the interactive `ubuntu` NVM shell and may resolve `/usr/bin/node`. The repository therefore declares ES-module semantics in the root `package.json`; browser tests must not depend on Node's implicit `.js` module detection.

Validate with the same system Node path used by the updater:

```bash
cd /home/ubuntu/e-kaiwa
sudo /usr/bin/node --test src/tests/js/*.test.mjs
```

Also validate the interactive development Node:

```bash
node --test src/tests/js/*.test.mjs
```

Both must pass.
