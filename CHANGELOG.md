# Changelog

All notable changes will be documented here. The format follows Keep a Changelog,
and releases will use Semantic Versioning once published.

## [Unreleased]

### Added

- **Check this address** in the Add airco dialog asks a typed-in address to
  identify itself and fills in the module details a scan would provide. It
  uses a direct UDP request, so it also works across a VPN or routed network
  where scanning can't reach. Backed by a new read-only `POST /api/identify`.
- Linux install option: a hardened systemd unit and environment template in
  `support/linux/`, with install, update and uninstall steps in the README.
- Guide for running the bridge on a remote server, with a split-tunnel
  WireGuard connection to the home router and private access through Tailscale
  (`docs/remote-server.md`).

### Fixed

- When adding a unit, module details found for one address are cleared once
  the address is edited, so they can't be saved with a different unit. A check
  result that arrives after the address changed is ignored for the same reason.
- The macOS desktop package no longer fails in CI on a false personal-path
  match: GitHub runners' shared home folder also appears inside prebuilt
  third-party binaries. Local builds are still checked for the home folder.
  Pull-request builds are now ad-hoc signed like other builds; electron-builder
  skipped signing for them, leaving the app with an invalid signature.

### Changed

- The macOS app is about half the size (625 MB to 313 MB unpacked). The
  menu-bar shell no longer carries a second copy of the web dependencies it
  never uses, and the unused image optimizer (sharp and its LGPL libvips
  binaries) is left out of the bridge. Third-party notices list only what ships.

## [0.3.1] - 2026-08-17

### Fixed

- The menu-bar app now survives system sleep: monitoring pauses on suspend,
  health failures are ignored for a grace period after a wake, and a bridge that
  died while the Mac slept is restarted on resume.
- An unresponsive bridge is now restarted automatically, up to three attempts,
  instead of parking in an error state until someone clicks Restart Bridge.
- Unconfirmed native-menu commands now remain visible in the airco status line
  instead of looking like a silent success.
- Native menu updates are deferred while the menu is open, preventing periodic
  cache refreshes from dismissing a mode or temperature submenu.
- Invalid or unreadable LaunchAgent port settings now fail closed as a possible
  service conflict rather than being misreported as an unrelated port collision.
- Generated access tokens are now readable, copied to the clipboard
  automatically, and accompanied by an explicit Copy action with status feedback.

### Added

- Direct, HACS-compatible Home Assistant custom integration beta with scan and
  manual UI setup, read-only validation, coordinated polling, offline recovery,
  one native climate entity per unit, and privacy-preserving diagnostics.
- Fully typed asynchronous Python SWM100 library boundary with pure packet
  codec, bounded UDP/TCP sessions, normalized errors, and per-unit serialization.
- Shared TypeScript/Python conformance vectors for every core climate command,
  explicitly distinguishing captures from implementation-derived packets.
- Python 3.14 / Home Assistant 2026.8.2 lint, type, test, coverage, package,
  Hassfest, and HACS validation workflows plus a local installation archive.
- Optional "Keep Mac Awake While Running" menu setting that blocks App Nap and
  idle system sleep while the bridge runs, without keeping the display on. The
  choice is remembered between launches and is off by default.
- Native per-airco menu controls for explicit status refresh, power, mode, and
  16–30°C target temperature, with room and target readings in the menu.
- Unsigned macOS menu-bar beta with native lifecycle, status, controller, logs,
  clipboard, login-item, About, and Quit actions.
- Bundled Next.js standalone runtime with no separate Node.js or source-checkout
  dependency after installation.
- Hardware-free desktop lifecycle, port-conflict, state-preservation, and
  LaunchAgent migration regression tests.
- Reproducible app, DMG, and ZIP packaging plus package-content validation.
- Local `/api/health` readiness route that performs no device discovery or control.
- Public Sky Control identity and unofficial-project disclaimer.
- Pure SWM100 codec, separate TCP client, and sanitized JSON fixtures.
- Safe diagnostic reports and download action.
- Validated bridge/device configuration and secure token guidance.
- Hardware-free discovery, frame, CRC, temperature, configuration, and privacy tests.
- macOS install, status, restart, uninstall, and legacy-state migration commands.
- Community health files, CI, security documentation, roadmap, and architecture record.

### Changed

- The architecture now includes a direct Python Home Assistant client while the
  web and desktop bridge continue to use the verified TypeScript implementation.
- Desktop test-path overrides are disabled in packaged applications.
- Third-party notices are generated from the exact packaged runtime with full
  distributed license texts and package versions.
- Desktop documentation images now live under `docs/assets`.
- The menu-bar app and headless service share the standard Sky Control data
  directory, and same-port LaunchAgent conflicts are blocked until explicit migration.
- Production builds use Next.js 16's documented Webpack compatibility flag.
- Raw packet contents and household network details are no longer exposed in the UI.
- Control commands no longer require a separate environment feature flag.

## [0.1.0] - 2026-08-14

Initial public-beta foundation.
