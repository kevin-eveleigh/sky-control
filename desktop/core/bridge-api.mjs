import { readFile } from "node:fs/promises";
import path from "node:path";

const CONTROL_ACTIONS = new Set(["power", "mode", "temperature"]);

export class BridgeApiError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "BridgeApiError";
    this.code = code;
  }
}

async function readStoredToken(settingsPath) {
  try {
    const settings = JSON.parse(await readFile(settingsPath, "utf8"));
    return typeof settings?.token === "string" && settings.token.trim()
      ? settings.token.trim()
      : null;
  } catch (error) {
    if (error?.code === "ENOENT" || error instanceof SyntaxError) return null;
    throw error;
  }
}

function validateControl(action, value) {
  if (!CONTROL_ACTIONS.has(action)) {
    throw new BridgeApiError("INVALID_CONTROL", "That control is not available from the menu.");
  }
  if (action === "power" && typeof value !== "boolean") {
    throw new BridgeApiError("INVALID_CONTROL", "The power setting is invalid.");
  }
  if (
    action === "mode" &&
    !["auto", "cool", "dry", "fan", "heat"].includes(value)
  ) {
    throw new BridgeApiError("INVALID_CONTROL", "The mode setting is invalid.");
  }
  if (
    action === "temperature" &&
    (!Number.isInteger(value) || value < 16 || value > 30)
  ) {
    throw new BridgeApiError("INVALID_CONTROL", "The temperature setting is invalid.");
  }
}

function errorForStatus(status) {
  if (status === 401) {
    return new BridgeApiError(
      "UNAUTHORIZED",
      "The menu could not authenticate with the local bridge.",
    );
  }
  if (status === 404) {
    return new BridgeApiError("AIRCO_NOT_FOUND", "That air conditioner is no longer configured.");
  }
  if (status === 502) {
    return new BridgeApiError("DEVICE_UNAVAILABLE", "The air conditioner did not respond.");
  }
  return new BridgeApiError("BRIDGE_REQUEST_FAILED", "The local bridge could not complete the request.");
}

export class BridgeApi {
  constructor({ configuration, fetchImpl = globalThis.fetch, timeoutMs = 8_000 }) {
    this.configuration = configuration;
    this.fetchImpl = fetchImpl;
    this.timeoutMs = timeoutMs;
  }

  async token() {
    const managed = this.configuration.bridgeEnvironment?.AIRCO_TOKEN;
    if (typeof managed === "string" && managed.trim()) return managed.trim();
    return readStoredToken(path.join(this.configuration.dataPath, "settings.json"));
  }

  async request(route, options = {}) {
    const token = await this.token();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    const headers = { accept: "application/json", ...options.headers };
    if (token) headers.authorization = `Bearer ${token}`;

    try {
      const response = await this.fetchImpl(`${this.configuration.controllerUrl}${route}`, {
        ...options,
        cache: "no-store",
        headers,
        signal: controller.signal,
      });
      if (!response.ok) throw errorForStatus(response.status);
      const result = await response.json().catch(() => null);
      if (!result || !Array.isArray(result.aircos)) {
        throw new BridgeApiError("INVALID_RESPONSE", "The local bridge returned an invalid response.");
      }
      return result;
    } catch (error) {
      if (error instanceof BridgeApiError) throw error;
      if (error?.name === "AbortError") {
        throw new BridgeApiError("BRIDGE_TIMEOUT", "The local bridge did not respond in time.");
      }
      throw new BridgeApiError("BRIDGE_UNAVAILABLE", "The local bridge is unavailable.");
    } finally {
      clearTimeout(timeout);
    }
  }

  snapshot() {
    return this.request("/api/aircos");
  }

  probe(aircoId) {
    return this.request("/api/probe", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ aircoId, background: false }),
    });
  }

  control(aircoId, action, value) {
    validateControl(action, value);
    return this.request("/api/control", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ aircoId, action, value }),
    });
  }
}
