import { mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  Menu,
  nativeImage,
  powerMonitor,
  powerSaveBlocker,
  shell,
  Tray,
  utilityProcess,
} from "electron";
import {
  loadDesktopConfiguration,
  preserveConfiguration,
} from "./core/configuration.mjs";
import { loadPreferences, savePreferences } from "./core/preferences.mjs";
import { createPowerSaveController } from "./core/power-save.mjs";
import { createSleepGapDetector } from "./core/sleep-gap.mjs";
import { buildAircoMenuItems, recordAircoActionResult } from "./core/airco-menu.mjs";
import { BridgeApi } from "./core/bridge-api.mjs";
import { MenuRebuildGate } from "./core/menu-rebuild-gate.mjs";
import {
  conflictingLaunchAgents,
  disableLaunchAgent,
  inspectLaunchAgents,
} from "./core/launch-agent.mjs";
import { FileLogger } from "./core/logger.mjs";
import { BridgeSupervisor } from "./core/supervisor.mjs";
import { createElectronBridgeLauncher } from "./electron-launcher.mjs";

const APP_NAME = "Sky Control";
const APP_VERSION = app.getVersion();
const AIRCO_REFRESH_INTERVAL = 15_000;
/** States where sleeping would interrupt work in progress, not just idling. */
const SLEEP_SENSITIVE_STATES = new Set(["starting", "running", "recovering"]);
const isDesktopTest = !app.isPackaged && process.env.SKY_CONTROL_DESKTOP_TEST_MODE === "1";

app.setName(APP_NAME);
if (isDesktopTest && process.env.SKY_CONTROL_APP_SUPPORT_PATH) {
  app.setPath("userData", path.join(process.env.SKY_CONTROL_APP_SUPPORT_PATH, "Electron"));
}
const isPrimaryInstance = app.requestSingleInstanceLock();
if (!isPrimaryInstance) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (acceptanceWindow) {
      acceptanceWindow.show();
      acceptanceWindow.focus();
    } else {
      tray?.popUpContextMenu();
    }
  });
}

let tray = null;
let trayMenu = null;
let acceptanceWindow = null;
let supervisor = null;
let logger = null;
let configuration = null;
let quitting = false;
let lastAgents = [];
let bridgeApi = null;
let aircoSnapshot = null;
let aircoLoading = false;
let aircoLoadError = false;
let aircoRefreshTimer = null;
let powerSave = null;
const busyAircos = new Set();
const aircoNotices = new Map();
const menuRebuildGate = new MenuRebuildGate();
const aircoSleepGap = createSleepGapDetector({ intervalMs: AIRCO_REFRESH_INTERVAL });

function supportPaths() {
  const override = isDesktopTest ? process.env.SKY_CONTROL_APP_SUPPORT_PATH : null;
  const appSupportPath = override || path.join(app.getPath("appData"), APP_NAME);
  const logsOverride = isDesktopTest ? process.env.SKY_CONTROL_LOGS_PATH : null;
  const logsPath = logsOverride ||
    (process.platform === "darwin"
      ? path.join(userContext().homeDirectory, "Library", "Logs", APP_NAME)
      : path.join(appSupportPath, "logs"));
  const runtimeOverride = isDesktopTest ? process.env.SKY_CONTROL_RUNTIME_PATH : null;
  const runtimeScript = runtimeOverride ||
    (app.isPackaged
      ? path.join(process.resourcesPath, "bridge", "server.js")
      : path.join(app.getAppPath(), ".next", "desktop-standalone", "server.js"));
  return { appSupportPath, logsPath, runtimeScript };
}

function userContext() {
  const details = os.userInfo();
  return {
    homeDirectory: details.homedir,
    username: details.username,
    userId: typeof process.getuid === "function" ? process.getuid() : details.uid,
  };
}

async function inspectConflicts() {
  if (process.platform !== "darwin") return [];
  lastAgents = await inspectLaunchAgents(userContext());
  return conflictingLaunchAgents(lastAgents, configuration.bindPort);
}

function friendlyStatus(snapshot) {
  if (snapshot.status === "error") {
    if (snapshot.error?.code === "LAUNCH_AGENT_CONFLICT") return "Bridge: Error — headless service conflict";
    if (snapshot.error?.code === "PORT_IN_USE") return "Bridge: Error — port is already in use";
    return `Bridge: Error — ${snapshot.error?.message || "check logs"}`;
  }
  return `Bridge: ${snapshot.status[0].toUpperCase()}${snapshot.status.slice(1)}`;
}

function loginItemState() {
  if (!app.isPackaged && !isDesktopTest) return false;
  return app.getLoginItemSettings().openAtLogin;
}

async function setLoginItem(enabled) {
  if (!app.isPackaged && !isDesktopTest) return;
  app.setLoginItemSettings({ openAtLogin: enabled, type: "mainAppService" });
  const actual = app.getLoginItemSettings().openAtLogin;
  if (actual !== enabled) {
    await showError("Startup setting was not changed", "Change Sky Control in System Settings → General → Login Items.");
  }
  rebuildMenu();
}

async function setPreventSleep(enabled) {
  powerSave.setPreferred(enabled);
  powerSave.apply(SLEEP_SENSITIVE_STATES.has(supervisor?.snapshot().status));
  rebuildMenu();
  try {
    await savePreferences(configuration.appSupportPath, { preventSleep: enabled });
  } catch (error) {
    logger?.error(`PREFERENCES_SAVE_FAILED: ${error?.code || error?.message || "unknown"}.`);
    await showError(
      "The sleep setting could not be saved.",
      "It stays in effect until Sky Control quits.",
    );
  }
}

/** Lock stops nothing, so it only warrants a refresh; sleep freezes the bridge
 *  and its sockets, so the supervisor needs telling on both edges. */
function registerPowerHandlers() {
  powerMonitor.on("suspend", () => {
    logger?.info("System suspending; pausing bridge monitoring.");
    supervisor?.pauseMonitoring();
  });
  powerMonitor.on("resume", () => {
    logger?.info("System resumed; re-checking the bridge.");
    aircoSnapshot = null;
    aircoSleepGap.reset();
    rebuildMenu();
    void supervisor?.resumeMonitoring().then(() => refreshAircoList());
  });
  powerMonitor.on("unlock-screen", () => void refreshAircoList());
}

async function showError(message, detail = "Open Logs for more detail.") {
  await dialog.showMessageBox({
    type: "error",
    title: APP_NAME,
    message,
    detail,
    buttons: ["OK"],
  });
}

async function runAction(action) {
  try {
    const result = await action();
    if (result?.status === "error") {
      await showError(result.error?.message || "The action could not be completed.");
    }
    return result;
  } catch (error) {
    logger?.error(`DESKTOP_ACTION_FAILED: ${error?.code || error?.message || "unknown"}.`);
    await showError("The action could not be completed.");
    return null;
  }
}

async function refreshAircoList() {
  if (
    !bridgeApi ||
    supervisor?.snapshot().status !== "running" ||
    aircoLoading ||
    busyAircos.size
  ) {
    return aircoSnapshot;
  }

  aircoLoading = true;
  rebuildMenu();
  try {
    aircoSnapshot = await bridgeApi.snapshot();
    aircoLoadError = false;
    return aircoSnapshot;
  } catch (error) {
    aircoLoadError = true;
    logger?.error(`AIRCO_MENU_REFRESH_FAILED: ${error?.code || "unknown"}.`);
    return null;
  } finally {
    aircoLoading = false;
    rebuildMenu();
  }
}

async function runAircoAction(aircoId, action) {
  if (!bridgeApi || busyAircos.has(aircoId)) return null;
  busyAircos.add(aircoId);
  rebuildMenu();
  try {
    const result = await action();
    aircoSnapshot = result;
    recordAircoActionResult(aircoNotices, aircoId, result);
    aircoLoadError = false;
    return aircoSnapshot;
  } catch (error) {
    logger?.error(`AIRCO_MENU_ACTION_FAILED: ${error?.code || "unknown"}.`);
    await showError(error?.message || "The air conditioner action could not be completed.");
    return null;
  } finally {
    busyAircos.delete(aircoId);
    rebuildMenu();
  }
}

function handleSupervisorState() {
  const state = supervisor.snapshot();
  powerSave?.apply(SLEEP_SENSITIVE_STATES.has(state.status));
  if (state.status === "running") {
    if (!aircoRefreshTimer) {
      aircoSleepGap.reset();
      aircoRefreshTimer = setInterval(() => {
        if (aircoSleepGap.tick()) {
          // Readings taken before the Mac slept are not evidence of anything now.
          aircoSnapshot = null;
          rebuildMenu();
        }
        void refreshAircoList();
      }, AIRCO_REFRESH_INTERVAL);
      void refreshAircoList();
    }
  } else {
    if (aircoRefreshTimer) clearInterval(aircoRefreshTimer);
    aircoRefreshTimer = null;
    aircoSnapshot = null;
    aircoLoadError = false;
    aircoNotices.clear();
  }
  rebuildMenu();
}

async function migrateFromLaunchAgent() {
  const conflicts = conflictingLaunchAgents(lastAgents, configuration.bindPort);
  if (!conflicts.length) return supervisor.start();
  const confirmation = await dialog.showMessageBox({
    type: "warning",
    title: "Switch to the menu-bar app?",
    message: "Use either the menu-bar app or the headless service on this port, not both.",
    detail:
      "Sky Control will stop and disable the headless LaunchAgent, retain its plist as a backup, preserve your configuration, enable Start at Login, and start the managed bridge.",
    buttons: ["Cancel", "Switch to Menu-Bar App"],
    cancelId: 0,
    defaultId: 0,
  });
  if (confirmation.response !== 1) return null;

  const { userId } = userContext();
  for (const conflict of conflicts) await disableLaunchAgent(conflict, userId);
  await setLoginItem(true);
  logger.info("User confirmed migration from the headless LaunchAgent.");
  return supervisor.start();
}

function buildMenu() {
  if (!tray || !supervisor || !configuration) return;
  const state = supervisor.snapshot();
  const conflict = state.error?.code === "LAUNCH_AGENT_CONFLICT";
  const busy = state.busy;
  const packagedLoginItem = app.isPackaged || isDesktopTest;
  const aircoItems =
    state.status === "running"
      ? buildAircoMenuItems({
          snapshot: aircoSnapshot,
          loading: aircoLoading,
          loadError: aircoLoadError,
          busyIds: busyAircos,
          notices: aircoNotices,
          onRefreshList: () => void refreshAircoList(),
          onProbe: (aircoId) =>
            void runAircoAction(aircoId, () => bridgeApi.probe(aircoId)),
          onControl: (aircoId, action, value) =>
            void runAircoAction(aircoId, () => bridgeApi.control(aircoId, action, value)),
        })
      : [];

  const template = [
    { label: `${APP_NAME} ${APP_VERSION}`, enabled: false },
    { label: friendlyStatus(state), enabled: false },
    { label: `Address: ${configuration.controllerUrl}`, enabled: false },
    { type: "separator" },
    {
      label: "Start Bridge",
      enabled: !busy && !state.hasProcess && !conflict,
      click: () => runAction(() => supervisor.start()),
    },
    {
      label: "Stop Bridge",
      enabled: !busy && state.hasProcess,
      click: () => runAction(() => supervisor.stop()),
    },
    {
      label: "Restart Bridge",
      enabled: !busy && state.hasProcess,
      click: () => runAction(() => supervisor.restart()),
    },
    ...(conflict
      ? [
          { type: "separator" },
          {
            label: "Switch from Headless Service…",
            enabled: !busy,
            click: () => runAction(migrateFromLaunchAgent),
          },
        ]
      : []),
    ...(aircoItems.length ? [{ type: "separator" }, ...aircoItems] : []),
    { type: "separator" },
    {
      label: "Open Controller",
      enabled: state.status === "running",
      click: () => shell.openExternal(configuration.controllerUrl),
    },
    {
      label: "Copy Controller Address",
      click: () => clipboard.writeText(configuration.controllerUrl),
    },
    {
      label: "Open Logs",
      click: async () => {
        const error = await shell.openPath(configuration.logsPath);
        if (error) await showError("The logs folder could not be opened.");
      },
    },
    { type: "separator" },
    ...(process.platform === "darwin"
      ? [
          {
            label: "Keep Mac Awake While Running",
            type: "checkbox",
            checked: Boolean(powerSave?.preferred),
            click: (item) => void setPreventSleep(item.checked),
          },
        ]
      : []),
    {
      label: packagedLoginItem ? "Start at Login" : "Start at Login (packaged app only)",
      type: "checkbox",
      checked: loginItemState(),
      enabled: packagedLoginItem,
      click: (item) => setLoginItem(item.checked),
    },
    {
      label: `About ${APP_NAME}`,
      click: () => app.showAboutPanel(),
    },
    { type: "separator" },
    {
      label: "Quit",
      click: () => app.quit(),
    },
  ];
  trayMenu = Menu.buildFromTemplate(template);
  trayMenu.on("menu-will-show", () => menuRebuildGate.willShow());
  trayMenu.on("menu-will-close", () => menuRebuildGate.willClose(buildMenu));
  tray.setContextMenu(trayMenu);
  tray.setToolTip(`${APP_NAME} — ${friendlyStatus(state).replace("Bridge: ", "")}`);
}

function rebuildMenu() {
  menuRebuildGate.request(buildMenu);
}

async function initialize() {
  if (process.platform === "darwin") {
    app.setActivationPolicy("accessory");
    app.dock?.hide();
  }

  const paths = supportPaths();
  await mkdir(paths.appSupportPath, { recursive: true, mode: 0o700 });
  await mkdir(paths.logsPath, { recursive: true, mode: 0o700 });
  app.setAppLogsPath(paths.logsPath);

  logger = new FileLogger(path.join(paths.logsPath, "bridge.log"));
  await logger.initialize();
  logger.info(`Desktop app ${APP_VERSION} launched.`);

  if (isDesktopTest && process.env.SKY_CONTROL_DESKTOP_TEST_WINDOW === "1") {
    acceptanceWindow = new BrowserWindow({
      width: 720,
      height: 480,
      title: "Sky Control Acceptance",
      backgroundColor: "#f3f7fb",
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
    });
    await acceptanceWindow.loadURL(
      "data:text/html;charset=utf-8," +
        encodeURIComponent(
          '<main style="font:16px -apple-system;padding:56px;color:#18314f"><h1>Sky Control</h1><p>Isolated menu-bar acceptance test</p><p>Right-click to open the native menu.</p><label>Clipboard test <input aria-label="Clipboard test" style="display:block;margin-top:8px;width:360px;padding:8px"></label></main>',
        ),
    );
    acceptanceWindow.webContents.on("context-menu", (_event, params) => {
      trayMenu?.popup({ window: acceptanceWindow, x: params.x, y: params.y });
    });
  }

  configuration = await loadDesktopConfiguration({ ...paths, environment: process.env });
  await preserveConfiguration({
    configuration,
    legacySupportPath: path.join(userContext().homeDirectory, "Library", "Application Support", "Sky Local"),
  });
  bridgeApi = new BridgeApi({ configuration });

  const preferences = await loadPreferences(configuration.appSupportPath);
  powerSave = createPowerSaveController({
    powerSaveBlocker,
    logger,
    preferred: preferences.preventSleep,
  });

  const icon = nativeImage.createFromPath(
    app.isPackaged
      ? path.join(process.resourcesPath, "desktop-assets", "trayTemplate.png")
      : path.join(app.getAppPath(), "desktop", "assets", "trayTemplate.png"),
  );
  icon.setTemplateImage(true);
  tray = new Tray(icon, "29fc7c9f-20d9-4f83-9d45-72583040fe2e");

  app.setAboutPanelOptions({
    applicationName: APP_NAME,
    applicationVersion: APP_VERSION,
    version: APP_VERSION,
    copyright: "MIT licensed community project",
    credits: "Local-first SWM100 bridge. No cloud service or telemetry.",
  });

  supervisor = new BridgeSupervisor({
    configuration,
    launcher: createElectronBridgeLauncher({ utilityProcess, logger }),
    conflictCheck: inspectConflicts,
    logger,
  });
  supervisor.on("state", handleSupervisorState);
  registerPowerHandlers();
  rebuildMenu();
  await supervisor.start();
}

app.on("before-quit", (event) => {
  if (quitting) return;
  event.preventDefault();
  quitting = true;
  powerSave?.release();
  Promise.resolve(supervisor?.stop())
    .then(() => logger?.flush())
    .finally(() => app.exit(0));
});

app.on("window-all-closed", (event) => event.preventDefault?.());

if (isPrimaryInstance) {
  app.whenReady().then(initialize).catch(async (error) => {
    logger?.error(`DESKTOP_INIT_FAILED: ${error?.code || error?.message || "unknown"}.`);
    await showError("Sky Control could not start.");
    app.exit(1);
  });
}
