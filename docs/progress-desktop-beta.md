# macOS menu-bar beta progress

## Checkpoint 1 — inspection and baseline

- Read repository instructions, project/roadmap/ADR documentation, service
  scripts, bridge configuration, startup code, CI, and Next.js 16 standalone and
  self-hosting guides.
- Confirmed a clean initial Git state and an installed, loaded household
  LaunchAgent without stopping, replacing, or probing it.
- Baseline: 29 tests, lint, and production build passed.

## Checkpoint 2 — architecture and lifecycle

- Selected Electron with an external-browser, menu-bar-only shell.
- Added a desktop-independent lifecycle supervisor, safe health endpoint,
  copy-only state migration, same-port LaunchAgent detection, explicit migration,
  bounded shutdown, crash/error states, and private file logging.
- Added eight hardware-free desktop lifecycle and migration tests; the full suite
  now contains 37 tests.

## Checkpoint 3 — packaging

- Added monochrome tray and application icons, app/DMG/ZIP packaging, project and
  third-party notices, CI-safe checks, and packaged-app validation.
- Caught and fixed electron-builder's filtering of the traced `node_modules`
  directory by generating a desktop-specific neutral runtime-module payload.
- Verified the corrected isolated development shell reaches `/api/health` on a
  temporary port without device discovery or control.

## Checkpoint 4 — macOS acceptance

- Exercised the native running, stopped, and error menus with an isolated
  packaged app. Start, stop, restart, controller, clipboard, logs, About,
  login-item toggle, and Quit behaved as documented; disabled actions followed
  lifecycle state.
- Confirmed closing the controller did not stop the bridge, a duplicate app did
  not create another bridge, and a simulated child exit remained stopped in an
  error state until an explicit Start.
- Verified the same-port household LaunchAgent produces the migration conflict
  state without stopping or changing that service. The destructive migration
  confirmation was deliberately not accepted during verification.
- Captured documentation-safe running and error menu images containing only the
  isolated loopback address and test port.

## Checkpoint 5 — final distribution audit

- Rebuilt the app, unsigned DMG, and ZIP from the final source and validated
  required runtime, static, icon, menu-bar, and licence contents.
- Removed Next.js-generated checkout paths from every generated desktop server
  chunk and manifest, then added package checks that reject any builder home or
  checkout path.
- Copied the final app outside the repository and ran its bundled runtime on an
  isolated port. The hardware-free health route and controller returned HTTP
  200, and shutdown released the port.
- Final automated result: 46 tests pass; lint, production build, desktop checks,
  and packaged-app validation pass. The existing household controller remains
  available and was not sent any device-control request.

## Checkpoint 6 — native airco controls

- Added a per-airco native submenu with cached power, mode, room temperature,
  target temperature, an explicit status refresh, and deliberate power, mode,
  and 16–30°C target controls.
- Kept periodic menu updates local to the bridge cache; opening the menu never
  probes or controls a device.
- Added hardware-free request, authentication, validation, state-formatting, and
  menu-routing coverage. No household device request is used by the test suite.
