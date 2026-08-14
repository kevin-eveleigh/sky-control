# Contributing to Sky Control

Thank you for helping owners keep functional appliances useful. This is an
unofficial community project, so accuracy and privacy matter more than breadth.

## Before opening a change

- Search existing issues and describe the physical unit, not only its app.
- Never upload a vendor application, proprietary binary, copied manufacturer
  artwork, access token, IP address, MAC address, or unsanitized capture.
- Do not claim compatibility from screenshots or shared branding alone.
- Discuss large runtime or architecture changes before implementing them.

## Development workflow

1. Use Node.js 22.13 or newer and run `npm ci`.
2. Copy `.env.example` only if local manual testing is needed.
3. Do not configure a physical device for ordinary automated development.
4. Run `npm test`, `npm run lint`, and `npm run build`.
5. Explain user-visible behavior, security impact, and validation in the PR.

Tests must not require, discover, or control physical hardware. New verified
packet behavior belongs in identifier-free JSON under `fixtures/protocol/` and
must include a focused regression test. Keep fixtures usable by both TypeScript
and future Python implementations: hex strings, explicit expected values, and
no runtime-specific encoding.

`support/poke-bit.mjs` is a manual protocol-research tool that can control real
hardware. It is not part of automated validation. Use it only on hardware you
own, with someone present, and restore the original state after a test.

## Compatibility reports

Use **Download safe diagnostics** in the web controller and review the JSON
before attaching it. State whether each operation was read-only or a real
control test. A discovered module is only a candidate until status and control
are confirmed on that physical model.

## Style and scope

- Keep protocol parsing pure and device I/O separate.
- Keep the bridge local-first and never recommend direct internet exposure.
- Prefer small modules and the existing single-package workflow.
- Preserve captured-frame behavior unless corresponding fixtures and rationale
  prove the change.
- Update the changelog and public documentation for material behavior changes.

By participating, you agree to follow [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).
