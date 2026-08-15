# ADR 0003: Native Home Assistant client and cross-language conformance

- Status: Accepted
- Date: 2026-08-15

## Context

Home Assistant must communicate directly with an SWM100 air conditioner. It
cannot depend on the Next.js bridge, Electron shell, macOS host, or HTTP API.
Home Assistant Core normally prefers device communication in a separately
published Python library, but this community beta needs to mature before a
package is published or proposed for Core.

The repository already has fixture-backed TypeScript packet behavior. A second
implementation creates drift risk, especially where captured physical traffic
and inferred command construction are easy to conflate.

## Decision

Keep a fully typed asynchronous client under
`custom_components/sky_control/swm100`. Its models, codec, discovery, exceptions,
and network sessions do not import Home Assistant. The integration layer uses
that namespace through a coordinator and can later replace it with an extracted
package without redesigning entities or config entries.

`fixtures/protocol/swm100-status.json` is the cross-language behavioral contract.
Both TypeScript and Python tests consume it. Captured state/query/power-off
packets retain their captured status. Added core climate command packets live in
an explicitly labeled `derivedControlVectors` section and do not claim physical
verification.

All automated networking uses patched transports or loopback-only simulators.
Tests never broadcast and never use a household endpoint.

## Consequences

- Home Assistant controls units directly over UDP/TCP on the LAN.
- Packet encoding remains pure and independently testable.
- Per-client locking prevents overlapping poll and command sessions.
- A future Python package extraction has a clean boundary and shared conformance
  suite, but no premature PyPI package or Home Assistant Core submission exists.
- Changes to protocol behavior require shared fixture evidence and both suites.
