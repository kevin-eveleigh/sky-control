import { getBridgeConfig } from "./bridge/config";
import { isAuthRequired } from "./bridge-auth";
import { getAircos } from "./airco/config";
import { getRuntimeDiagnostics } from "./airco/store";
import type { AircoConfig, RuntimeDiagnostics } from "./airco/types";
import { PROJECT, PROJECT_DISCLAIMER } from "./project";

export type DiagnosticReport = {
  schemaVersion: 1;
  createdAt: string;
  notice: string;
  software: {
    name: string;
    version: string;
    node: string;
    protocolFamily: "Skyworth SWM100";
  };
  bridge: {
    authenticationEnabled: boolean;
    bindPort: number;
  };
  devices: Array<{
    reportedModel: string | null;
    reportedProtocol: string | null;
    reportedName: "redacted" | "not reported";
    networkAddress: "redacted";
    macAddress: "redacted" | "not reported";
    lastOperation: string | null;
    normalizedError: string | null;
    protocolSummary: {
      receivedBytes: number;
      validFrames: number;
      stateFrameReceived: boolean;
    } | null;
  }>;
};

export function sanitizeDeviceDiagnostics(
  device: AircoConfig,
  runtime: RuntimeDiagnostics,
): DiagnosticReport["devices"][number] {
  return {
    reportedModel: device.model || null,
    reportedProtocol: device.protocol || null,
    reportedName: device.deviceName ? "redacted" : "not reported",
    networkAddress: "redacted",
    macAddress: device.mac ? "redacted" : "not reported",
    lastOperation: runtime.operation,
    normalizedError: runtime.normalizedError,
    protocolSummary: runtime.protocol,
  };
}

export function createDiagnosticReport(deviceId?: string): DiagnosticReport {
  const config = getBridgeConfig();
  const devices = getAircos()
    .filter((device) => !deviceId || device.id === deviceId)
    .map((device) => sanitizeDeviceDiagnostics(device, getRuntimeDiagnostics(device.id)));

  return {
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    notice: PROJECT_DISCLAIMER,
    software: {
      name: PROJECT.name,
      version: PROJECT.version,
      node: process.versions.node,
      protocolFamily: "Skyworth SWM100",
    },
    bridge: {
      authenticationEnabled: isAuthRequired(),
      bindPort: config.bindPort,
    },
    devices,
  };
}
