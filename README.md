# Sky Control

Sky Control is an unofficial, local-first bridge and mobile-friendly controller
for air conditioners that speak the Skyworth SWM100 local-network protocol. It
exists because the legacy controller app is abandoned or unavailable for many
owners while the appliance itself still works.

The project is not affiliated with or endorsed by Skyworth, Tekno Point,
Clima24, Easy Home, or any other manufacturer. Manufacturer and app names are
used only to describe tested or possible compatibility.

> Public beta safety: Sky Control is designed for a trusted LAN or private VPN.
> Never port-forward it or expose it directly to the public internet.

## Screenshots

The same local controller adapts from a desktop dashboard to a phone-sized layout.

<p align="center">
  <img src="output/playwright/sky-control-desktop.png" alt="Sky Control desktop dashboard" width="68%">
  <img src="output/playwright/sky-control-mobile.png" alt="Sky Control mobile dashboard" width="24%">
</p>

### Abandoned legacy app

If your former controller looked like this, the unit may belong to the same app
or protocol family. Interface similarity is a useful lead, not confirmation of
hardware compatibility.

<p align="center">
  <img src="abandoned-app-screen.webp" alt="Abandoned legacy air-conditioner controller app" width="28%">
</p>

## What v0.1 provides

- UDP discovery for SWM100-family modules.
- TCP status reading and verified local controls.
- Multiple named air conditioners.
- A responsive web controller for desktop and phone.
- Optional bearer-token authentication.
- Sanitized diagnostics for compatibility reports.
- A per-user macOS LaunchAgent installer.
- Portable protocol fixtures and hardware-free tests.

This foundation does not include the planned Windows tray application, direct
Home Assistant integration, native mobile apps, cloud relay, Matter support, or
Wi-Fi provisioning. See [ROADMAP.md](ROADMAP.md).

## Compatibility

Compatibility refers to physical hardware, not visual similarity between
branded apps. A shared app design is a useful lead, never confirmation.

### Confirmed hardware

| Manufacturer | Physical unit | Legacy app / Wi-Fi protocol | Verification |
| --- | --- | --- | --- |
| Tekno Point | SKY (one tested unit) | Clima24 / Skyworth SWM100 | Discovery, status and control verified against captured Clima24 traffic and live hardware |

### Likely compatible and seeking testers

| Candidate | Evidence | Status |
| --- | --- | --- |
| Units previously controlled by Tekno Point Smart Controller | Appears related to the tested app family | Models other than the tested SKY unit are unconfirmed |
| Other units previously controlled by Clima24 | The confirmed Tekno Point SKY unit used Clima24 | Models other than the tested SKY unit are unconfirmed |
| Units previously controlled by Easy Home AMS | Appears to be a branded variant of the same app family | Physical compatibility unconfirmed |
| Other units reporting SWM100-family protocol values | Protocol-family signal only | Seeking sanitized diagnostics and hardware tests |

### Reported incompatible

No physical units have been responsibly confirmed incompatible yet.

Please use the compatibility issue template for results. Do not upload vendor
apps, proprietary binaries, tokens, IP addresses, MAC addresses, or raw private
captures.

## Architecture

The repository intentionally remains one small Next.js application:

```text
app/                    Web controller and local HTTP route handlers
lib/airco/protocol.ts   Pure packet codec and CRC handling
lib/airco/client.ts     TCP sessions and device communication
lib/airco/discovery.ts  UDP discovery
lib/bridge/             Validated bridge configuration
lib/diagnostics.ts      Sanitized issue-report data
fixtures/protocol/      Portable, identifier-free captured behavior
support/                macOS service and protocol-research tools
tests/                  Hardware-free automated tests
```

The protocol codec never opens a socket. Automated tests cannot discover or
control a physical air conditioner. The architecture decision is recorded in
[docs/adr/0001-local-first-shared-protocol.md](docs/adr/0001-local-first-shared-protocol.md).

## Requirements

- Node.js 22.13 or newer (Node 22 and 24 are validated in CI).
- npm, included with Node.js.
- A Mac, Windows or Linux machine on the same local network as the unit.
- For discovery, permission to use UDP broadcast/multicast on the LAN.

## Install and run

```bash
# From the Sky Control source checkout:
npm ci
cp .env.example .env.local
npm test
npm run dev
```

Open `http://127.0.0.1:3000` on the bridge machine. On another LAN device, use
the bridge machine's local hostname or LAN address, for example
`http://bridge-mac.local:3000`.

A fresh install starts with no units. Select **Add airco**, scan the local
network, or enter a hostname and port manually. Once configured, status and
controls are available immediately.

### Phone access and Add to Home Screen

Connect the phone to the same trusted Wi-Fi network and open the bridge's local
URL. On iPhone or iPad, use Safari's Share menu and select **Add to Home Screen**.
On Android, use the browser menu's **Add to Home screen** or **Install app**
action. The bridge must remain running for the shortcut to work.

## Configuration

Copy `.env.example` to `.env.local`. Every local environment file and runtime
state file is ignored by Git.

| Variable | Default | Purpose |
| --- | --- | --- |
| `SKY_CONTROL_HOST` | `0.0.0.0` | Bridge listener; use `127.0.0.1` to restrict access to this machine |
| `SKY_CONTROL_PORT` | `3000` | Bridge HTTP port |
| `AIRCO_TOKEN` | unset | Pins a bearer token and prevents changing it in the UI; minimum 16 characters |
| `AIRCO_HOST` | unset | Optional first-device hostname or IP seed |
| `AIRCO_PORT` | `1998` | First-device and discovery control port |
| `AIRCO_CONFIG_PATH` | `data/aircos.json` | Device configuration file |
| `AIRCO_SETTINGS_PATH` | `data/settings.json` | UI-managed access-token file |
| `SKY_CONTROL_ALLOWED_DEV_ORIGINS` | unset | Comma-separated development origins; not used in production |

Generate a strong token rather than inventing one:

```bash
openssl rand -hex 32
```

Paste it into `AIRCO_TOKEN` or use **Settings → Require an access token →
Generate**. The UI stores its copy in that browser's local storage. Normal logs
and diagnostic reports never include it.

## Security model

Sky Control has no cloud service and does not need an internet connection after
installation. It trusts the network boundary: without a token, anyone who can
reach the bridge can read status and send commands. Use a token on shared Wi-Fi
and over any VPN.

Do not expose the bridge with router port forwarding, public reverse proxies,
tunnels that create public URLs, or a public firewall rule. TLS termination,
rate limiting, and internet-facing hardening are outside this milestone.

### Advanced remote access with WireGuard

Run WireGuard on a router or another always-on host, connect the remote phone to
that private VPN, and visit the bridge's VPN-reachable private address. Restrict
the VPN peer to the LAN ranges and ports it needs, keep `AIRCO_TOKEN` enabled,
and keep the bridge's HTTP port closed on the public WAN interface. WireGuard is
not bundled or configured by this project.

See [SECURITY.md](SECURITY.md) for reporting and operational guidance.

## Safe diagnostics

The **Activity → Download safe diagnostics** action creates JSON intended for a
public issue. It contains exactly:

- Sky Control and Node.js versions.
- The SWM100 protocol-family label.
- Whether authentication is enabled, plus the bridge port.
- Reported model and protocol values from discovery.
- The last operation attempted and a normalized error code.
- Counts of received bytes and valid frames, and whether a state frame arrived.
- Explicit `redacted` markers for network address, MAC address, and reported
  device name.

It does not contain access tokens, device IDs, user-assigned names or locations,
IP addresses, MAC addresses, local paths, logs, state values, or full packet
contents. Review any file before posting it publicly.

## macOS background service

The installer builds a standalone runtime and creates a per-user LaunchAgent.
It does not require administrator access.

```bash
npm run service:install
npm run service:status
npm run service:restart
npm run service:uninstall
```

The runtime lives in `~/Library/Application Support/Sky Control`, and logs live
in `~/Library/Logs`. The installer preserves existing state and migrates state
from the earlier `Sky Local` path when present. `service:deploy` remains an alias
for `service:install`.

Uninstall removes the LaunchAgent but deliberately keeps runtime configuration
for recovery. After confirming it is no longer needed, remove the printed
runtime directory manually. Re-running `service:install` updates the copied
runtime without modifying the source configuration first.

## Troubleshooting

### Discovery finds nothing

- Confirm the bridge and air conditioner are on the same non-guest LAN.
- Check that client isolation is disabled for that Wi-Fi network.
- Allow UDP broadcast/multicast ports 1990–1995 in the local firewall.
- Add the unit manually using its DHCP reservation or `.local` hostname.

### The unit is offline or status never arrives

- Confirm the legacy app is closed while testing.
- Check that TCP port 1998 is reachable inside the LAN.
- Verify the device address has not changed; prefer a DHCP reservation.
- Download safe diagnostics and open a compatibility issue.

### Authentication fails

- Use the same token configured on the bridge; tokens are case-sensitive.
- When `AIRCO_TOKEN` is set, the UI cannot replace or clear it.
- Clear the browser's stored token and reconnect after changing the server token.

## Development and validation

```bash
npm test       # hardware-free protocol/configuration regression tests
npm run lint   # ESLint
npm run build  # production build and TypeScript validation
```

Next.js 16 uses Turbopack by default; this project opts into its documented
Webpack build path because it is reliable in restricted local and CI
environments. Development still uses the current Next.js dev server.

Contributions are welcome; read [CONTRIBUTING.md](CONTRIBUTING.md) before adding
captures or protocol behavior. Sky Control is available under the [MIT License](LICENSE).
