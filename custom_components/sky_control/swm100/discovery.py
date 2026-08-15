"""Asynchronous UDP discovery for SWM100 units."""

from __future__ import annotations

import asyncio
from dataclasses import dataclass

from .exceptions import Swm100ConnectionError, normalize_exception
from .models import DeviceInfo

DEFAULT_CONTROL_PORT = 1998
DISCOVERY_PROBE = b"\xbe\x01"


def parse_discovery_reply(
    message: bytes, host: str, control_port: int = DEFAULT_CONTROL_PORT
) -> DeviceInfo | None:
    """Parse a discovery datagram without performing network I/O."""
    if len(message) < 4 or message[:2] != b"\xbe\x02":
        return None
    fields: dict[int, bytes] = {}
    offset = 2
    while offset + 2 <= len(message):
        field_id, length = message[offset : offset + 2]
        offset += 2
        if offset + length > len(message):
            return None
        fields[field_id] = message[offset : offset + length]
        offset += length
    if offset != len(message) or not fields:
        return None
    mac = fields.get(1)
    return DeviceInfo(
        host=host,
        port=control_port,
        mac=":".join(f"{byte:02x}" for byte in mac) if mac else None,
        name=fields.get(5, b"").decode("utf-8", errors="replace") or None,
        model=fields.get(3, b"").hex() or None,
        protocol=fields.get(4, b"").hex() or None,
    )


class _DiscoveryProtocol(asyncio.DatagramProtocol):
    def __init__(self, found: dict[str, DeviceInfo], control_port: int) -> None:
        self.found = found
        self.control_port = control_port

    def datagram_received(self, data: bytes, addr: tuple[str, int]) -> None:
        device = parse_discovery_reply(data, addr[0], self.control_port)
        if device is not None:
            self.found[device.mac or device.host] = device


@dataclass(frozen=True, slots=True)
class _Target:
    bind_port: int
    destination: str
    destination_port: int
    multicast: str | None = None


_TARGETS = (
    _Target(1992, "255.255.255.255", 1995),
    _Target(1990, "239.253.0.1", 1993, "239.253.0.1"),
)


async def _listen(
    target: _Target,
    found: dict[str, DeviceInfo],
    control_port: int,
    listen_seconds: float,
) -> None:
    loop = asyncio.get_running_loop()
    transport: asyncio.DatagramTransport | None = None
    try:
        transport, _ = await loop.create_datagram_endpoint(
            lambda: _DiscoveryProtocol(found, control_port),
            local_addr=("0.0.0.0", target.bind_port),
            allow_broadcast=True,
            reuse_port=True,
        )
        sock = transport.get_extra_info("socket")
        if target.multicast and sock is not None:
            import socket

            sock.setsockopt(
                socket.IPPROTO_IP,
                socket.IP_ADD_MEMBERSHIP,
                socket.inet_aton(target.multicast) + socket.inet_aton("0.0.0.0"),
            )
        for attempt in range(3):
            transport.sendto(
                DISCOVERY_PROBE, (target.destination, target.destination_port)
            )
            if attempt < 2:
                await asyncio.sleep(0.35)
        await asyncio.sleep(max(0, listen_seconds - 0.7))
    finally:
        if transport is not None:
            transport.close()


async def async_discover_devices(
    *, control_port: int = DEFAULT_CONTROL_PORT, listen_seconds: float = 2.4
) -> list[DeviceInfo]:
    """Actively discover units on the local network with bounded listeners."""
    found: dict[str, DeviceInfo] = {}
    results = await asyncio.gather(
        *(_listen(target, found, control_port, listen_seconds) for target in _TARGETS),
        return_exceptions=True,
    )
    if results and all(isinstance(result, BaseException) for result in results):
        normalized = normalize_exception(results[0])  # type: ignore[arg-type]
        raise Swm100ConnectionError() from normalized
    return list(found.values())
