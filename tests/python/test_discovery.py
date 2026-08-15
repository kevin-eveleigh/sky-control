"""Hardware-free tests for asynchronous discovery orchestration."""

from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest

from custom_components.sky_control.swm100 import (
    DeviceInfo,
    Swm100ConnectionError,
    async_discover_devices,
)
from custom_components.sky_control.swm100 import discovery as discovery_module


async def test_discovery_collects_and_deduplicates_without_lan() -> None:
    async def fake_listen(
        _target: object,
        found: dict[str, DeviceInfo],
        control_port: int,
        _listen_seconds: float,
    ) -> None:
        found["00:11:22:33:44:55"] = DeviceInfo(
            "192.0.2.10", control_port, mac="00:11:22:33:44:55"
        )

    with patch("custom_components.sky_control.swm100.discovery._listen", fake_listen):
        devices = await async_discover_devices(control_port=2998, listen_seconds=0)
    assert devices == [DeviceInfo("192.0.2.10", 2998, mac="00:11:22:33:44:55")]


async def test_discovery_normalizes_total_listener_failure() -> None:
    async def fail(*_args: object) -> None:
        raise OSError("sensitive operating system detail")

    with patch("custom_components.sky_control.swm100.discovery._listen", fail):
        with pytest.raises(Swm100ConnectionError) as raised:
            await async_discover_devices(listen_seconds=0)
    assert str(raised.value) == ""


async def test_udp_listener_closes_transport_and_parses_reply() -> None:
    class FakeSocket:
        def __init__(self) -> None:
            self.options: list[tuple[object, ...]] = []

        def setsockopt(self, *args: object) -> None:
            self.options.append(args)

    class FakeTransport:
        def __init__(self) -> None:
            self.socket = FakeSocket()
            self.sent: list[tuple[bytes, tuple[str, int]]] = []
            self.closed = False

        def get_extra_info(self, name: str) -> FakeSocket | None:
            return self.socket if name == "socket" else None

        def sendto(self, data: bytes, target: tuple[str, int]) -> None:
            self.sent.append((data, target))

        def close(self) -> None:
            self.closed = True

    transport = FakeTransport()

    class FakeLoop:
        async def create_datagram_endpoint(
            self, factory: object, **_kwargs: object
        ) -> tuple[FakeTransport, object]:
            protocol = factory()  # type: ignore[operator]
            protocol.datagram_received(  # type: ignore[attr-defined]
                b"\xbe\x02\x01\x06\x00\x11\x22\x33\x44\x55",
                ("192.0.2.10", 1995),
            )
            return transport, protocol

    found: dict[str, DeviceInfo] = {}
    target = discovery_module._Target(1990, "239.253.0.1", 1993, "239.253.0.1")
    with (
        patch.object(
            discovery_module.asyncio, "get_running_loop", return_value=FakeLoop()
        ),
        patch.object(discovery_module.asyncio, "sleep", AsyncMock()),
    ):
        await discovery_module._listen(target, found, 2998, 0)

    assert found["00:11:22:33:44:55"].port == 2998
    assert len(transport.sent) == 3
    assert transport.socket.options
    assert transport.closed is True
