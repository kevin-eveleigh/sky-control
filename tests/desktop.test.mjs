import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  AIRCO_TEMPERATURES,
  buildAircoMenuItems,
  formatAircoStatus,
  recordAircoActionResult,
} from "../desktop/core/airco-menu.mjs";
import { BridgeApi, BridgeApiError } from "../desktop/core/bridge-api.mjs";
import { MenuRebuildGate } from "../desktop/core/menu-rebuild-gate.mjs";
import { personalPathNeedles } from "../support/personal-paths.mjs";
import {
  loadDesktopConfiguration,
  preserveConfiguration,
} from "../desktop/core/configuration.mjs";
import {
  conflictingLaunchAgents,
  disableLaunchAgent,
  inspectLaunchAgents,
  launchAgentDefinitions,
} from "../desktop/core/launch-agent.mjs";
import { createPowerSaveController } from "../desktop/core/power-save.mjs";
import { loadPreferences, savePreferences } from "../desktop/core/preferences.mjs";
import { createSleepGapDetector } from "../desktop/core/sleep-gap.mjs";
import { BridgeSupervisor } from "../desktop/core/supervisor.mjs";

const cleanup = new Set();
let nextPid = 20_000;

test.afterEach(async () => {
  for (const item of cleanup) await item();
  cleanup.clear();
});

async function temporaryDirectory() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "sky-control-desktop-test-"));
  cleanup.add(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

async function testConfiguration() {
  const root = await temporaryDirectory();
  return {
    appSupportPath: root,
    logsPath: path.join(root, "logs"),
    runtimeScript: "/fixture/standalone/server.js",
    bindHost: "127.0.0.1",
    bindPort: 43123,
    controllerUrl: "http://127.0.0.1:43123",
    dataPath: path.join(root, "data"),
    bridgeEnvironment: {
      NODE_ENV: "test",
      HOSTNAME: "127.0.0.1",
      PORT: "43123",
    },
  };
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const fixtureSnapshot = {
  authRequired: false,
  authManagedByEnv: false,
  aircos: [
    {
      id: "living-room",
      displayName: "Living room",
      location: "Downstairs",
      host: "192.0.2.10",
      port: 80,
      reachable: true,
      lastSeen: "2026-08-14T12:00:00.000Z",
      lastState: {
        power: true,
        mode: "cool",
        indoorTemperature: 24,
        targetTemperature: 21,
      },
      logs: [],
    },
  ],
};

test("desktop menu bridge listing is local-only and sends no device command", async () => {
  const configuration = await testConfiguration();
  await mkdir(configuration.dataPath, { recursive: true });
  const calls = [];
  const api = new BridgeApi({
    configuration,
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return jsonResponse(fixtureSnapshot);
    },
  });

  assert.deepEqual(await api.snapshot(), fixtureSnapshot);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "http://127.0.0.1:43123/api/aircos");
  assert.equal(calls[0].options.method, undefined);
  assert.equal(calls[0].options.headers.authorization, undefined);
});

test("desktop menu bridge reads the current stored token without exposing it", async () => {
  const configuration = await testConfiguration();
  await mkdir(configuration.dataPath, { recursive: true });
  await writeFile(
    path.join(configuration.dataPath, "settings.json"),
    JSON.stringify({ version: 1, token: "stored-secret" }),
  );
  let authorization;
  const api = new BridgeApi({
    configuration,
    fetchImpl: async (_url, options) => {
      authorization = options.headers.authorization;
      return jsonResponse(fixtureSnapshot);
    },
  });

  const snapshot = await api.snapshot();
  assert.equal(authorization, "Bearer stored-secret");
  assert.equal(JSON.stringify(snapshot).includes("stored-secret"), false);
});

test("desktop menu bridge sends only explicit probe and validated control requests", async () => {
  const configuration = await testConfiguration();
  const calls = [];
  const api = new BridgeApi({
    configuration,
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return jsonResponse(fixtureSnapshot);
    },
  });

  await api.probe("living-room");
  await api.control("living-room", "power", false);
  await api.control("living-room", "mode", "dry");
  await api.control("living-room", "temperature", 23);

  assert.deepEqual(
    calls.map(({ url, options }) => [url.split("/").at(-1), options.method, JSON.parse(options.body)]),
    [
      ["probe", "POST", { aircoId: "living-room", background: false }],
      ["control", "POST", { aircoId: "living-room", action: "power", value: false }],
      ["control", "POST", { aircoId: "living-room", action: "mode", value: "dry" }],
      ["control", "POST", { aircoId: "living-room", action: "temperature", value: 23 }],
    ],
  );
  assert.throws(
    () => api.control("living-room", "temperature", 31),
    (error) => error instanceof BridgeApiError && error.code === "INVALID_CONTROL",
  );
});

test("desktop airco menu presents live readings and routes deliberate choices", () => {
  const actions = [];
  const menu = buildAircoMenuItems({
    snapshot: fixtureSnapshot,
    onRefreshList: () => actions.push(["list"]),
    onProbe: (id) => actions.push(["probe", id]),
    onControl: (id, action, value) => actions.push(["control", id, action, value]),
  });
  const aircoMenu = menu.find((item) => item.label === "Living room").submenu;

  assert.equal(formatAircoStatus(fixtureSnapshot.aircos[0]), "On · Cool · Room 24°C · Target 21°C");
  assert.equal(aircoMenu[0].label, "On · Cool · Room 24°C · Target 21°C");
  assert.equal(aircoMenu.find((item) => item.label === "Power").checked, true);
  assert.equal(AIRCO_TEMPERATURES.at(0), 16);
  assert.equal(AIRCO_TEMPERATURES.at(-1), 30);

  aircoMenu.find((item) => item.label === "Refresh Device Status").click();
  aircoMenu.find((item) => item.label === "Power").click();
  aircoMenu
    .find((item) => item.label?.startsWith("Mode"))
    .submenu.find((item) => item.label === "Heat")
    .click();
  aircoMenu
    .find((item) => item.label?.startsWith("Target Temperature"))
    .submenu.find((item) => item.label === "22°C")
    .click();
  assert.deepEqual(actions, [
    ["probe", "living-room"],
    ["control", "living-room", "power", false],
    ["control", "living-room", "mode", "heat"],
    ["control", "living-room", "temperature", 22],
  ]);
});

test("desktop airco menu requires a status read before using the power toggle", () => {
  const airco = { ...fixtureSnapshot.aircos[0], reachable: null, lastState: null };
  const menu = buildAircoMenuItems({
    snapshot: { ...fixtureSnapshot, aircos: [airco] },
    onRefreshList() {},
    onProbe() {},
    onControl() {},
  });
  const aircoMenu = menu.find((item) => item.label === "Living room").submenu;
  assert.equal(aircoMenu[0].label, "Status not read yet");
  assert.equal(aircoMenu.find((item) => item.label?.startsWith("Power")).enabled, false);
});

test("desktop airco menu retains an unconfirmed-command notice until a later action succeeds", () => {
  const notices = new Map();
  recordAircoActionResult(notices, "living-room", { ...fixtureSnapshot, confirmed: false });
  const menu = buildAircoMenuItems({
    snapshot: fixtureSnapshot,
    notices,
    onRefreshList() {},
    onProbe() {},
    onControl() {},
  });
  const aircoMenu = menu.find((item) => item.label === "Living room").submenu;
  assert.equal(
    aircoMenu[0].label,
    "Sent — not confirmed · On · Cool · Room 24°C · Target 21°C",
  );

  recordAircoActionResult(notices, "living-room", { ...fixtureSnapshot, confirmed: true });
  assert.equal(notices.has("living-room"), false);
});

test("desktop menu rebuilds are deferred until the open native menu closes", () => {
  const deferred = [];
  const gate = new MenuRebuildGate({ defer: (action) => deferred.push(action) });
  let rebuilds = 0;
  const rebuild = () => rebuilds++;

  assert.equal(gate.request(rebuild), true);
  gate.willShow();
  assert.equal(gate.request(rebuild), false);
  assert.equal(gate.request(rebuild), false);
  assert.equal(rebuilds, 1);
  assert.equal(gate.willClose(rebuild), true);
  assert.equal(rebuilds, 1);
  assert.equal(deferred.length, 1);
  deferred[0]();
  assert.equal(rebuilds, 2);
});

class FakeChild extends EventEmitter {
  constructor() {
    super();
    this.pid = nextPid++;
    this.gracefulStops = 0;
  }

  kill() {
    this.gracefulStops += 1;
    queueMicrotask(() => this.emit("exit", 0));
    return true;
  }
}

function makeSupervisor(configuration, options = {}) {
  const children = [];
  const launcher = {
    async start() {
      const child = new FakeChild();
      children.push(child);
      return child;
    },
  };
  const supervisor = new BridgeSupervisor({
    configuration,
    launcher,
    healthCheck: async () => true,
    portCheck: async () => true,
    readyTimeout: 500,
    stopTimeout: 100,
    pollInterval: 1,
    monitorInterval: 20,
    ...options,
  });
  cleanup.add(() => supervisor.stop());
  return { supervisor, children, get starts() { return children.length; } };
}

test("desktop bridge starts and detects readiness without device traffic", async () => {
  const configuration = await testConfiguration();
  let checks = 0;
  const lifecycle = makeSupervisor(configuration, {
    healthCheck: async () => ++checks >= 2,
  });
  const result = await lifecycle.supervisor.start();
  assert.equal(result.started, true);
  assert.equal(lifecycle.supervisor.snapshot().status, "running");
  assert.equal(checks, 2);
});

test("desktop bridge stops gracefully before a forced termination", async () => {
  const configuration = await testConfiguration();
  let forced = 0;
  const lifecycle = makeSupervisor(configuration, { forceKill: () => forced++ });
  await lifecycle.supervisor.start();
  const child = lifecycle.children[0];
  const result = await lifecycle.supervisor.stop();
  assert.equal(result.stopped, true);
  assert.equal(lifecycle.supervisor.snapshot().status, "stopped");
  assert.equal(child.gracefulStops, 1);
  assert.equal(forced, 0);
});

test("desktop bridge restart replaces the managed process", async () => {
  const configuration = await testConfiguration();
  const lifecycle = makeSupervisor(configuration);
  await lifecycle.supervisor.start();
  const firstPid = lifecycle.supervisor.child.pid;
  const result = await lifecycle.supervisor.restart();
  assert.equal(result.started, true);
  assert.notEqual(lifecycle.supervisor.child.pid, firstPid);
  assert.equal(lifecycle.starts, 2);
});

test("desktop bridge prevents duplicate starts", async () => {
  const configuration = await testConfiguration();
  const lifecycle = makeSupervisor(configuration);
  await lifecycle.supervisor.start();
  const duplicate = await lifecycle.supervisor.start();
  assert.equal(duplicate.started, false);
  assert.equal(lifecycle.starts, 1);
  assert.equal(lifecycle.supervisor.snapshot().status, "running");
});

test("desktop bridge reports an unexpected child-process exit without restarting", async () => {
  const configuration = await testConfiguration();
  const lifecycle = makeSupervisor(configuration);
  await lifecycle.supervisor.start();
  lifecycle.children[0].emit("exit", 23);
  assert.equal(lifecycle.supervisor.snapshot().status, "error");
  assert.equal(lifecycle.supervisor.snapshot().error.code, "UNEXPECTED_EXIT");
  assert.equal(lifecycle.starts, 1);
});

test("sleep gap detector ignores ordinary ticks and reports wake-up jumps", () => {
  let clock = 1_000_000;
  const detector = createSleepGapDetector({ intervalMs: 2_000, now: () => clock });

  clock += 2_100;
  assert.equal(detector.tick(), 0);
  clock += 4_900;
  assert.equal(detector.tick(), 0, "coalesced timers stay below the five-second floor");
  clock += 6_000;
  assert.equal(detector.tick(), 6_000);
  clock += 90 * 60_000;
  assert.equal(detector.tick(), 90 * 60_000);
  clock += 2_000;
  assert.equal(detector.tick(), 0);
});

test("desktop bridge tolerates health failures immediately after a wake", async () => {
  const configuration = await testConfiguration();
  let healthy = true;
  const lifecycle = makeSupervisor(configuration, {
    monitorInterval: 60_000,
    healthCheck: async () => healthy,
  });
  await lifecycle.supervisor.start();

  healthy = false;
  await lifecycle.supervisor.resumeMonitoring({ graceMs: 15_000 });
  for (let index = 0; index < 5; index += 1) await lifecycle.supervisor.checkHealthOnce();

  assert.equal(lifecycle.supervisor.snapshot().status, "running");
  assert.equal(lifecycle.starts, 1);
});

test("desktop bridge restarts itself once a wake grace period expires", async () => {
  const configuration = await testConfiguration();
  let clock = 1_000_000;
  let failures = 0;
  const lifecycle = makeSupervisor(configuration, {
    monitorInterval: 60_000,
    recoveryDelay: 0,
    now: () => clock,
    healthCheck: async () => {
      if (failures === 0) return true;
      failures -= 1;
      return false;
    },
  });
  await lifecycle.supervisor.start();

  // One failure is spent inside the grace window, three after it; the restart
  // that follows then finds a healthy bridge.
  failures = 4;
  await lifecycle.supervisor.resumeMonitoring({ graceMs: 15_000 });
  clock += 20_000;
  for (let index = 0; index < 2; index += 1) await lifecycle.supervisor.checkHealthOnce();
  assert.equal(lifecycle.starts, 1, "two failures are not enough to restart");

  await lifecycle.supervisor.checkHealthOnce();
  assert.equal(lifecycle.starts, 2);
  assert.equal(lifecycle.supervisor.snapshot().status, "running");
});

test("desktop bridge reports an unhealthy bridge once recovery is exhausted", async () => {
  const configuration = await testConfiguration();
  let healthy = true;
  const lifecycle = makeSupervisor(configuration, {
    monitorInterval: 60_000,
    recoveryLimit: 0,
    healthCheck: async () => healthy,
  });
  await lifecycle.supervisor.start();

  healthy = false;
  for (let index = 0; index < 3; index += 1) await lifecycle.supervisor.checkHealthOnce();

  assert.equal(lifecycle.supervisor.snapshot().status, "error");
  assert.equal(lifecycle.supervisor.snapshot().error.code, "UNHEALTHY");
  assert.equal(lifecycle.starts, 1);
});

test("desktop bridge that died while asleep is restarted on resume", async () => {
  const configuration = await testConfiguration();
  const lifecycle = makeSupervisor(configuration);
  await lifecycle.supervisor.start();

  lifecycle.supervisor.pauseMonitoring();
  lifecycle.children[0].emit("exit", 1);
  assert.equal(lifecycle.supervisor.snapshot().status, "error");

  await lifecycle.supervisor.resumeMonitoring();
  assert.equal(lifecycle.starts, 2);
  assert.equal(lifecycle.supervisor.snapshot().status, "running");
});

test("desktop bridge stopped by the user stays stopped across a resume", async () => {
  const configuration = await testConfiguration();
  const lifecycle = makeSupervisor(configuration);
  await lifecycle.supervisor.start();
  await lifecycle.supervisor.stop();

  lifecycle.supervisor.pauseMonitoring();
  await lifecycle.supervisor.resumeMonitoring();

  assert.equal(lifecycle.starts, 1);
  assert.equal(lifecycle.supervisor.snapshot().status, "stopped");
});

test("sleep prevention is held only while the bridge runs", async () => {
  const started = [];
  const stopped = [];
  let nextId = 1;
  const powerSaveBlocker = {
    start(type) {
      started.push(type);
      return nextId++;
    },
    stop(id) {
      stopped.push(id);
    },
    isStarted: (id) => started.length > 0 && !stopped.includes(id),
  };
  const controller = createPowerSaveController({ powerSaveBlocker, preferred: false });

  assert.equal(controller.apply(true), false);
  assert.equal(started.length, 0);

  controller.setPreferred(true);
  assert.equal(controller.apply(false), false);
  assert.equal(started.length, 0);

  assert.equal(controller.apply(true), true);
  assert.deepEqual(started, ["prevent-app-suspension"]);
  assert.equal(controller.apply(true), true);
  assert.equal(started.length, 1, "the assertion is not taken twice");

  assert.equal(controller.apply(false), false);
  assert.deepEqual(stopped, [1]);
  assert.equal(controller.release(), false);
});

test("desktop preferences round-trip and fall back to safe defaults", async () => {
  const root = await temporaryDirectory();

  assert.deepEqual(await loadPreferences(root), { preventSleep: false });

  await savePreferences(root, { preventSleep: true });
  assert.deepEqual(await loadPreferences(root), { preventSleep: true });

  await writeFile(path.join(root, "preferences.json"), "{not json");
  assert.deepEqual(await loadPreferences(root), { preventSleep: false });

  await savePreferences(root, { preventSleep: "yes" });
  assert.deepEqual(await loadPreferences(root), { preventSleep: false });
});

test("desktop bridge reports a port conflict without launching a process", async () => {
  const configuration = await testConfiguration();
  const lifecycle = makeSupervisor(configuration, { portCheck: async () => false });
  const result = await lifecycle.supervisor.start();
  assert.equal(result.started, false);
  assert.equal(result.error.code, "PORT_IN_USE");
  assert.equal(lifecycle.starts, 0);
});

test("desktop configuration preserves state in Application Support without overwriting it", async () => {
  const root = await temporaryDirectory();
  const appSupportPath = path.join(root, "Application Support", "Sky Control");
  const legacyPath = path.join(root, "Application Support", "Sky Local");
  const customPath = path.join(root, "custom-device-state.json");
  await mkdir(appSupportPath, { recursive: true });
  await mkdir(path.join(legacyPath, "data"), { recursive: true });
  await writeFile(customPath, '{"version":1,"aircos":[]}\n');
  await writeFile(path.join(legacyPath, "data", "settings.json"), '{"version":1,"token":null}\n');
  await writeFile(
    path.join(appSupportPath, ".env.local"),
    `AIRCO_CONFIG_PATH=${customPath}\nAIRCO_SETTINGS_PATH=data/settings.json\nSKY_CONTROL_PORT=43123\n`,
  );

  const configuration = await loadDesktopConfiguration({
    appSupportPath,
    logsPath: path.join(root, "logs"),
    runtimeScript: "/fixture/standalone/server.js",
    environment: {},
  });
  await preserveConfiguration({ configuration, legacySupportPath: legacyPath });
  assert.equal(configuration.bridgeEnvironment.AIRCO_CONFIG_PATH, path.join(appSupportPath, "data", "aircos.json"));
  assert.equal(configuration.bindPort, 43123);
  assert.deepEqual(
    JSON.parse(await readFile(path.join(appSupportPath, "data", "aircos.json"), "utf8")),
    { version: 1, aircos: [] },
  );
  assert.deepEqual(
    JSON.parse(await readFile(path.join(appSupportPath, "data", "settings.json"), "utf8")),
    { version: 1, token: null },
  );

  await writeFile(path.join(appSupportPath, "data", "aircos.json"), '{"version":1,"aircos":["keep"]}\n');
  await preserveConfiguration({ configuration, legacySupportPath: legacyPath });
  assert.deepEqual(
    JSON.parse(await readFile(path.join(appSupportPath, "data", "aircos.json"), "utf8")),
    { version: 1, aircos: ["keep"] },
  );
});

test("desktop detects installed or running LaunchAgents on the configured port", async () => {
  const root = await temporaryDirectory();
  const username = "fixture-user";
  const [definition] = launchAgentDefinitions({ homeDirectory: root, username });
  await mkdir(path.dirname(definition.plistPath), { recursive: true });
  await mkdir(definition.supportPath, { recursive: true });
  await writeFile(definition.plistPath, "fixture plist\n");
  await writeFile(path.join(definition.supportPath, ".env.local"), "SKY_CONTROL_PORT=45678\n");
  const agents = await inspectLaunchAgents({
    homeDirectory: root,
    username,
    userId: 501,
    runExecFile: async (_command, args) => {
      if (args.at(-1).endsWith(definition.label)) return { stdout: "", stderr: "" };
      throw new Error("not loaded");
    },
  });
  assert.equal(agents[0].installed, true);
  assert.equal(agents[0].running, true);
  assert.equal(conflictingLaunchAgents(agents, 45678).length, 1);
  assert.equal(conflictingLaunchAgents(agents, 45679).length, 0);
});

test("desktop fails closed when an installed LaunchAgent has an invalid port", async () => {
  const root = await temporaryDirectory();
  const username = "fixture-user";
  const [definition] = launchAgentDefinitions({ homeDirectory: root, username });
  await mkdir(path.dirname(definition.plistPath), { recursive: true });
  await mkdir(definition.supportPath, { recursive: true });
  await writeFile(definition.plistPath, "fixture plist\n");
  await writeFile(path.join(definition.supportPath, ".env.local"), "SKY_CONTROL_PORT=invalid\n");

  const agents = await inspectLaunchAgents({
    homeDirectory: root,
    username,
    userId: 501,
    runExecFile: async () => {
      throw new Error("not loaded");
    },
  });
  assert.equal(agents[0].port, null);
  assert.equal(conflictingLaunchAgents(agents, 3000).length, 1);
  assert.equal(conflictingLaunchAgents(agents, 45679).length, 1);
});

test("explicit LaunchAgent migration unloads the service and preserves every plist backup", async () => {
  const root = await temporaryDirectory();
  const [agent] = launchAgentDefinitions({ homeDirectory: root, username: "fixture-user" });
  await mkdir(path.dirname(agent.plistPath), { recursive: true });
  await writeFile(agent.plistPath, "first plist\n");
  const calls = [];
  const runExecFile = async (command, args) => calls.push([command, args]);

  const firstBackup = await disableLaunchAgent(agent, 501, runExecFile);
  await writeFile(agent.plistPath, "second plist\n");
  const secondBackup = await disableLaunchAgent(agent, 501, runExecFile);

  assert.equal(firstBackup, `${agent.plistPath}.menu-bar-disabled`);
  assert.equal(secondBackup, `${agent.plistPath}.menu-bar-disabled-1`);
  assert.equal(await readFile(firstBackup, "utf8"), "first plist\n");
  assert.equal(await readFile(secondBackup, "utf8"), "second plist\n");
  assert.deepEqual(calls, [
    ["launchctl", ["bootout", "gui/501/com.fixture-user.sky-control"]],
    ["launchctl", ["bootout", "gui/501/com.fixture-user.sky-control"]],
  ]);
});

test("packaging checks the checkout and the builder's home folder", () => {
  const needles = personalPathNeedles("/Users/kim/src/sky-control", {}, "/Users/kim");
  assert.deepEqual(needles.map(String), ["/Users/kim/src/sky-control", "/Users/kim"]);
});

test("packaging on GitHub runners skips the shared runner home folder", () => {
  // Prebuilt binaries compiled on GitHub runners embed /Users/runner/work/…
  // paths, which say nothing about who built this package.
  const checkout = "/Users/runner/work/sky-control/sky-control";
  const needles = personalPathNeedles(checkout, { GITHUB_ACTIONS: "true" }, "/Users/runner");
  assert.deepEqual(needles.map(String), [checkout]);
  const libvips = Buffer.from("/Users/runner/work/sharp-libvips/sharp-libvips/target/lib");
  assert.equal(needles.some((needle) => libvips.includes(needle)), false);
});
