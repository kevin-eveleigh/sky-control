"""Loopback TCP tests for bounded, serialized SWM100 sessions."""

from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Any

import pytest

from custom_components.sky_control.swm100 import (
    ControlRequest,
    Swm100Client,
    Swm100ConnectionError,
    Swm100ProtocolError,
    build_control_frame,
    consume_frames,
)


@asynccontextmanager
async def _simulator(
    status_frame: bytes,
    *,
    malformed: bool = False,
    response_delay: float = 0,
) -> AsyncIterator[tuple[int, list[bytes], dict[str, int]]]:
    commands: list[bytes] = []
    counters = {"active": 0, "maximum": 0}

    async def handle(
        reader: asyncio.StreamReader, writer: asyncio.StreamWriter
    ) -> None:
        counters["active"] += 1
        counters["maximum"] = max(counters["maximum"], counters["active"])
        pending = b""
        try:
            while chunk := await reader.read(4096):
                frames, pending = consume_frames(pending + chunk)
                for frame in frames:
                    if len(frame) == 12:
                        if response_delay:
                            await asyncio.sleep(response_delay)
                        payload = b"not-an-swm100-frame" if malformed else status_frame
                        midpoint = len(payload) // 2
                        writer.write(payload[:midpoint])
                        await writer.drain()
                        writer.write(payload[midpoint:])
                        await writer.drain()
                        if malformed:
                            writer.close()
                            return
                    elif len(frame) == 24:
                        commands.append(frame)
                        writer.write(status_frame)
                        await writer.drain()
        except ConnectionError, OSError:
            pass
        finally:
            counters["active"] -= 1
            writer.close()

    server = await asyncio.start_server(handle, "127.0.0.1", 0)
    port = server.sockets[0].getsockname()[1]
    try:
        yield port, commands, counters
    finally:
        server.close()
        await server.wait_closed()


async def test_status_and_control_sessions_use_loopback_simulator(
    protocol_fixture: dict[str, Any],
    socket_enabled: None,
) -> None:
    frame = bytes.fromhex(protocol_fixture["frames"]["coolAuto"]["hex"])
    request = ControlRequest("power", False)
    expected_control = build_control_frame(frame, request)
    async with _simulator(frame) as (port, commands, _):
        client = Swm100Client(
            "127.0.0.1", port, connect_timeout=0.5, response_timeout=0.5
        )
        assert (await client.async_get_status()).indoor_temperature == 24.5
        assert (await client.async_control(request)).power is True
        assert commands == [expected_control]


async def test_sessions_are_serialized_per_client(
    protocol_fixture: dict[str, Any],
    socket_enabled: None,
) -> None:
    frame = bytes.fromhex(protocol_fixture["frames"]["coolAuto"]["hex"])
    async with _simulator(frame, response_delay=0.05) as (port, _, counters):
        client = Swm100Client(
            "127.0.0.1", port, connect_timeout=0.5, response_timeout=0.5
        )
        await asyncio.gather(client.async_get_status(), client.async_get_status())
    assert counters["maximum"] == 1


async def test_malformed_and_unreachable_sessions_are_normalized(
    protocol_fixture: dict[str, Any],
    socket_enabled: None,
) -> None:
    frame = bytes.fromhex(protocol_fixture["frames"]["coolAuto"]["hex"])
    async with _simulator(frame, malformed=True) as (port, _, _):
        client = Swm100Client(
            "127.0.0.1", port, connect_timeout=0.2, response_timeout=0.2
        )
        with pytest.raises((Swm100ProtocolError, Swm100ConnectionError)):
            await client.async_get_status()

    server = await asyncio.start_server(lambda _r, _w: None, "127.0.0.1", 0)
    closed_port = server.sockets[0].getsockname()[1]
    server.close()
    await server.wait_closed()
    with pytest.raises(Swm100ConnectionError):
        await Swm100Client(
            "127.0.0.1", closed_port, connect_timeout=0.1
        ).async_get_status()
