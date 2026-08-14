import assert from "node:assert/strict";
import test from "node:test";
import { parseDiscoveryReply } from "../lib/airco/discovery.ts";

const field = (id, value) => Buffer.concat([Buffer.from([id, value.length]), value]);
const reply = Buffer.concat([
  Buffer.from([0xbe, 0x02]),
  field(1, Buffer.from("001122334455", "hex")),
  field(3, Buffer.from("0102", "hex")),
  field(4, Buffer.from("a0b0", "hex")),
  field(5, Buffer.from("AC_TEST", "utf8")),
]);

test("discovery response parsing returns reported protocol fields", () => {
  assert.deepEqual(parseDiscoveryReply(reply, "192.0.2.10", 2998), {
    host: "192.0.2.10",
    port: 2998,
    mac: "00:11:22:33:44:55",
    name: "AC_TEST",
    model: "0102",
    protocol: "a0b0",
  });
});

test("discovery parser rejects unrelated and truncated datagrams", () => {
  assert.equal(parseDiscoveryReply(Buffer.from([0xbe, 0x01, 0, 0]), "192.0.2.10"), null);
  assert.equal(parseDiscoveryReply(reply.subarray(0, -2), "192.0.2.10"), null);
  assert.equal(parseDiscoveryReply(Buffer.from([0xbe, 0x02]), "192.0.2.10"), null);
});
