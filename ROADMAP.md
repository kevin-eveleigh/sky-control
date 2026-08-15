# Roadmap

The roadmap is directional, not a promise of dates. Privacy, fixture-backed
protocol accuracy, and a simple local installation remain constraints throughout.

## v0.1 — shared open-source foundation

- Pure SWM100 packet codec and sanitized fixtures.
- Local discovery, communication, HTTP API, and responsive controller.
- Validated configuration, safe diagnostics, CI, and macOS LaunchAgent support.
- Broader testing across physical units and app-branded variants.

## Desktop bridges

- macOS menu-bar private beta: bundled bridge lifecycle, health status,
  LaunchAgent migration safeguards, Start at Login, and unsigned local packaging.
- Future macOS distribution: Developer ID signing, notarization, hardened runtime,
  universal artifacts, and a separately designed QR-pairing flow.
- Windows system-tray bridge with equivalent lifecycle and diagnostics.
- Keep the protocol specification shared while allowing platform-appropriate
  runtime implementations.

## Home automation

- Direct Home Assistant custom-integration beta with UI setup, local polling,
  climate controls, safe diagnostics, and custom-HACS/manual installation.
- Cross-language conformance tests driven by captured and explicitly labeled
  implementation-derived vectors in the shared JSON fixtures.
- Next: wider physical compatibility testing and, if the client stabilizes,
  extraction into a separately versioned Python package before any Core proposal.
- Later entities for independently coexisting sleep, quiet, light, health, and
  eco flags, only after their UX and physical behavior are sufficiently tested.

## Mobile experience

- QR pairing for the local bridge and private VPN addresses.
- Mobile packaging or native companions where it improves setup and reliability.
- Preserve the mobile web controller as the zero-install baseline.

## Device onboarding and reach

- Carefully researched Wi-Fi provisioning without distributing vendor software.
- Broader physical-device testing and an evidence-based compatibility database.
- Evaluate Matter only after stable local protocol and capability coverage.

Cloud relay and direct public exposure are not planned. Remote use should remain
user-managed through a private VPN unless a future security design justifies a
different, explicitly reviewed approach.
