import dgram from "node:dgram";
import { lookup } from "node:dns/promises";
import { isIPv4 } from "node:net";
import { DEFAULT_CONTROL_PORT } from "./constants";
import type { DeviceInfo } from "./types";

export { DEFAULT_CONTROL_PORT } from "./constants";

type DiscoveryTarget = {
  bindPort: number;
  destination: string;
  destinationPort: number;
  multicast?: string;
};

const PROBE = Buffer.from([0xbe, 0x01]);
const ATTEMPTS = 3;
const ATTEMPT_GAP_MS = 350;
const LISTEN_MS = 2400;
const DISCOVERY_PORT = 1995;

const TARGETS: DiscoveryTarget[] = [
  { bindPort: 1992, destination: "255.255.255.255", destinationPort: DISCOVERY_PORT },
  {
    bindPort: 1990,
    destination: "239.253.0.1",
    destinationPort: 1993,
    multicast: "239.253.0.1",
  },
];

export function parseDiscoveryReply(
  message: Buffer,
  host: string,
  controlPort = DEFAULT_CONTROL_PORT,
): DeviceInfo | null {
  if (message.length < 4 || message[0] !== 0xbe || message[1] !== 0x02) {
    return null;
  }

  const fields = new Map<number, Buffer>();
  let offset = 2;
  while (offset + 2 <= message.length) {
    const id = message[offset];
    const length = message[offset + 1];
    offset += 2;
    if (offset + length > message.length) return null;
    fields.set(id, message.subarray(offset, offset + length));
    offset += length;
  }

  const macBytes = fields.get(1);
  return {
    host,
    // The discovery reply carries no TCP port. This is the port to try for a
    // newly added unit, never a value to write back over a configured airco.
    port: controlPort,
    mac: macBytes
      ? [...macBytes].map((byte) => byte.toString(16).padStart(2, "0")).join(":")
      : undefined,
    name: fields.get(5)?.toString("utf8"),
    model: fields.get(3)?.toString("hex"),
    protocol: fields.get(4)?.toString("hex"),
  };
}

type Exchange = {
  /** 0 lets the OS pick a port; units reply to whichever port asked. */
  bindPort: number;
  destination: string;
  destinationPort: number;
  broadcast?: boolean;
  multicast?: string;
  /** Return true once the answer is in, to stop listening early. */
  onMessage: (message: Buffer, remote: dgram.RemoteInfo) => boolean | void;
};

function exchange(options: Exchange) {
  return new Promise<void>((resolve, reject) => {
    const socket = dgram.createSocket({ type: "udp4", reuseAddr: true });
    const timers = new Set<ReturnType<typeof setTimeout>>();
    let closed = false;

    // Every socket operation below is reached from a timer, so a socket that
    // errors or closes early must cancel the pending work. Otherwise the throw
    // lands outside any promise and takes the whole server process down.
    const shutdown = (error?: Error) => {
      if (closed) return;
      closed = true;
      for (const timer of timers) clearTimeout(timer);
      timers.clear();
      try {
        socket.close();
      } catch {
        // Already closed by the error that brought us here.
      }
      if (error) reject(error);
      else resolve();
    };

    const later = (run: () => void, ms: number) => {
      const timer = setTimeout(() => {
        timers.delete(timer);
        if (closed) return;
        try {
          run();
        } catch (error) {
          shutdown(error as Error);
        }
      }, ms);
      timers.add(timer);
    };

    socket.once("error", shutdown);
    socket.on("message", (message, remote) => {
      if (options.onMessage(message, remote)) shutdown();
    });

    socket.bind(options.bindPort, () => {
      try {
        if (options.broadcast) socket.setBroadcast(true);
        if (options.multicast) socket.addMembership(options.multicast);
        for (let attempt = 0; attempt < ATTEMPTS; attempt += 1) {
          later(() => {
            // The callback keeps a send failure from surfacing as an
            // unhandled 'error' event on an otherwise healthy scan.
            socket.send(PROBE, options.destinationPort, options.destination, () => {});
          }, attempt * ATTEMPT_GAP_MS);
        }
        later(() => shutdown(), LISTEN_MS);
      } catch (error) {
        shutdown(error as Error);
      }
    });
  });
}

function listen(target: DiscoveryTarget, found: Map<string, DeviceInfo>) {
  return exchange({
    ...target,
    broadcast: true,
    onMessage(message, remote) {
      const device = parseDiscoveryReply(message, remote.address);
      if (device) found.set(device.mac || device.host, device);
    },
  });
}

export async function discoverDevices(): Promise<DeviceInfo[]> {
  const found = new Map<string, DeviceInfo>();
  const results = await Promise.allSettled(
    TARGETS.map((target) => listen(target, found)),
  );
  const failures = results.filter(
    (result): result is PromiseRejectedResult => result.status === "rejected",
  );
  if (failures.length === TARGETS.length) throw failures[0].reason;
  return [...found.values()];
}

/**
 * Asks one known address to identify itself. Broadcast and multicast stop at
 * the edge of the local network, but this is a plain unicast datagram, so it
 * also reaches a unit through a routed VPN. Returns null when nothing
 * compatible answers in time.
 */
export async function identifyDevice(
  host: string,
  { controlPort = DEFAULT_CONTROL_PORT, discoveryPort = DISCOVERY_PORT } = {},
): Promise<DeviceInfo | null> {
  // Replies come from an IP address, so a hostname has to be resolved first
  // for the answer to be matched to the unit that was asked.
  const address = isIPv4(host) ? host : (await lookup(host, { family: 4 })).address;
  let device: DeviceInfo | null = null;
  await exchange({
    bindPort: 0,
    destination: address,
    destinationPort: discoveryPort,
    onMessage(message, remote) {
      if (remote.address !== address) return false;
      // Keep what the user typed: a hostname survives a DHCP change, the
      // address it resolved to today might not.
      device = parseDiscoveryReply(message, host, controlPort);
      return device !== null;
    },
  });
  return device;
}
