import { copyFile, mkdir, readFile, stat } from "node:fs/promises";
import { isIP } from "node:net";
import path from "node:path";

const STATE_FILES = ["aircos.json", "settings.json"];

export function parseEnvText(text) {
  const values = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator < 1) continue;
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }
  return values;
}

export function validateDesktopHost(value) {
  const host = value?.trim() || "0.0.0.0";
  const hostname = /^[a-z0-9.-]+$/i.test(host) && !host.startsWith("-") && !host.endsWith("-");
  if (!isIP(host) && !hostname) {
    throw new Error("The configured bridge address is invalid.");
  }
  return host;
}

export function validateDesktopPort(value) {
  const port = value === undefined || String(value).trim() === "" ? 3000 : Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("The configured bridge port must be between 1 and 65535.");
  }
  return port;
}

export function controllerHost(bindHost) {
  return bindHost === "0.0.0.0" || bindHost === "::" ? "127.0.0.1" : bindHost;
}

export function controllerUrl(bindHost, bindPort) {
  const host = controllerHost(bindHost);
  const displayHost = isIP(host) === 6 ? `[${host}]` : host;
  return `http://${displayHost}:${bindPort}`;
}

async function readOptionalEnv(file) {
  try {
    return parseEnvText(await readFile(file, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return {};
    throw error;
  }
}

export async function loadDesktopConfiguration({
  appSupportPath,
  logsPath,
  runtimeScript,
  environment = process.env,
}) {
  const fileEnvironment = await readOptionalEnv(path.join(appSupportPath, ".env.local"));
  const combined = { ...fileEnvironment };
  for (const [key, value] of Object.entries(environment)) {
    if (value !== undefined) combined[key] = value;
  }

  const bindHost = validateDesktopHost(combined.SKY_CONTROL_HOST);
  const bindPort = validateDesktopPort(combined.SKY_CONTROL_PORT);
  const dataPath = path.join(appSupportPath, "data");
  const bridgeEnvironment = {
    ...combined,
    NODE_ENV: "production",
    HOSTNAME: bindHost,
    PORT: String(bindPort),
    SKY_CONTROL_HOST: bindHost,
    SKY_CONTROL_PORT: String(bindPort),
    AIRCO_CONFIG_PATH: path.join(dataPath, "aircos.json"),
    AIRCO_SETTINGS_PATH: path.join(dataPath, "settings.json"),
    NODE_PATH: path.join(path.dirname(runtimeScript), "runtime_modules"),
  };

  return {
    appSupportPath,
    logsPath,
    dataPath,
    runtimeScript,
    bindHost,
    bindPort,
    controllerUrl: controllerUrl(bindHost, bindPort),
    bridgeEnvironment,
    configuredStatePaths: {
      aircos: fileEnvironment.AIRCO_CONFIG_PATH,
      settings: fileEnvironment.AIRCO_SETTINGS_PATH,
    },
  };
}

async function isFile(file) {
  try {
    return (await stat(file)).isFile();
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

function sourcePath(value, baseDirectory) {
  if (!value?.trim()) return null;
  const configured = value.trim();
  return path.isAbsolute(configured)
    ? configured
    : path.resolve(baseDirectory, configured);
}

/** Copy-only migration: existing destination files always win and are never overwritten. */
export async function preserveConfiguration({ configuration, legacySupportPath }) {
  await mkdir(configuration.dataPath, { recursive: true, mode: 0o700 });
  const preserved = [];

  for (const fileName of STATE_FILES) {
    const destination = path.join(configuration.dataPath, fileName);
    if (await isFile(destination)) continue;

    const configuredValue =
      fileName === "aircos.json"
        ? configuration.configuredStatePaths.aircos
        : configuration.configuredStatePaths.settings;
    const candidates = [
      sourcePath(configuredValue, configuration.appSupportPath),
      legacySupportPath ? path.join(legacySupportPath, "data", fileName) : null,
    ].filter(Boolean);

    for (const candidate of candidates) {
      if (path.resolve(candidate) === path.resolve(destination) || !(await isFile(candidate))) continue;
      await copyFile(candidate, destination);
      preserved.push({ fileName, source: candidate, destination });
      break;
    }
  }

  return preserved;
}
