import net from "node:net";
import {
  STATUS_QUERY,
  buildControlFrame,
  consumeFrames,
  isStateFrame,
  parseState,
  type ControlRequest,
} from "./protocol";
import type { AircoState, ProtocolSummary } from "./types";

const HEARTBEAT = Buffer.from("ae0000", "hex");

type SessionResult = {
  reachable: boolean;
  frame: Buffer | null;
  /** A post-command status frame was received, not merely the initial state. */
  confirmed: boolean;
  summary: ProtocolSummary;
  error?: string;
};

export type ProbeResult = {
  reachable: boolean;
  state: AircoState | null;
  confirmed: boolean;
  summary: ProtocolSummary;
  error?: string;
};

/** Stable, non-sensitive errors are suitable for logs and issue reports. */
export function normalizeNetworkError(error: unknown): string {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  if (code === "ECONNREFUSED") return "CONNECTION_REFUSED";
  if (code === "EHOSTUNREACH" || code === "ENETUNREACH") return "HOST_UNREACHABLE";
  if (code === "ETIMEDOUT") return "CONNECTION_TIMEOUT";
  if (code === "EADDRNOTAVAIL") return "ADDRESS_UNAVAILABLE";
  return code && /^[A-Z0-9_]+$/.test(code) ? code : "NETWORK_ERROR";
}

function runSession(
  host: string,
  port: number,
  request?: ControlRequest,
): Promise<SessionResult> {
  return new Promise((resolve) => {
    const timers = new Set<ReturnType<typeof setTimeout>>();
    let receivedBytes = 0;
    let validFrames = 0;
    let pending: Buffer = Buffer.alloc(0);
    let beforeCommand: Buffer | null = null;
    let afterCommand: Buffer | null = null;
    let connected = false;
    let commandSent = false;
    let settled = false;
    let errorMessage: string | undefined;
    const socket = net.createConnection({ host, port });

    const later = (run: () => void, ms: number) => {
      const timer = setTimeout(() => {
        timers.delete(timer);
        if (!settled) run();
      }, ms);
      timers.add(timer);
    };

    const write = (payload: Buffer) => {
      if (!settled && !socket.destroyed) socket.write(payload);
    };

    const finish = () => {
      if (settled) return;
      settled = true;
      for (const timer of timers) clearTimeout(timer);
      timers.clear();
      socket.destroy();
      const frame = afterCommand || beforeCommand;
      resolve({
        reachable: connected || receivedBytes > 0,
        frame,
        confirmed: request ? afterCommand !== null : beforeCommand !== null,
        summary: {
          receivedBytes,
          validFrames,
          stateFrameReceived: frame !== null,
        },
        error: errorMessage,
      });
    };

    socket.setTimeout(6000);
    socket.on("connect", () => {
      connected = true;
      write(STATUS_QUERY);
      later(() => write(HEARTBEAT), 20);
      later(finish, request ? 5000 : 2500);
    });

    socket.on("data", (chunk) => {
      receivedBytes += chunk.length;
      pending = Buffer.concat([pending, chunk]);
      const { frames, rest } = consumeFrames(pending);
      pending = rest;
      validFrames += frames.length;
      for (const frame of frames) {
        if (!isStateFrame(frame)) continue;
        if (commandSent) afterCommand = frame;
        else beforeCommand = frame;
      }

      if (request && !commandSent) {
        if (!beforeCommand) return;
        commandSent = true;
        write(buildControlFrame(beforeCommand, request));
        later(() => write(HEARTBEAT), 180);
        later(() => write(STATUS_QUERY), 400);
        return;
      }
      if (commandSent ? afterCommand : beforeCommand) later(finish, 120);
    });

    socket.on("timeout", finish);
    socket.on("error", (error) => {
      errorMessage = normalizeNetworkError(error);
      finish();
    });
    socket.on("close", finish);
  });
}

function toProbeResult(result: SessionResult): ProbeResult {
  return {
    reachable: result.reachable,
    state: result.frame ? parseState(result.frame) : null,
    confirmed: result.confirmed,
    summary: result.summary,
    error: result.error,
  };
}

export async function probeStatus(host: string, port: number): Promise<ProbeResult> {
  return toProbeResult(await runSession(host, port));
}

export async function sendControl(
  host: string,
  port: number,
  request: ControlRequest,
): Promise<ProbeResult> {
  return toProbeResult(await runSession(host, port, request));
}
