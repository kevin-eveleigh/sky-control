"""Disposable SWM100 simulator for isolated Home Assistant acceptance tests.

This support tool is intentionally not part of the HACS package. Run it only
inside a test-only network; its state starts from the sanitized shared fixture.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import socket
from contextlib import suppress
from pathlib import Path

from custom_components.sky_control.swm100.codec import (
    HEARTBEAT,
    STATUS_QUERY,
    consume_frames,
    has_valid_crc,
    with_crc,
)

_DISCOVERY_PROBE = b"\xbe\x01"
_DISCOVERY_REPLY = (
    b"\xbe\x02"
    b"\x01\x06\x02\x00\x00\x00\x00\x01"
    b"\x03\x02\x01\x00"
    b"\x04\x02\x01\x00"
    b"\x05\x10SWM100 Simulator"
)


class DiscoveryProtocol(asyncio.DatagramProtocol):
    """Return one sanitized device record for each valid discovery probe."""

    def __init__(self) -> None:
        self.transport: asyncio.DatagramTransport | None = None

    def connection_made(self, transport: asyncio.BaseTransport) -> None:
        self.transport = transport  # type: ignore[assignment]

    def datagram_received(self, data: bytes, addr: tuple[str, int]) -> None:
        if data == _DISCOVERY_PROBE and self.transport is not None:
            self.transport.sendto(_DISCOVERY_REPLY, addr)


class Simulator:
    """Maintain one in-memory state frame across bounded TCP sessions."""

    def __init__(self, state_frame: bytes) -> None:
        self.state_frame = state_frame
        self.control_count = 0
        self._lock = asyncio.Lock()

    async def handle(
        self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter
    ) -> None:
        pending = b""
        try:
            while chunk := await reader.read(4096):
                pending += chunk
                while pending:
                    if pending.startswith(HEARTBEAT):
                        pending = pending[len(HEARTBEAT) :]
                        continue
                    frames, remainder = consume_frames(pending)
                    if not frames:
                        pending = remainder
                        break
                    for frame in frames:
                        if frame == STATUS_QUERY:
                            await self._send_state(writer)
                        elif len(frame) == 24 and has_valid_crc(frame):
                            async with self._lock:
                                state = bytearray(self.state_frame[:-2])
                                state[13:17] = frame[12:16]
                                self.state_frame = with_crc(bytes(state))
                                self.control_count += 1
                                print(
                                    f"CONTROL_APPLIED count={self.control_count}",
                                    flush=True,
                                )
                    pending = remainder
        except ConnectionError, asyncio.CancelledError:
            pass
        finally:
            writer.close()
            await writer.wait_closed()

    async def _send_state(self, writer: asyncio.StreamWriter) -> None:
        async with self._lock:
            frame = self.state_frame
        writer.write(frame[:7])
        await writer.drain()
        await asyncio.sleep(0.01)
        writer.write(frame[7:])
        await writer.drain()


def _discovery_socket(port: int, multicast: str | None = None) -> socket.socket:
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    sock.bind(("0.0.0.0", port))
    if multicast is not None:
        interface = socket.gethostbyname(socket.gethostname())
        membership = socket.inet_aton(multicast) + socket.inet_aton(interface)
        # Docker's internal-only bridge may omit a multicast-capable interface.
        # Broadcast discovery remains available in that environment.
        with suppress(OSError):
            sock.setsockopt(socket.IPPROTO_IP, socket.IP_ADD_MEMBERSHIP, membership)
    sock.setblocking(False)
    return sock


async def async_main(state_frame: bytes, host: str, port: int) -> None:
    simulator = Simulator(state_frame)
    loop = asyncio.get_running_loop()
    transports: list[asyncio.DatagramTransport] = []
    for listen_port, multicast in ((1995, None), (1993, "239.253.0.1")):
        transport, _ = await loop.create_datagram_endpoint(
            DiscoveryProtocol, sock=_discovery_socket(listen_port, multicast)
        )
        transports.append(transport)
    server = await asyncio.start_server(simulator.handle, host, port)
    print(f"SWM100_SIMULATOR_READY tcp={port}", flush=True)
    try:
        await server.serve_forever()
    finally:
        server.close()
        await server.wait_closed()
        for transport in transports:
            transport.close()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--fixture",
        type=Path,
        default=Path("fixtures/protocol/swm100-status.json"),
    )
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=1998)
    args = parser.parse_args()
    fixture = json.loads(args.fixture.read_text())
    state_frame = bytes.fromhex(fixture["frames"]["coolVariable"]["hex"])
    asyncio.run(async_main(state_frame, args.host, args.port))


if __name__ == "__main__":
    main()
