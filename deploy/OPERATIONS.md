# E-KAIWA VPS operations

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
