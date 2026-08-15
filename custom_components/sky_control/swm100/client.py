"""Bounded asynchronous TCP sessions for SWM100 units."""

from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable

from .codec import (
    HEARTBEAT,
    STATUS_QUERY,
    build_control_frame,
    consume_frames,
    is_state_frame,
    parse_state,
)
from .exceptions import (
    Swm100ConnectionError,
    Swm100ProtocolError,
    normalize_exception,
)
from .models import ControlRequest, State

type OpenConnection = Callable[
    [str, int], Awaitable[tuple[asyncio.StreamReader, asyncio.StreamWriter]]
]


class Swm100Client:
    """One serialized client for a physical SWM100 endpoint."""

    def __init__(
        self,
        host: str,
        port: int,
        *,
        connect_timeout: float = 4.0,
        response_timeout: float = 3.0,
        open_connection: OpenConnection = asyncio.open_connection,
    ) -> None:
        self.host = host
        self.port = port
        self._connect_timeout = connect_timeout
        self._response_timeout = response_timeout
        self._open_connection = open_connection
        self._lock = asyncio.Lock()

    async def async_get_status(self) -> State:
        """Perform one read-only status session."""
        async with self._lock:
            return await self._async_session(None)

    async def async_control(self, request: ControlRequest) -> State:
        """Apply one command and return the confirmed post-command state."""
        async with self._lock:
            return await self._async_session(request)

    async def _async_session(self, request: ControlRequest | None) -> State:
        writer: asyncio.StreamWriter | None = None
        try:
            reader, opened_writer = await asyncio.wait_for(
                self._open_connection(self.host, self.port), self._connect_timeout
            )
            writer = opened_writer
            await self._write(opened_writer, STATUS_QUERY)
            await asyncio.sleep(0.02)
            await self._write(opened_writer, HEARTBEAT)
            before_frame = await self._read_state_frame(reader)
            if request is None:
                return parse_state(before_frame)

            await self._write(opened_writer, build_control_frame(before_frame, request))
            await asyncio.sleep(0.18)
            await self._write(opened_writer, HEARTBEAT)
            await asyncio.sleep(0.22)
            await self._write(opened_writer, STATUS_QUERY)
            after_frame = await self._read_state_frame(reader)
            return parse_state(after_frame)
        except asyncio.CancelledError:
            raise
        except BaseException as error:
            raise normalize_exception(error) from error
        finally:
            if writer is not None:
                writer.close()
                try:
                    await writer.wait_closed()
                except ConnectionError, OSError:
                    pass

    @staticmethod
    async def _write(writer: asyncio.StreamWriter, payload: bytes) -> None:
        writer.write(payload)
        await writer.drain()

    async def _read_state_frame(self, reader: asyncio.StreamReader) -> bytes:
        pending = b""
        loop = asyncio.get_running_loop()
        deadline = loop.time() + self._response_timeout
        while (remaining := deadline - loop.time()) > 0:
            chunk = await asyncio.wait_for(reader.read(4096), remaining)
            if not chunk:
                raise Swm100ConnectionError()
            frames, pending = consume_frames(pending + chunk)
            for frame in frames:
                if is_state_frame(frame):
                    return frame
        raise Swm100ProtocolError()
