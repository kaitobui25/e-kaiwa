#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="${E_KAIWA_REPO:-/home/ubuntu/e-kaiwa}"
APP_USER="${E_KAIWA_USER:-ubuntu}"
UPDATER_DIR="/opt/ekaiwa-updater"
STATUS_DIR="/var/lib/ekaiwa-update"
REQUEST_DIR="/home/${APP_USER}/.local/state/e-kaiwa"

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run as root: sudo bash deploy/install_update.sh" >&2
  exit 1
fi

install -d -m 0755 "${UPDATER_DIR}" "${STATUS_DIR}"
install -d -o "${APP_USER}" -g "${APP_USER}" -m 0755 "${REQUEST_DIR}"
install -m 0644 "${REPO_ROOT}/deploy/updater/update_status.py" "${UPDATER_DIR}/update_status.py"
install -m 0644 "${REPO_ROOT}/deploy/updater/update_checks.py" "${UPDATER_DIR}/update_checks.py"
install -m 0644 "${REPO_ROOT}/deploy/updater/update_runner.py" "${UPDATER_DIR}/update_runner.py"
install -m 0644 "${REPO_ROOT}/deploy/systemd/ekaiwa-update.service" /etc/systemd/system/ekaiwa-update.service
install -m 0644 "${REPO_ROOT}/deploy/systemd/ekaiwa-update.path" /etc/systemd/system/ekaiwa-update.path
install -d -m 0755 /etc/systemd/system/ekaiwa.service.d
install -m 0644 "${REPO_ROOT}/deploy/systemd/ekaiwa-update-env.conf" /etc/systemd/system/ekaiwa.service.d/update.conf

cat > "${STATUS_DIR}/status.json" <<'JSON'
{"schema":1,"update_id":"","state":"idle","progress":0,"message":"","from_version":"","to_version":"","from_revision":"","to_revision":"","failures":[],"updated_at":""}
JSON
chmod 0644 "${STATUS_DIR}/status.json"

systemctl daemon-reload
systemctl enable --now ekaiwa-update.path
systemctl restart ekaiwa.service

echo "Updater installed."
echo "Next: merge deploy/caddy/maintenance.caddy into /etc/caddy/Caddyfile, validate, then reload Caddy."
