import assert from "node:assert/strict";
import test from "node:test";
import { parseControlEnvelope } from "../lib/airco/control-request.ts";

test("HTTP control validation enforces temperature bounds", () => {
  assert.deepEqual(parseControlEnvelope({ aircoId: "a", action: "temperature", value: 16 }), {
    aircoId: "a",
    control: { action: "temperature", value: 16 },
  });
  assert.deepEqual(parseControlEnvelope({ aircoId: "a", action: "temperature", value: 30 }), {
    aircoId: "a",
    control: { action: "temperature", value: 30 },
  });
  assert.equal(parseControlEnvelope({ aircoId: "a", action: "temperature", value: 15.9 }), null);
  assert.equal(parseControlEnvelope({ aircoId: "a", action: "temperature", value: 30.1 }), null);
  assert.equal(parseControlEnvelope({ aircoId: "a", action: "temperature", value: NaN }), null);
});

test("HTTP control validation rejects mismatched action values", () => {
  assert.equal(parseControlEnvelope({ aircoId: "a", action: "power", value: "on" }), null);
  assert.equal(parseControlEnvelope({ aircoId: "a", action: "mode", value: "freeze" }), null);
  assert.equal(parseControlEnvelope({ aircoId: "", action: "power", value: true }), null);
});
