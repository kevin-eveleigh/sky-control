import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  STATUS_QUERY,
  buildControlFrame,
  consumeFrames,
  isStateFrame,
  parseState,
  withCrc,
} from "../lib/airco/protocol.ts";

const fixtures = JSON.parse(
  readFileSync(new URL("../fixtures/protocol/swm100-status.json", import.meta.url), "utf8"),
);
const capturedStatus = Buffer.from(fixtures.frames.coolVariable.hex, "hex");
const liveStatus = Buffer.from(fixtures.frames.coolAuto.hex, "hex");
const reCrc = (frame) => withCrc(frame.subarray(0, -2));

test("status query matches the legacy iPad capture", () => {
  assert.equal(STATUS_QUERY.toString("hex"), fixtures.expectedFrames.statusQuery);
});

test("captured status frame decodes correctly", () => {
  assert.deepEqual(parseState(capturedStatus), fixtures.frames.coolVariable.expectedState);
});

test("quiet mode uses the protocol mute bit", () => {
  const frame = buildControlFrame(capturedStatus, {
    action: "quiet",
    value: true,
  });
  assert.equal(frame[13] & 0x40, 0x40);
});

test("swing supports both vertical and horizontal movement", () => {
  const frame = buildControlFrame(capturedStatus, {
    action: "swing",
    value: "both",
  });
  assert.equal(frame[14], 0x11);
});

test("a second live capture decodes correctly", () => {
  assert.deepEqual(parseState(liveStatus), fixtures.frames.coolAuto.expectedState);
});

test("temperature changes preserve the quiet bit", () => {
  const quiet = Buffer.from(capturedStatus);
  quiet[14] |= 0x40;
  const frame = buildControlFrame(reCrc(quiet), { action: "temperature", value: 24 });
  assert.equal(frame[13] & 0x40, 0x40, "quiet bit survives");
  assert.equal((frame[13] & 0x1f) + 16, 24, "target temperature applied");
});

// Captured live while pressing the remote: byte 16 bit 0x40 tracked Health and
// bit 0x01 tracked Eco, each toggling on its own with nothing else changing.
const healthOn = Buffer.from(fixtures.frames.healthOn.hex, "hex");
const ecoOn = Buffer.from(fixtures.frames.ecoOn.hex, "hex");

test("health is byte 16 bit 0x40", () => {
  assert.equal(parseState(healthOn).health, true);
  assert.equal(parseState(healthOn).eco, false);
  assert.equal(parseState(capturedStatus).health, true, "July capture had Health on");
  assert.equal(parseState(liveStatus).health, false);

  const on = buildControlFrame(liveStatus, { action: "health", value: true });
  assert.equal(on[15] & 0x40, 0x40);
  const off = buildControlFrame(healthOn, { action: "health", value: false });
  assert.equal(off[15] & 0x40, 0);
});

test("eco is byte 16 bit 0x01", () => {
  assert.equal(parseState(ecoOn).eco, true);
  assert.equal(parseState(ecoOn).health, false);
  assert.equal(parseState(liveStatus).eco, false);

  const on = buildControlFrame(liveStatus, { action: "eco", value: true });
  assert.equal(on[15] & 0x01, 0x01);
  const off = buildControlFrame(ecoOn, { action: "eco", value: false });
  assert.equal(off[15] & 0x01, 0);
});

test("light is byte 16 bit 0x80", () => {
  assert.equal(parseState(liveStatus).light, true);

  const off = buildControlFrame(liveStatus, { action: "light", value: false });
  assert.equal(off[15] & 0x80, 0);

  const dim = Buffer.from(liveStatus);
  dim[16] &= ~0x80 & 0xff;
  assert.equal(parseState(reCrc(dim)).light, false);
  const on = buildControlFrame(reCrc(dim), { action: "light", value: true });
  assert.equal(on[15] & 0x80, 0x80);

  // Turning the display light off must not disturb its neighbours in byte 16.
  const busy = Buffer.from(liveStatus);
  busy[16] |= 0x40 | 0x02 | 0x01; // health, sleep and eco all on
  const dark = buildControlFrame(reCrc(busy), { action: "light", value: false });
  assert.equal(dark[15] & 0x40, 0x40, "health survives");
  assert.equal(dark[15] & 0x02, 0x02, "sleep survives");
  assert.equal(dark[15] & 0x01, 0x01, "eco survives");
});

test("byte 16 toggles do not disturb each other", () => {
  // Byte 16 packs eco (0x01), sleep (0x02), health (0x40) and light (0x80).
  const base = Buffer.from(liveStatus);
  base[16] |= 0x02; // sleep on, light already on
  for (const action of ["health", "eco"]) {
    for (const value of [true, false]) {
      const frame = buildControlFrame(reCrc(base), { action, value });
      assert.equal(frame[15] & 0x80, 0x80, `${action}=${value} keeps light`);
      assert.equal(frame[15] & 0x02, 0x02, `${action}=${value} keeps sleep`);
    }
  }
});

test("indoor temperature combines the whole and fractional bytes", () => {
  const frame = Buffer.from(liveStatus);
  const read = () => parseState(reCrc(frame)).indoorTemperature;

  frame[10] = 24;
  frame[11] = 5;
  assert.equal(read(), 24.5);

  frame[11] = 0;
  assert.equal(read(), 24, "a zero fraction reads as a whole degree");

  // Guard against a byte that is not a tenths digit being folded into the
  // reading; the whole-degree part must still come through.
  frame[11] = 0x9c;
  assert.equal(read(), 24);

  // Out-of-range whole degrees still mean "no reading".
  frame[10] = 200;
  assert.equal(read(), undefined);
});

test("every command wakes the unit", () => {
  const off = Buffer.from(capturedStatus);
  off[13] &= 0xf7; // clear the power bit in the source status frame
  const wakes = [
    { action: "temperature", value: 24 },
    { action: "mode", value: "heat" },
    { action: "fan", value: "gear-2" },
    { action: "swing", value: "both" },
    { action: "quiet", value: true },
    { action: "sleep", value: true },
  ];
  for (const request of wakes) {
    const frame = buildControlFrame(reCrc(off), request);
    assert.equal(frame[12] & 0x08, 0x08, `${request.action} sets the power bit`);
  }
  // Powering off is the one command that must not set it.
  assert.equal(
    buildControlFrame(capturedStatus, { action: "power", value: false })[12] & 0x08,
    0,
  );
});

test("temperature requests are clamped to the supported range", () => {
  const low = buildControlFrame(capturedStatus, { action: "temperature", value: 4 });
  const high = buildControlFrame(capturedStatus, { action: "temperature", value: 45 });
  assert.equal((low[13] & 0x1f) + 16, 16);
  assert.equal((high[13] & 0x1f) + 16, 30);
});

test("consumeFrames reassembles a frame split across TCP reads", () => {
  const first = consumeFrames(capturedStatus.subarray(0, 12));
  assert.equal(first.frames.length, 0, "an incomplete frame is not emitted");
  assert.equal(first.rest.length, 12, "the partial frame is held for the next read");

  const second = consumeFrames(
    Buffer.concat([first.rest, capturedStatus.subarray(12)]),
  );
  assert.equal(second.frames.length, 1);
  assert.equal(second.frames[0].toString("hex"), capturedStatus.toString("hex"));
  assert.equal(second.rest.length, 0);
});

test("consumeFrames never emits the same frame twice", () => {
  const stream = Buffer.concat([capturedStatus, liveStatus]);
  const { frames, rest } = consumeFrames(stream);
  assert.equal(frames.length, 2);
  assert.equal(rest.length, 0);
  // Re-running on only the unconsumed tail must yield nothing, which is what
  // keeps a control response from re-reporting the pre-command state.
  assert.equal(consumeFrames(rest).frames.length, 0);
});

test("consumeFrames rejects a frame with a broken CRC", () => {
  const corrupt = Buffer.from(capturedStatus);
  corrupt[corrupt.length - 1] ^= 0xff;
  assert.equal(consumeFrames(corrupt).frames.length, 0);
});

test("direct state parsing rejects invalid headers, lengths and CRCs", () => {
  const badHeader = Buffer.from(liveStatus);
  badHeader[0] = 0x00;
  const badLength = Buffer.from(liveStatus);
  badLength[4] = 27;
  const badCrc = Buffer.from(liveStatus);
  badCrc[badCrc.length - 1] ^= 0xff;
  assert.equal(parseState(badHeader), null);
  assert.equal(parseState(badLength), null);
  assert.equal(parseState(badCrc), null);
  assert.equal(parseState(liveStatus.subarray(0, -1)), null);
});

test("control construction refuses an invalid source frame", () => {
  const corrupt = Buffer.from(liveStatus);
  corrupt[corrupt.length - 1] ^= 0xff;
  assert.throws(
    () => buildControlFrame(corrupt, { action: "power", value: true }),
    /valid SWM100 status frame/,
  );
});

test("consumeFrames resynchronises past leading garbage", () => {
  const noisy = Buffer.concat([Buffer.from("00ff7a13", "hex"), liveStatus]);
  const { frames } = consumeFrames(noisy);
  assert.equal(frames.length, 1);
  assert.equal(frames[0].toString("hex"), liveStatus.toString("hex"));
});

test("isStateFrame only accepts full 0x21 status frames", () => {
  assert.equal(isStateFrame(liveStatus), true);
  assert.equal(isStateFrame(STATUS_QUERY), false);
  assert.equal(isStateFrame(liveStatus.subarray(0, 20)), false);
});

test("power-off frame matches the legacy iPad capture", () => {
  const frame = buildControlFrame(capturedStatus, {
    action: "power",
    value: false,
  });
  assert.equal(
    frame.toString("hex"),
    fixtures.expectedFrames.powerOff,
  );
});
