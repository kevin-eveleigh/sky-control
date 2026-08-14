import { isAuthManagedByEnv, isAuthRequired } from "../bridge-auth";
import { getAircos } from "./config";
import type {
  AircoState,
  BridgeSnapshot,
  LogEntry,
  ProtocolSummary,
  RuntimeDiagnostics,
} from "./types";

type RuntimeState = {
  reachable: boolean | null;
  lastSeen: string | null;
  lastState: AircoState | null;
  diagnostics: RuntimeDiagnostics;
  logs: LogEntry[];
};

const globalBridge = globalThis as typeof globalThis & {
  __skyControlRuntime?: Map<string, RuntimeState>;
};

function runtimeMap(): Map<string, RuntimeState> {
  if (!globalBridge.__skyControlRuntime) globalBridge.__skyControlRuntime = new Map();
  return globalBridge.__skyControlRuntime;
}

export function getRuntime(id: string): RuntimeState {
  const runtimes = runtimeMap();
  let runtime = runtimes.get(id);
  if (!runtime) {
    runtime = {
      reachable: null,
      lastSeen: null,
      lastState: null,
      diagnostics: { operation: null, normalizedError: null, protocol: null },
      logs: [
        {
          at: new Date().toISOString(),
          level: "info",
          message: "Ready for local control.",
        },
      ],
    };
    runtimes.set(id, runtime);
  }
  return runtime;
}

export function addLog(
  id: string,
  level: LogEntry["level"],
  message: string,
): void {
  const runtime = getRuntime(id);
  runtime.logs = [
    { at: new Date().toISOString(), level, message },
    ...runtime.logs,
  ].slice(0, 30);
}

/** Returns true when the value actually changed, so background polling can
 *  stay silent until something is worth reporting. */
export function updateReachability(id: string, reachable: boolean): boolean {
  const runtime = getRuntime(id);
  const changed = runtime.reachable !== reachable;
  runtime.reachable = reachable;
  if (reachable) runtime.lastSeen = new Date().toISOString();
  return changed;
}

export function updateState(id: string, state: AircoState): void {
  const runtime = getRuntime(id);
  runtime.lastState = { ...runtime.lastState, ...state };
  runtime.lastSeen = new Date().toISOString();
}

export function recordDiagnostics(
  id: string,
  operation: string,
  protocol: ProtocolSummary | null,
  normalizedError?: string,
): void {
  getRuntime(id).diagnostics = {
    operation,
    normalizedError: normalizedError || null,
    protocol: protocol ? { ...protocol } : null,
  };
}

export function getRuntimeDiagnostics(id: string): RuntimeDiagnostics {
  const diagnostics = getRuntime(id).diagnostics;
  return {
    ...diagnostics,
    protocol: diagnostics.protocol ? { ...diagnostics.protocol } : null,
  };
}

export function removeRuntime(id: string): void {
  runtimeMap().delete(id);
}

export function publicSnapshot(): BridgeSnapshot {
  return {
    aircos: getAircos().map((airco) => {
      const runtime = getRuntime(airco.id);
      return {
        ...airco,
        reachable: runtime.reachable,
        lastSeen: runtime.lastSeen,
        lastState: runtime.lastState ? { ...runtime.lastState } : null,
        logs: [...runtime.logs],
      };
    }),
    authRequired: isAuthRequired(),
    authManagedByEnv: isAuthManagedByEnv(),
  };
}
