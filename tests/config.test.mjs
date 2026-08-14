import assert from "node:assert/strict";
import test from "node:test";
import { validateAircoInput } from "../lib/airco/config.ts";
import { parseBridgeConfig } from "../lib/bridge/config.ts";

test("bridge configuration uses safe public defaults", () => {
  const config = parseBridgeConfig({});
  assert.equal(config.bindHost, "0.0.0.0");
  assert.equal(config.bindPort, 3000);
  assert.equal(config.deviceSeedHost, null);
  assert.equal(config.deviceSeedPort, 1998);
  assert.equal(config.token, null);
});

test("bridge configuration validates ports, hosts and tokens", () => {
  assert.throws(() => parseBridgeConfig({ AIRCO_PORT: "0" }), /between 1 and 65535/);
  assert.throws(() => parseBridgeConfig({ SKY_CONTROL_PORT: "65536" }), /between 1 and 65535/);
  assert.throws(() => parseBridgeConfig({ SKY_CONTROL_HOST: "bad host" }), /IP address or hostname/);
  assert.throws(() => parseBridgeConfig({ AIRCO_HOST: "bad host/path" }), /IP address or hostname/);
  assert.throws(() => parseBridgeConfig({ AIRCO_TOKEN: "too-short" }), /at least 16/);
});

test("airco configuration normalizes text and enforces endpoint bounds", () => {
  assert.deepEqual(
    validateAircoInput(
      { displayName: "  Lounge  ", location: " Downstairs ", host: "ac.local", port: 1998 },
      "Fallback",
    ),
    {
      displayName: "Lounge",
      location: "Downstairs",
      host: "ac.local",
      port: 1998,
      mac: undefined,
      deviceName: undefined,
      model: undefined,
      protocol: undefined,
    },
  );
  assert.throws(
    () => validateAircoInput({ displayName: "AC", location: "Room", host: "", port: 1998 }, "AC"),
    /required/,
  );
  assert.throws(
    () => validateAircoInput({ displayName: "AC", location: "Room", host: "bad host", port: 1998 }, "AC"),
    /IP address or hostname/,
  );
  assert.throws(
    () => validateAircoInput({ displayName: "AC", location: "Room", host: "ac.local", port: 70000 }, "AC"),
    /between 1 and 65535/,
  );
});
