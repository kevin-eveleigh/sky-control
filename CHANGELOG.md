# Changelog

All notable changes will be documented here. The format follows Keep a Changelog,
and releases will use Semantic Versioning once published.

## [Unreleased]

### Fixed

- Unconfirmed native-menu commands now remain visible in the airco status line
  instead of looking like a silent success.
- Native menu updates are deferred while the menu is open, preventing periodic
  cache refreshes from dismissing a mode or temperature submenu.
- Invalid or unreadable LaunchAgent port settings now fail closed as a possible
  service conflict rather than being misreported as an unrelated port collision.
- Generated access tokens are now readable, copied to the clipboard
  automatically, and accompanied by an explicit Copy action with status feedback.

### Added

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
