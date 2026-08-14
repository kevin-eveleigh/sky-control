# ADR 0001: Local-first bridge and shared protocol fixtures

- Status: Accepted
- Date: 2026-08-14

## Context

The appliance works on the local network even though its legacy app is abandoned
or unavailable. Future clients include macOS and Windows desktop bridges and a
direct Home Assistant integration. Those hosts have different packaging,
lifecycle, networking, and ecosystem expectations.

## Decision

Sky Control is local-first. Discovery, status, and control stay inside the user's
LAN. Optional remote access is supplied by a user-managed private VPN. A project
cloud relay and public bridge exposure are out of scope initially because they
would add identity, key management, availability, abuse prevention, and ongoing
operations before the local protocol is broadly validated.

Desktop bridges and Home Assistant will share the SWM100 protocol specification,
but may use different runtime implementations. The Next.js/TypeScript bridge is
appropriate for the web controller and desktop packaging; Home Assistant's
native ecosystem may justify a Python implementation. Forcing every target into
one runtime would increase integration cost without improving protocol accuracy.

Sanitized JSON fixtures are the behavioral contract. Each fixture contains raw
protocol bytes only, expected decoded values or constructed frames, and no
network or device identifiers. TypeScript and future Python suites will execute
the same fixtures for decoding, CRC, validation, and control construction.

## Consequences

- The repository stays a simple single package for v0.1.
- Protocol code remains pure and separate from sockets and UI state.
- Cross-runtime drift is detected through fixture conformance, not shared source.
- Remote convenience is lower than a cloud service, but privacy, failure modes,
  and household-network risk are substantially simpler.
- Cloud relay, Matter, and provisioning require separate future decisions.
