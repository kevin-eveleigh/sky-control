import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { getBridgeConfig } from "../bridge/config";
import { normalizeNetworkHost } from "../network";
import type { AircoConfig, AircoInput, DeviceInfo } from "./types";

type ConfigFile = { version: 1; aircos: AircoConfig[] };

function configPath(): string {
  return getBridgeConfig().configPath;
}

/**
 * A fresh install starts with no aircos and sends the user to the scan flow.
 * AIRCO_HOST seeds a single unit for anyone who prefers to configure it up
 * front; nothing else is guessed, because MAC, module name and protocol are
 * properties of a specific unit and can only come from discovery.
 */
function seededAircos(): AircoConfig[] {
  const { deviceSeedHost: host, deviceSeedPort: port } = getBridgeConfig();
  if (!host) return [];
  return [
    {
      id: randomUUID(),
      displayName: "Airco 1",
      location: "Unassigned",
      host,
      port,
    },
  ];
}

/**
 * Persists the seed so its generated id stays stable across requests — an id
 * that changed on every read would break every lookup that follows. An empty
 * list needs no file and is written once the user adds something.
 */
function initialAircos(): AircoConfig[] {
  const seeded = seededAircos();
  if (seeded.length) writeConfig(seeded);
  return seeded;
}

function cleanText(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value.trim().slice(0, 80) : fallback;
}

function normalizeAirco(value: unknown, index: number): AircoConfig | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<AircoConfig>;
  let host: string;
  try {
    host = normalizeNetworkHost(candidate.host, "IP address or hostname");
  } catch {
    return null;
  }
  const port = Number(candidate.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
  return {
    id: cleanText(candidate.id) || `airco-${index + 1}`,
    displayName: cleanText(candidate.displayName) || `Airco ${index + 1}`,
    location: cleanText(candidate.location) || "Unassigned",
    host,
    port,
    mac: cleanText(candidate.mac) || undefined,
    deviceName: cleanText(candidate.deviceName) || undefined,
    model: cleanText(candidate.model) || undefined,
    protocol: cleanText(candidate.protocol) || undefined,
  };
}

function writeConfig(aircos: AircoConfig[]): void {
  const target = configPath();
  mkdirSync(path.dirname(target), { recursive: true });
  const temporary = `${target}.new`;
  writeFileSync(
    temporary,
    `${JSON.stringify({ version: 1, aircos } satisfies ConfigFile, null, 2)}\n`,
    { encoding: "utf8", mode: 0o600 },
  );
  renameSync(temporary, target);
}

/**
 * Moves an unreadable config aside instead of letting the next write silently
 * overwrite it. Without this, one bad parse turns into permanent data loss the
 * moment the user adds or edits an airco.
 */
function quarantine(target: string, reason: unknown): void {
  const detail = reason instanceof Error ? reason.message : String(reason);
  const backup = `${target}.corrupt-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  try {
    renameSync(target, backup);
    console.error(
      `[sky-control] Device configuration is unreadable (${detail}); moved aside as ${path.basename(backup)}.`,
    );
  } catch {
    console.error("[sky-control] Device configuration is unreadable and could not be moved aside.");
  }
}

function withUniqueIds(aircos: AircoConfig[]): AircoConfig[] {
  const seen = new Set<string>();
  return aircos.map((airco, index) => {
    if (!seen.has(airco.id)) {
      seen.add(airco.id);
      return airco;
    }
    const id = `${airco.id}-${index + 1}`;
    seen.add(id);
    return { ...airco, id };
  });
}

export function getAircos(): AircoConfig[] {
  const target = configPath();
  if (!existsSync(target)) return initialAircos();
  try {
    const parsed = JSON.parse(readFileSync(target, "utf8")) as Partial<ConfigFile>;
    if (!Array.isArray(parsed.aircos)) throw new Error("Invalid airco list");
    const aircos = parsed.aircos
      .map(normalizeAirco)
      .filter((airco): airco is AircoConfig => airco !== null);
    // An empty list is a legitimate state (the user removed every unit), but a
    // non-empty file that yields nothing usable is corruption.
    if (parsed.aircos.length > 0 && aircos.length === 0) {
      throw new Error("No readable airco entries");
    }
    return withUniqueIds(aircos);
  } catch (error) {
    quarantine(target, error);
    return initialAircos();
  }
}

export function validateAircoInput(input: AircoInput, fallbackName: string): AircoInput {
  const host = normalizeNetworkHost(input.host, "IP address or hostname");
  const port = Number(input.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("Port must be between 1 and 65535");
  }
  return {
    displayName: cleanText(input.displayName) || fallbackName,
    location: cleanText(input.location) || "Unassigned",
    host,
    port,
    mac: cleanText(input.mac) || undefined,
    deviceName: cleanText(input.deviceName) || undefined,
    model: cleanText(input.model) || undefined,
    protocol: cleanText(input.protocol) || undefined,
  };
}

export function addAirco(input: AircoInput): AircoConfig {
  const aircos = getAircos();
  const normalized = validateAircoInput(input, `Airco ${aircos.length + 1}`);
  const duplicate = aircos.find(
    (airco) =>
      (normalized.mac && airco.mac?.toLowerCase() === normalized.mac.toLowerCase()) ||
      airco.host === normalized.host,
  );
  if (duplicate) throw new Error("That airco is already configured");
  const airco = { id: randomUUID(), ...normalized };
  writeConfig([...aircos, airco]);
  return airco;
}

export function updateAirco(id: string, input: AircoInput): AircoConfig {
  const aircos = getAircos();
  const index = aircos.findIndex((airco) => airco.id === id);
  if (index < 0) throw new Error("Airco not found");
  const updated = {
    id,
    ...validateAircoInput(input, aircos[index].displayName),
  };
  aircos[index] = updated;
  writeConfig(aircos);
  return updated;
}

export function removeAirco(id: string): boolean {
  const aircos = getAircos();
  const remaining = aircos.filter((airco) => airco.id !== id);
  if (remaining.length === aircos.length) return false;
  writeConfig(remaining);
  return true;
}

export function findAirco(id: string): AircoConfig | null {
  return getAircos().find((airco) => airco.id === id) || null;
}

export function refreshKnownDevices(devices: DeviceInfo[]): AircoConfig[] {
  const aircos = getAircos();
  let changed = false;
  const updated = aircos.map((airco) => {
    const match = devices.find(
      (device) =>
        (airco.mac && device.mac?.toLowerCase() === airco.mac.toLowerCase()) ||
        device.host === airco.host,
    );
    if (!match) return airco;
    const next: AircoConfig = {
      ...airco,
      host: match.host || airco.host,
      // `port` is deliberately preserved: the UDP discovery reply carries no
      // port, so DeviceInfo.port is only a default for units being added.
      mac: match.mac || airco.mac,
      deviceName: match.name || airco.deviceName,
      model: match.model || airco.model,
      protocol: match.protocol || airco.protocol,
    };
    if (JSON.stringify(next) !== JSON.stringify(airco)) changed = true;
    return next;
  });
  if (changed) writeConfig(updated);
  return updated;
}
