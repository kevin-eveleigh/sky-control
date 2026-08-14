# Security policy

## Supported versions

Until the first stable release, the current `0.1.x` line receives security
fixes. Older snapshots are unsupported.

## Reporting a vulnerability

Use the repository host's private **Report a vulnerability** / security-advisory
feature. Do not open a public issue containing an exploit, token, private
network address, MAC address, local path, or packet capture. If private
reporting is unavailable, contact a maintainer through a private channel shown
on the repository host before disclosing details.

For non-sensitive compatibility bugs, use the issue template and attach only a
reviewed safe-diagnostics report. Acknowledgement and fix timelines depend on
maintainer availability; the report will be assessed before public disclosure.

## Operational boundaries

- Sky Control is for a trusted LAN or private VPN such as WireGuard.
- Never port-forward the HTTP port or expose it through a public tunnel, proxy,
  or firewall rule.
- Enable a strong access token on shared LANs and all VPN deployments.
- Test unfamiliar hardware deliberately and keep someone present for initial controls.
- Protect `.env.local`, `data/`, browser storage, and LaunchAgent runtime files.
- Treat the web origin as privileged: anyone who can run script in it may read
  the browser's stored bearer token.

The bridge uses plain HTTP on the LAN. It does not provide TLS, account recovery,
rate limiting, a cloud relay, or secure internet-facing deployment. These are
deliberate v0.1 boundaries, not recommendations to weaken a network perimeter.

## Diagnostic privacy

Safe diagnostics contain software/runtime versions, authentication state and
bridge port, reported model/protocol values, the last operation, normalized errors,
and packet counts. They replace device name, network address, and MAC address
with redaction markers and omit tokens, local paths, logs, full packets, device
IDs, locations, user-assigned names, and live state. Always review files before
sharing them.
