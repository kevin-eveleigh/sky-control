/**
 * Protocol research tool: flip a single bit in a status byte and watch what
 * the indoor unit does.
 *
 *   node --experimental-strip-types support/poke-bit.mjs <byte> <mask> <on|off>
 *   node --experimental-strip-types support/poke-bit.mjs 16 0x40 on
 *   node --experimental-strip-types support/poke-bit.mjs 16 0x40 off
 *   node --experimental-strip-types support/poke-bit.mjs            # read only
 *
 * `byte` is the index in the 28-byte status frame. Only 13-16 are carried in a
 * control frame, so only those can be written. Host and port come from
 * AIRCO_HOST / AIRCO_PORT, defaulting to the first entry in data/aircos.json.
 *
 * This writes to real hardware. Note the "before" line it prints — that is what
 * you pass back to restore the previous value.
 */
import net from "node:net";
import { readFileSync } from "node:fs";

const FIRST_WRITABLE = 13;
const LAST_WRITABLE = 16;

function defaultTarget() {
  try {
    const config = JSON.parse(readFileSync(new URL("../data/aircos.json", import.meta.url), "utf8"));
    const first = config.aircos?.[0];
    if (first?.host) return { host: first.host, port: Number(first.port) || 1998 };
  } catch {
    // Fall through to the environment defaults.
  }
  return { host: process.env.AIRCO_HOST, port: Number(process.env.AIRCO_PORT || 1998) };
}

const { host, port } = {
  host: process.env.AIRCO_HOST || defaultTarget().host,
  port: Number(process.env.AIRCO_PORT || defaultTarget().port),
};

if (!host) {
  console.error("No airco host. Set AIRCO_HOST or add one to data/aircos.json.");
  process.exit(1);
}

const [byteArg, maskArg, stateArg] = process.argv.slice(2);
const readOnly = byteArg === undefined;

let byteIndex;
let mask;
let turnOn;
if (!readOnly) {
  byteIndex = Number(byteArg);
  mask = Number(maskArg);
  turnOn = stateArg === "on";
  if (!Number.isInteger(byteIndex) || byteIndex < FIRST_WRITABLE || byteIndex > LAST_WRITABLE) {
    console.error(`byte must be an integer ${FIRST_WRITABLE}-${LAST_WRITABLE} (control frames carry no others)`);
    process.exit(1);
  }
  if (!Number.isInteger(mask) || mask < 1 || mask > 0xff) {
    console.error("mask must be a single byte, e.g. 0x40");
    process.exit(1);
  }
  if (stateArg !== "on" && stateArg !== "off") {
    console.error("state must be 'on' or 'off'");
    process.exit(1);
  }
}

function crc16(buffer) {
  let crc = 0xffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = crc & 1 ? (crc >>> 1) ^ 0xa001 : crc >>> 1;
  }
  return crc;
}
const withCrc = (payload) =>
  Buffer.concat([payload, Buffer.from([(crc16(payload) >>> 8) & 0xff, crc16(payload) & 0xff])]);

const STATUS_QUERY = withCrc(Buffer.from("7a7a21d50c0000a20202", "hex"));
const HEARTBEAT = Buffer.from("ae0000", "hex");

function latestFrame(buffer) {
  for (let offset = buffer.length - 28; offset >= 0; offset -= 1) {
    if (
      buffer[offset] === 0x7a &&
      buffer[offset + 1] === 0x7a &&
      buffer[offset + 3] === 0x21 &&
      buffer[offset + 4] === 28
    ) {
      return buffer.subarray(offset, offset + 28);
    }
  }
  return null;
}

function session(mutate) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let written = false;
    const socket = net.createConnection({ host, port });
    socket.setTimeout(8000);
    socket.on("connect", () => {
      socket.write(STATUS_QUERY);
      setTimeout(() => !socket.destroyed && socket.write(HEARTBEAT), 20);
    });
    socket.on("data", (chunk) => {
      chunks.push(chunk);
      const frame = latestFrame(Buffer.concat(chunks));
      if (!frame || !mutate || written) return;
      written = true;
      const data = Buffer.alloc(10);
      frame.copy(data, 0, 13, 17);
      mutate(data);
      socket.write(
        withCrc(Buffer.concat([Buffer.from("7a7a21d5180000a10202", "hex"), Buffer.from([0, 0]), data])),
      );
      setTimeout(() => !socket.destroyed && socket.write(STATUS_QUERY), 400);
    });
    const finish = () => {
      socket.destroy();
      const frame = latestFrame(Buffer.concat(chunks));
      if (frame) resolve(frame);
      else reject(new Error(`No status frame from ${host}:${port}`));
    };
    setTimeout(finish, mutate ? 5000 : 2500);
    socket.on("timeout", finish);
    socket.on("error", reject);
  });
}

const describe = (frame, label) => {
  const bytes = [...frame].map((b) => b.toString(16).padStart(2, "0")).join(" ");
  console.log(`${label.padEnd(9)} ${bytes}`);
  for (let index = FIRST_WRITABLE; index <= LAST_WRITABLE; index += 1) {
    console.log(`  byte ${index}: 0x${frame[index].toString(16).padStart(2, "0")}  ${frame[index].toString(2).padStart(8, "0")}`);
  }
};

const before = await session();
describe(before, "before");

if (readOnly) process.exit(0);

const was = (before[byteIndex] & mask) !== 0;
console.log(`\nbyte ${byteIndex} mask 0x${mask.toString(16)} is currently ${was ? "on" : "off"}; setting ${turnOn ? "on" : "off"}`);
console.log(`restore with: node --experimental-strip-types support/poke-bit.mjs ${byteIndex} 0x${mask.toString(16)} ${was ? "on" : "off"}\n`);

await session((data) => {
  data[0] |= 0x08; // keep the unit awake, as every other command does
  const slot = byteIndex - FIRST_WRITABLE;
  if (turnOn) data[slot] |= mask;
  else data[slot] &= ~mask & 0xff;
});

await new Promise((resolve) => setTimeout(resolve, 2500));
describe(await session(), "after");
