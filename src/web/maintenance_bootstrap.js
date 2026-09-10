import {MaintenanceController} from './maintenance.js';
import {MaintenanceOverlay} from './ui_maintenance.js';

const appShell = document.getElementById('app-shell');
const updateButton = document.getElementById('update-button');
const versionNode = document.getElementById('app-version');
const settingsOpen = document.getElementById('settings-open');
const settingsClose = document.getElementById('settings-close');
const overlay = new MaintenanceOverlay({
  root: document.getElementById('maintenance-root'),
  appShell,
  ring: document.getElementById('maintenance-ring'),
  percent: document.getElementById('maintenance-percent'),
  message: document.getElementById('maintenance-message'),
  detail: document.getElementById('maintenance-detail'),
});

function createClientId() {
  const key = 'e-kaiwa.ui-client-id';
  try {
    const existing = sessionStorage.getItem(key);
    if (existing) return existing;
    const generated = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    sessionStorage.setItem(key, generated);
    return generated;
  } catch {
    return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
}

const clientId = createClientId();

function logUiEvent(payload) {
  const body = JSON.stringify({client_id: clientId, ...payload});
  fetch('/api/ui-event', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body,
    keepalive: true,
  }).catch(() => {});
}

settingsOpen?.addEventListener('click', () => logUiEvent({event: 'settings_open', target: 'settings_button'}));
settingsClose?.addEventListener('click', () => logUiEvent({event: 'settings_close', target: 'settings_close'}));

async function loadReleaseInfo() {
  try {
    const response = await fetch('/health', {cache: 'no-store'});
    if (!response.ok) return null;
    const health = await response.json();
    if (versionNode && health.version) versionNode.textContent = `E-KAIWA v${health.version}`;
    return health;
  } catch {
    return null;
  }
}

async function maintenanceTransportReady() {
  try {
    const response = await fetch('/maintenance/status.json', {cache: 'no-store'});
    if (!response.ok) return false;
    const status = await response.json();
    return Number(status?.schema) === 1 && typeof status?.state === 'string';
  } catch {
    return false;
  }
}

function pauseRealtimeForMaintenance() {
  // live.js owns realtime resources; reuse its existing centralized cleanup boundary.
  window.dispatchEvent(new Event('beforeunload'));
}

const controller = new MaintenanceController({
  overlay,
  updateButton,
  pauseForMaintenance: pauseRealtimeForMaintenance,
  logEvent: logUiEvent,
});

async function bootstrapMaintenance() {
  const health = await loadReleaseInfo();
  if (!health?.update_enabled) return;
  if (!await maintenanceTransportReady()) return;
  if (updateButton) updateButton.hidden = false;
  await controller.start();
}

bootstrapMaintenance();
