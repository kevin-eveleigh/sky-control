import type { AircoState } from "./types";

const STATUS_PAYLOAD = Buffer.from("7a7a21d50c0000a20202", "hex");
const STATE_FRAME_TYPE = 0x21;
const STATE_FRAME_BYTES = 28;

export type ControlRequest =
  | { action: "power"; value: boolean }
  | { action: "temperature"; value: number }
  | { action: "mode"; value: NonNullable<AircoState["mode"]> }
  | { action: "fan"; value: NonNullable<AircoState["fan"]> }
  | { action: "swing"; value: NonNullable<AircoState["swing"]> }
  | { action: "quiet"; value: boolean }
  | { action: "sleep"; value: boolean }
  | { action: "health"; value: boolean }
  | { action: "eco"; value: boolean }
  | { action: "light"; value: boolean };

export function crc16Modbus(buffer: Buffer): number {
  let crc = 0xffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xa001 : crc >>> 1;
    }
  }
  return crc;
}

export function withCrc(payload: Buffer): Buffer {
  const crc = crc16Modbus(payload);
  return Buffer.concat([
    payload,
    Buffer.from([(crc >>> 8) & 0xff, crc & 0xff]),
  ]);
}

export const STATUS_QUERY = withCrc(STATUS_PAYLOAD);

export function hasValidCrc(frame: Buffer): boolean {
  if (frame.length < 7) return false;
  return crc16Modbus(frame.subarray(0, -2)) === frame.readUInt16BE(frame.length - 2);
}

export function isStateFrame(frame: Buffer): boolean {
  return (
    frame.length === STATE_FRAME_BYTES &&
    frame[0] === 0x7a &&
    frame[1] === 0x7a &&
    frame[3] === STATE_FRAME_TYPE &&
    frame[4] === STATE_FRAME_BYTES &&
    hasValidCrc(frame)
  );
}

/**
 * Pulls every complete, CRC-valid frame out of `buffer` and returns the
 * trailing bytes that belong to a frame still in flight. Callers keep the
 * remainder and prepend it to the next chunk, so a frame split across TCP
 * reads is never lost and never parsed twice.
 */
export function consumeFrames(buffer: Buffer): {
  frames: Buffer[];
  rest: Buffer;
} {
  const frames: Buffer[] = [];
  let offset = 0;
  while (offset + 5 <= buffer.length) {
    if (buffer[offset] !== 0x7a || buffer[offset + 1] !== 0x7a) {
      offset += 1;
      continue;
    }
    const length = buffer[offset + 4];
    if (length < 7) {
      offset += 1;
      continue;
    }
    if (offset + length > buffer.length) break;
    const frame = buffer.subarray(offset, offset + length);
    if (hasValidCrc(frame)) {
      frames.push(Buffer.from(frame));
      offset += length;
    } else {
      offset += 1;
    }
  }
  return { frames, rest: Buffer.from(buffer.subarray(offset)) };
}

/**
 * Indoor temperature is split across two bytes: byte 10 holds whole degrees
 * and byte 11 the fraction in tenths. Observed live as 24 + 5 -> 24.5 °C,
 * which then became 25 + 0 -> 25.0 °C as the room warmed; the fraction reset
 * to zero exactly as the whole-degree byte incremented. Only 0 and 5 have
 * been seen, so the sensor may only report half degrees.
 */
function readIndoorTemperature(frame: Buffer): number | undefined {
  const whole = frame[10];
  if (whole > 60) return undefined;
  const fraction = frame[11] <= 9 ? frame[11] / 10 : 0;
  return Math.round((whole + fraction) * 10) / 10;
}

export function parseState(frame: Buffer): AircoState | null {
  if (!isStateFrame(frame)) return null;
  const data1 = frame[13];
  const data2 = frame[14];
  const data3 = frame[15];
  const data4 = frame[16];
  const modes: AircoState["mode"][] = ["auto", "cool", "dry", "fan", "heat"];
  const fans: AircoState["fan"][] = [
    "auto",
    "gear-1",
    "gear-2",
    "gear-3",
    "gear-4",
    "gear-5",
    "variable",
  ];

  return {
    power: Boolean(data1 & 0x08),
    targetTemperature: (data2 & 0x1f) + 16,
    indoorTemperature: readIndoorTemperature(frame),
    mode: modes[data1 & 0x07],
    fan: fans[(data1 >> 4) & 0x07],
    swing:
      data3 === 0x11
        ? "both"
        : data3 === 0x10
          ? "horizontal"
          : data3 === 0x01
            ? "vertical"
            : "off",
    sleep: Boolean(data4 & 0x02),
    quiet: Boolean(data2 & 0x40),
    light: Boolean(data4 & 0x80),
    health: Boolean(data4 & 0x40),
    eco: Boolean(data4 & 0x01),
  };
}

export function buildControlFrame(
  statusFrame: Buffer,
  request: ControlRequest,
): Buffer {
  if (!isStateFrame(statusFrame)) {
    throw new Error("A valid SWM100 status frame is required");
  }
  const data = Buffer.alloc(10);
  statusFrame.copy(data, 0, 13, 17);
  const modeCodes: Record<NonNullable<AircoState["mode"]>, number> = {
    auto: 0,
    cool: 1,
    dry: 2,
    fan: 3,
    heat: 4,
  };
  const fanCodes: Record<NonNullable<AircoState["fan"]>, number> = {
    auto: 0,
    "gear-1": 1,
    "gear-2": 2,
    "gear-3": 3,
    "gear-4": 4,
    "gear-5": 5,
    variable: 6,
  };

  switch (request.action) {
    case "power":
      data[0] = (data[0] & 0xf7) | (request.value ? 0x08 : 0);
      break;
    case "temperature": {
      const temperature = Math.max(16, Math.min(30, Math.round(request.value)));
      // Like every other command, adjusting the target wakes the unit. The
      // quiet bit in the upper nibble is preserved.
      data[0] |= 0x08;
      data[1] = (data[1] & 0xe0) | (temperature - 16);
      break;
    }
    case "mode":
      data[0] = (data[0] & 0xf8) | modeCodes[request.value] | 0x08;
      data[1] &= 0xbf;
      break;
    case "fan":
      data[0] = (data[0] & 0x8f) | (fanCodes[request.value] << 4) | 0x08;
      data[1] &= 0xbf;
      break;
    case "swing":
      data[0] |= 0x08;
      data[2] = {
        off: 0x00,
        vertical: 0x01,
        horizontal: 0x10,
        both: 0x11,
      }[request.value];
      break;
    case "sleep":
      data[0] |= 0x08;
      data[3] = (data[3] & 0xfd) | (request.value ? 0x02 : 0);
      break;
    case "quiet":
      data[0] |= 0x08;
      data[1] = (data[1] & 0xbf) | (request.value ? 0x40 : 0);
      break;
    case "health":
      data[0] |= 0x08;
      data[3] = (data[3] & 0xbf) | (request.value ? 0x40 : 0);
      break;
    case "eco":
      data[0] |= 0x08;
      data[3] = (data[3] & 0xfe) | (request.value ? 0x01 : 0);
      break;
    case "light":
      data[0] |= 0x08;
      data[3] = (data[3] & 0x7f) | (request.value ? 0x80 : 0);
      break;
  }

  return withCrc(
    Buffer.concat([
      Buffer.from("7a7a21d5180000a10202", "hex"),
      Buffer.from([0x00, 0x00]),
      data,
    ]),
  );
}
