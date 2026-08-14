import assert from "node:assert/strict";
import test from "node:test";
import { sanitizeDeviceDiagnostics } from "../lib/diagnostics.ts";

test("issue diagnostics redact local network and device identifiers", () => {
  const report = sanitizeDeviceDiagnostics(
    {
      id: "private-id",
      displayName: "Private bedroom",
      location: "Home",
      host: "192.0.2.42",
      port: 1998,
      mac: "00:11:22:33:44:55",
      deviceName: "AC_334455",
      model: "0102",
      protocol: "a0b0",
    },
    {
      operation: "status",
      normalizedError: "CONNECTION_TIMEOUT",
      protocol: { receivedBytes: 0, validFrames: 0, stateFrameReceived: false },
    },
  );

  assert.equal(report.reportedModel, "0102");
  assert.equal(report.reportedProtocol, "a0b0");
  assert.equal(report.networkAddress, "redacted");
  assert.equal(report.macAddress, "redacted");
  assert.equal(report.reportedName, "redacted");
  assert.doesNotMatch(JSON.stringify(report), /Private bedroom|192\.0\.2|334455|00:11/);
});
