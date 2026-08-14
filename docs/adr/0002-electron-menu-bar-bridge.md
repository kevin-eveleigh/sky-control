# ADR 0002: Electron menu-bar bridge ownership

- Status: Accepted
- Date: 2026-08-14

## Context

The existing production bridge is a Next.js standalone Node.js server. The
LaunchAgent installation is reliable for headless use but hides lifecycle and
status behind terminal commands. A desktop shell must package the existing
runtime, avoid changing SWM100 protocol behavior, preserve per-user state, and
leave a credible path to a later Windows tray implementation.

## Decision

Use Electron for the macOS menu-bar beta. Electron's main process owns exactly
one supervised utility process that runs the bundled Next.js standalone server.
The app checks the local readiness endpoint, handles graceful `SIGTERM` shutdown
with a bounded forced fallback, reports unexpected exits, and never implements
an automatic restart loop. A single-instance lock and lifecycle state machine
prevent duplicate managed bridge processes. Closing the external browser has no
effect on the owning Electron process.

The regular `.next/standalone` output remains available to the LaunchAgent.
Packaging creates an equivalent `.next/desktop-standalone` payload. Its traced
modules use a neutral `runtime_modules` directory because electron-builder
filters extra resources named `node_modules`; the generated desktop server
reinitializes Node's module search path before loading Next.js. electron-builder
copies that payload to the application Resources directory. Electron's bundled
Node runtime executes it, so an installed app needs neither the checkout nor a
global Node.js installation.

Runtime configuration is always written under
`~/Library/Application Support/Sky Control/data`. The desktop app reads an
optional `.env.local` from the same Application Support root, performs copy-only
migration from configured or legacy state when the destination is absent, then
pins device and settings paths to the shared data directory. Private bridge logs
live under `~/Library/Logs/Sky Control`. The app bundle remains read-only.

The desktop-independent configuration, service detection, and lifecycle state
machine live in `desktop/core`. A future Windows tray can reuse these modules and
provide platform-specific startup and service-conflict adapters. This decision
does not implement or claim Windows support.

On macOS, current and legacy per-user LaunchAgents are inspected before every
start. An installed or running same-port agent blocks the managed bridge. The app
never stops or removes a service merely because it launched. An explicit,
confirmed migration action unloads the agent, renames its plist to a recoverable
`.menu-bar-disabled` backup without overwriting an earlier backup, preserves shared
data, enables the supported Electron login item, and only then starts the bridge.
Advanced users retain the documented headless workflow; both modes must not use
the same port.

## Consequences

- The native shell is larger than a platform-only implementation, but it reuses
  the production TypeScript/Next.js bridge and supports a shared future tray core.
- Health checks use only `/api/health` and never discover or command an appliance.
- The beta artifacts are deliberately unsigned and unnotarized. Developer ID
  signing, hardened runtime review, notarization, and stapling remain future work.
- There is no cloud relay, telemetry, account system, public exposure, automatic
  updater, or Windows binary in this decision.
