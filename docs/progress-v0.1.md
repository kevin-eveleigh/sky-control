# v0.1 preparation progress

Updated 2026-08-14.

- **Audit complete:** inspected the unborn Git repository, ignored local runtime
  data, existing protocol behavior, configuration, tests, Next.js 16 guidance,
  and macOS LaunchAgent path before editing.
- **Foundation complete:** centralized the public identity; separated packet
  codec, TCP communication, discovery, bridge configuration, API, UI, and safe
  diagnostics; retained fixture-backed verified control behavior.
- **Privacy and security complete:** removed the hardcoded household development
  origin, validated configuration, strengthened token guidance, removed raw
  packets from the UI, normalized network errors, and added redaction tests.
- **Public project files complete:** added the MIT license, README, security and
  contribution policies, code of conduct, templates, changelog, roadmap, CI,
  compatibility categories, and local-first ADR.
- **Deployment checkpoint complete:** preserved `service:deploy`, added explicit
  install/status/restart/uninstall actions, retained legacy state migration, and
  syntax-checked the scripts without changing the installed service.
- **Validation complete:** clean `npm ci`, 29 hardware-free tests, lint, build,
  isolated API smoke tests, and phone-viewport browser checks pass. No automated
  validation discovered or controlled a physical unit.
