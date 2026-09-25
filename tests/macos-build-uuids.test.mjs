import assert from "node:assert/strict";
import test from "node:test";
import { executableUuidOffsets } from "../support/macos-build-uuids.mjs";

function executable() {
  const bytes = Buffer.alloc(64, 0);
  bytes.writeUInt32LE(0xfeedfacf, 0);
  bytes.writeUInt32LE(2, 12);
  bytes.writeUInt32LE(1, 16);
  bytes.writeUInt32LE(24, 20);
  bytes.writeUInt32LE(0x1b, 32);
  bytes.writeUInt32LE(24, 36);
  return bytes;
}

test("finds only the UUID payload in a thin executable", () => {
  assert.deepEqual(executableUuidOffsets(executable()), [40]);
});

test("finds UUIDs for both slices in a universal executable", () => {
  const bytes = Buffer.alloc(192);
  bytes.writeUInt32BE(0xcafebabe, 0);
  bytes.writeUInt32BE(2, 4);
  bytes.writeUInt32BE(64, 16);
  bytes.writeUInt32BE(64, 20);
  bytes.writeUInt32BE(128, 36);
  bytes.writeUInt32BE(64, 40);
  executable().copy(bytes, 64);
  executable().copy(bytes, 128);
  assert.deepEqual(executableUuidOffsets(bytes), [104, 168]);
});

test("rejects malformed commands and non-executables before patching", () => {
  const bytes = executable();
  bytes.writeUInt32LE(0, 36);
  assert.throws(() => executableUuidOffsets(bytes), /load command size/);
  assert.throws(() => executableUuidOffsets(executable().subarray(0, 40)), /Truncated/);
  const library = executable();
  library.writeUInt32LE(6, 12);
  assert.throws(() => executableUuidOffsets(library), /MH_EXECUTE/);
});
