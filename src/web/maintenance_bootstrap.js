import {MaintenanceController} from './maintenance.js';
import {MaintenanceOverlay} from './ui_maintenance.js';

const appShell = document.getElementById('app-shell');
const updateButton = document.getElementById('update-button');
const versionNode = document.getElementById('app-version');
const overlay = new MaintenanceOverlay({
  root: document.getElementById('maintenance-root'),
  appShell,
  ring: document.getElementById('maintenance-ring'),
  percent: document.getElementById('maintenance-percent'),
  message: document.getElementById('maintenance-message'),
  detail: document.getElementById('maintenance-detail'),
});

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
  // live.js owns realtime resources; invoke its dedicated maintenance boundary.
  window.dispatchEvent(new CustomEvent('ekaiwa:maintenance-pause'));
}

const controller = new MaintenanceController({
  overlay,
  updateButton,
  pauseForMaintenance: pauseRealtimeForMaintenance,
});

async function bootstrapMaintenance() {
  const health = await loadReleaseInfo();
  if (!health?.update_enabled) return;
  if (!await maintenanceTransportReady()) return;
  if (updateButton) updateButton.hidden = false;
  await controller.start();
}

bootstrapMaintenance();
