# E-KAIWA VPS operations

## Phone update trigger API

The stable update trigger is:

```text
POST /api/update
```

It has no request body and does not depend on the main frontend JavaScript. This makes it usable from a phone when the normal UI or Update button is broken, as long as the E-KAIWA server process itself is still running.

This endpoint is not a fully independent rescue service. If `ekaiwa.service` is down or cannot start, `/api/update` is unavailable too. A future out-of-process rescue gateway should be implemented separately rather than adding more deployment logic to the application server.

Successful responses use HTTP `202`:

```json
{"ok":true,"state":"requested"}
```

If an update request is already waiting:

```json
{"ok":true,"state":"already_pending"}
```

Operational rules:

- Keep this endpoint `POST` only. Do not turn update into a `GET` link.
- The endpoint can only create the fixed systemd update-request marker; it cannot accept a Git URL, branch, command, or arbitrary filesystem path.
- The privileged updater still enforces `origin/main`, fast-forward-only Git updates, a single updater lock, tests, service restart, and health verification.
- Public browser requests from a foreign `Origin` are rejected and public update requests are rate-limited.
- A native phone HTTP client may send no `Origin`; this is intentionally supported for phone recovery when the frontend is broken.
- Use the HTTPS public domain when calling it remotely.

The route name and update-request state mapping live in `src/e_kaiwa/update_request.py`. `maintenance_server.py` only handles HTTP validation/rate limiting and delegates the request. Keep Git/test/deploy logic inside the privileged updater, not inside the API handler.

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
