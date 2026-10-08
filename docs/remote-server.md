# Running the bridge on a remote server

This guide puts the Sky Control bridge on an always-on Linux server outside
your home, typically a small VPS you already rent, so you can control the air
conditioner from anywhere without leaving a laptop or Mac running at home.

```text
phone / laptop ──private VPN──▶ server ──WireGuard tunnel──▶ home router ──LAN──▶ air conditioner
  (Tailscale)                   bridge on 127.0.0.1           (built-in WireGuard)
```

Two separate private links do the work:

- **Server → home.** The server dials a WireGuard VPN that is built into many
  home routers, such as FRITZ!Box, OPNsense, pfSense, UniFi and GL.iNet. The
  tunnel only carries traffic for the air conditioner's address, so everything
  else the server hosts keeps using its normal internet connection.
- **You → server.** Your phone and laptop reach the bridge through a private
  VPN. This guide uses [Tailscale](https://tailscale.com/), but any VPN that
  only your own devices can join works.

Nothing is exposed to the public internet, and the home router needs no port
forwarding for the bridge.

> If you already have an always-on machine at home, such as a Raspberry Pi,
> NAS or Home Assistant box, running the bridge there (README Option 4) or
> using the Home Assistant integration (Option 3) is simpler and keeps your
> home network closed to outside machines. Use this guide when there is no such
> machine.

## Before you start

You need:

- A home router with a WireGuard VPN server, and a stable way to reach it from
  outside, usually the router's dynamic DNS name (for example a MyFRITZ!
  address).
- A Linux server with systemd, sudo, and Node.js 22.13 or newer.
- A private VPN for your own devices. Tailscale must be installed on the server
  and on every phone or computer you control the air conditioner from.
- The air conditioner's IP address on your home network. In the router, give
  it a fixed address (a DHCP reservation). A remote bridge can't find the unit
  again by scanning if its address changes.

Check the server doesn't already use your home subnet, for example
`192.168.1.x` or `192.168.178.x`. `ip -brief addr` lists its networks. If one
overlaps, the tunnel can't route to your home network.

## 1. Connect the server to your home router

Create a new WireGuard connection for a single device in the router, then
download its configuration file. Keep that file private: it contains the
server's private key.

Before installing it on the server, edit it so the tunnel only carries
air-conditioner traffic:

```ini
[Interface]
PrivateKey = <from the router>
# One address, not the whole subnet, so the server only gets a route for
# the airco and not for your entire home network:
Address = 192.168.1.204/32
# Remove any DNS = lines. They would replace the server's own DNS.

[Peer]
PublicKey = <from the router>
PresharedKey = <from the router, if present>
Endpoint = <your-router-dyndns-name>:<port>
# Only the air conditioner. Never 0.0.0.0/0 on a shared server.
AllowedIPs = 192.168.1.50/32
PersistentKeepalive = 25
```

Generated files often contain `AllowedIPs = 0.0.0.0/0, ::/0`. That sends all
of the server's traffic through your home connection, which breaks anything
else running on the server. Remove IPv6 addresses and routes too, unless you
need them.

Install it and start the tunnel. This guide calls the interface `home`:

```bash
sudo apt install wireguard-tools
sudo install -d -m 700 /etc/wireguard
sudo install -m 600 home.conf /etc/wireguard/home.conf
sudo systemctl enable --now wg-quick@home
```

Then check it:

```bash
sudo wg show home              # "latest handshake" should be seconds ago
ip route get 192.168.1.50      # should say "dev home"
ip route get 1.1.1.1           # should still use the normal interface
nc -zv 192.168.1.50 1998       # the unit's control port should be open
```

Delete the downloaded configuration file from the computer you downloaded it
on once the tunnel works.

## 2. Keep the tunnel up when your home IP changes

WireGuard looks up the router's dynamic DNS name only when the tunnel starts.
If your provider gives your home a new IP address, the tunnel stays down until
it is restarted. `wireguard-tools` ships a script that looks the name up again;
run it from a systemd timer:

```bash
sudo install -m 755 /usr/share/doc/wireguard-tools/examples/reresolve-dns/reresolve-dns.sh \
  /usr/local/sbin/wg-reresolve-dns.sh
```

`/etc/systemd/system/wg-reresolve-dns@.service`:

```ini
[Unit]
Description=Re-resolve WireGuard endpoint hostnames for %i
After=wg-quick@%i.service
Requisite=wg-quick@%i.service

[Service]
Type=oneshot
ExecStart=/usr/local/sbin/wg-reresolve-dns.sh /etc/wireguard/%i.conf
```

`/etc/systemd/system/wg-reresolve-dns@.timer`:

```ini
[Unit]
Description=Periodically re-resolve WireGuard endpoints for %i

[Timer]
OnBootSec=2min
OnUnitActiveSec=2min

[Install]
WantedBy=timers.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now wg-reresolve-dns@home.timer
```

The script's location differs between distributions; `find / -name
reresolve-dns.sh` finds it.

## 3. Install the bridge

Follow README **Option 4: Linux service**. Keep `SKY_CONTROL_HOST=127.0.0.1`
in `/etc/sky-control.env` so the bridge is only reachable from the server
itself. In `/etc/systemd/system/sky-control.service`, uncomment the two
`wg-quick@home` lines so the bridge starts after the tunnel.

Run the bridge directly on the host as described there. If you put it in a
Docker container instead, publish it only on loopback (`127.0.0.1:3000:3000`):
Docker port mappings bypass host firewalls such as ufw, so a plain `3000:3000`
publishes your air conditioner on the internet.

## 4. Reach it privately with Tailscale

Let Tailscale proxy the loopback-only bridge onto your private network, with
HTTPS:

```bash
sudo tailscale serve --bg --https=8443 http://127.0.0.1:3000
sudo tailscale serve status
```

Port 443 also works if nothing else on the server uses `tailscale serve` on
it. Never use `tailscale funnel` for the bridge: funnel publishes to the whole
internet.

On your phone, install Tailscale and sign in to the same account, then open
`https://<server-name>.<your-tailnet>.ts.net:8443`. On iPhone, use Safari's
**Share → Add to Home Screen** for an app-like icon. iOS runs only one VPN at a
time; with this setup the phone only needs Tailscale, not your router's VPN.

## 5. Add the air conditioner

Scanning doesn't work from a remote server: broadcast and multicast don't cross
the tunnel. Add the unit by address instead:

1. Open **Add airco** and enter the unit's IP address. Leave the port at 1998
   unless you know it differs.
2. Select **Check**. The bridge asks the unit to identify itself, which works
   across the tunnel, and fills in its module name and MAC address.
3. Name the unit and select **Save airco**.

Alternatively, set `AIRCO_HOST` in `/etc/sky-control.env` before the first
start, or copy an existing `aircos.json` from another bridge into
`/var/lib/sky-control/`.

To add another unit later, also add its address to `AllowedIPs` in
`/etc/wireguard/home.conf`, then run `sudo systemctl restart wg-quick@home`.

## Security notes

- **The server can reach your home network.** The `/32` limits are set on the
  server side. Most home routers can't limit what a single WireGuard peer may
  reach, so if someone takes over the server they can change the limits and
  reach the rest of your home network. Keep the server patched, and don't
  reuse a server you don't fully control.
- **Use an access token unless only your own devices can reach the bridge.**
  With a loopback-only bridge behind Tailscale, only devices on your tailnet
  and programs on the server itself can reach it. If you share your tailnet,
  or run software on the server you don't trust, set `AIRCO_TOKEN`. See
  [SECURITY.md](../SECURITY.md).
- **Don't expose it publicly.** Don't open the bridge port in the server's
  firewall, and don't put it behind a public reverse proxy, Cloudflare Tunnel
  or Tailscale Funnel.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| **Check** reports "No compatible module answered" | `sudo wg show home` shows a recent handshake; `ip route get <unit IP>` says `dev home`; the unit's address is in `AllowedIPs`; the unit has the address you typed. |
| Status refresh reports `HOST_UNREACHABLE` | Same checks, plus `nc -zv <unit IP> 1998` from the server. |
| Worked before, stopped after a router restart or new home IP | `systemctl list-timers wg-reresolve-dns@home.timer` is active. To reconnect immediately: `sudo systemctl restart wg-quick@home`. |
| Page doesn't load on the phone | Tailscale is connected on the phone; `sudo tailscale serve status` on the server lists the bridge; `curl http://127.0.0.1:3000/api/health` on the server answers. |
| The server's other services lost internet access | `AllowedIPs` contains `0.0.0.0/0`, or a `DNS =` line is left in the tunnel configuration. |
