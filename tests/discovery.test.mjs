import assert from "node:assert/strict";
import dgram from "node:dgram";
import test from "node:test";
import { identifyDevice, parseDiscoveryReply } from "../lib/airco/discovery.ts";

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

/** A loopback stand-in for a module's discovery listener. */
async function fakeModule(respond) {
  const socket = dgram.createSocket("udp4");
  socket.on("message", (message, remote) => {
    for (const answer of respond(message)) socket.send(answer, remote.port, remote.address);
  });
  await new Promise((resolve) => socket.bind(0, "127.0.0.1", resolve));
  return { port: socket.address().port, close: () => socket.close() };
}

test("identifying an address returns the module's reported details", async () => {
  const unit = await fakeModule((message) =>
    message.equals(Buffer.from([0xbe, 0x01])) ? [Buffer.from("noise"), reply] : [],
  );
  try {
    assert.deepEqual(
      await identifyDevice("127.0.0.1", { discoveryPort: unit.port, controlPort: 2998 }),
      {
        host: "127.0.0.1",
        port: 2998,
        mac: "00:11:22:33:44:55",
        name: "AC_TEST",
        model: "0102",
        protocol: "a0b0",
      },
    );
  } finally {
    unit.close();
  }
});

test("identifying a hostname keeps the hostname rather than today's address", async () => {
  const unit = await fakeModule(() => [reply]);
  try {
    const device = await identifyDevice("localhost", { discoveryPort: unit.port });
    assert.equal(device?.host, "localhost");
  } finally {
    unit.close();
  }
});

test("identifying an address that never answers returns null", async () => {
  const unit = await fakeModule(() => []);
  try {
    assert.equal(await identifyDevice("127.0.0.1", { discoveryPort: unit.port }), null);
  } finally {
    unit.close();
  }
});
