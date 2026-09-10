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
    if (updateButton) updateButton.hidden = !health.update_enabled;
    return health;
  } catch {
    return null;
  }
}

function pauseRealtimeForMaintenance() {
  // live.js already owns complete realtime cleanup in its beforeunload handler.
  // Reuse that single cleanup boundary so maintenance does not reach into its private state.
  window.dispatchEvent(new Event('beforeunload'));
}

const controller = new MaintenanceController({
  overlay,
  updateButton,
  pauseForMaintenance: pauseRealtimeForMaintenance,
});

async function bootstrapMaintenance() {
  const health = await loadReleaseInfo();
  if (health?.update_enabled) await controller.start();
}

bootstrapMaintenance();
