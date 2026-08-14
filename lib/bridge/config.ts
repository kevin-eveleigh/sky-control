import path from "node:path";
import { DEFAULT_CONTROL_PORT } from "../airco/constants";
import { normalizeNetworkHost } from "../network";
import { MIN_TOKEN_LENGTH } from "./constants";

export type BridgeConfig = {
  bindHost: string;
  bindPort: number;
  deviceSeedHost: string | null;
  deviceSeedPort: number;
  configPath: string;
  settingsPath: string;
  token: string | null;
};

type Environment = Record<string, string | undefined>;

function parsePort(value: string | undefined, fallback: number, label: string): number {
  if (value === undefined || value.trim() === "") return fallback;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`${label} must be an integer between 1 and 65535`);
  }
  return port;
}

function cleanPath(value: string | undefined, fallback: string): string {
  const configured = value?.trim() || fallback;
  return path.isAbsolute(configured) ? configured : path.join(process.cwd(), configured);
}

export function parseBridgeConfig(env: Environment): BridgeConfig {
  const token = env.AIRCO_TOKEN?.trim() || null;
  if (token && token.length < MIN_TOKEN_LENGTH) {
    throw new Error(`AIRCO_TOKEN must contain at least ${MIN_TOKEN_LENGTH} characters`);
  }

  return {
    bindHost: normalizeNetworkHost(env.SKY_CONTROL_HOST || "0.0.0.0", "SKY_CONTROL_HOST"),
    bindPort: parsePort(env.SKY_CONTROL_PORT, 3000, "SKY_CONTROL_PORT"),
    deviceSeedHost: env.AIRCO_HOST?.trim()
      ? normalizeNetworkHost(env.AIRCO_HOST, "AIRCO_HOST")
      : null,
    deviceSeedPort: parsePort(env.AIRCO_PORT, DEFAULT_CONTROL_PORT, "AIRCO_PORT"),
    configPath: cleanPath(env.AIRCO_CONFIG_PATH, "data/aircos.json"),
    settingsPath: cleanPath(env.AIRCO_SETTINGS_PATH, "data/settings.json"),
    token,
  };
}

let cachedEnvironment: Environment | null = null;
let cachedConfig: BridgeConfig | null = null;

export function getBridgeConfig(): BridgeConfig {
  if (cachedEnvironment !== process.env || !cachedConfig) {
    cachedEnvironment = process.env;
    cachedConfig = parseBridgeConfig(process.env);
  }
  return cachedConfig;
}
