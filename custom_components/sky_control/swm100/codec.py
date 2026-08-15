"""Pure packet encoding and decoding for the SWM100 protocol."""

from __future__ import annotations

from collections.abc import Mapping

from .exceptions import Swm100InvalidFrame
from .models import ControlRequest, FanMode, HvacMode, State, SwingMode

_STATUS_PAYLOAD = bytes.fromhex("7a7a21d50c0000a20202")
_CONTROL_PREFIX = bytes.fromhex("7a7a21d5180000a10202")
_STATE_FRAME_TYPE = 0x21
_STATE_FRAME_BYTES = 28


def crc16_modbus(payload: bytes) -> int:
    """Return the Modbus CRC used by SWM100 packets."""
    crc = 0xFFFF
    for byte in payload:
        crc ^= byte
        for _ in range(8):
            crc = ((crc >> 1) ^ 0xA001) if crc & 1 else crc >> 1
    return crc


def with_crc(payload: bytes) -> bytes:
    """Append the protocol's big-endian representation of its Modbus CRC."""
    crc = crc16_modbus(payload)
    return payload + bytes((crc >> 8, crc & 0xFF))


STATUS_QUERY = with_crc(_STATUS_PAYLOAD)
HEARTBEAT = bytes.fromhex("ae0000")


def has_valid_crc(frame: bytes) -> bool:
    """Return whether a complete frame has a valid checksum."""
    return len(frame) >= 7 and crc16_modbus(frame[:-2]) == int.from_bytes(
        frame[-2:], "big"
    )


def is_state_frame(frame: bytes) -> bool:
    """Return whether a frame is a complete, CRC-valid state response."""
    return (
        len(frame) == _STATE_FRAME_BYTES
        and frame[:2] == b"zz"
        and frame[3] == _STATE_FRAME_TYPE
        and frame[4] == _STATE_FRAME_BYTES
        and has_valid_crc(frame)
    )


def consume_frames(buffer: bytes) -> tuple[list[bytes], bytes]:
    """Consume complete CRC-valid frames while preserving a partial tail."""
    frames: list[bytes] = []
    offset = 0
    while offset + 5 <= len(buffer):
        if buffer[offset : offset + 2] != b"zz":
            offset += 1
            continue
        length = buffer[offset + 4]
        if length < 7:
            offset += 1
            continue
        if offset + length > len(buffer):
            break
        frame = buffer[offset : offset + length]
        if has_valid_crc(frame):
            frames.append(frame)
            offset += length
        else:
            offset += 1
    return frames, buffer[offset:]


def _indoor_temperature(frame: bytes) -> float | None:
    whole = frame[10]
    if whole > 60:
        return None
    fraction = frame[11] / 10 if frame[11] <= 9 else 0
    return round(whole + fraction, 1)


def parse_state(frame: bytes) -> State:
    """Parse a complete state frame or raise a normalized frame exception."""
    if not is_state_frame(frame):
        raise Swm100InvalidFrame()
    data1, data2, data3, data4 = frame[13:17]
    modes: tuple[HvacMode, ...] = tuple(HvacMode)
    fans: tuple[FanMode, ...] = tuple(FanMode)
    mode_code = data1 & 0x07
    fan_code = (data1 >> 4) & 0x07
    swing = {
        0x01: SwingMode.VERTICAL,
        0x10: SwingMode.HORIZONTAL,
        0x11: SwingMode.BOTH,
    }.get(data3, SwingMode.OFF)
    return State(
        power=bool(data1 & 0x08),
        target_temperature=(data2 & 0x1F) + 16,
        indoor_temperature=_indoor_temperature(frame),
        mode=modes[mode_code] if mode_code < len(modes) else None,
        fan=fans[fan_code] if fan_code < len(fans) else None,
        swing=swing,
        sleep=bool(data4 & 0x02),
        quiet=bool(data2 & 0x40),
        light=bool(data4 & 0x80),
        health=bool(data4 & 0x40),
        eco=bool(data4 & 0x01),
    )


def _expect_type(request: ControlRequest, expected: type[object]) -> None:
    if not isinstance(request.value, expected):
        raise ValueError(f"Invalid value for {request.action}")


def build_control_frame(status_frame: bytes, request: ControlRequest) -> bytes:
    """Build a command from current state without opening a socket."""
    if not is_state_frame(status_frame):
        raise Swm100InvalidFrame()
    data = bytearray(10)
    data[:4] = status_frame[13:17]
    mode_codes: Mapping[HvacMode, int] = {
        mode: index for index, mode in enumerate(HvacMode)
    }
    fan_codes: Mapping[FanMode, int] = {
        mode: index for index, mode in enumerate(FanMode)
    }

    if request.action == "power":
        _expect_type(request, bool)
        data[0] = (data[0] & 0xF7) | (0x08 if request.value else 0)
    elif request.action == "temperature":
        if isinstance(request.value, bool) or not isinstance(request.value, int):
            raise ValueError("Invalid value for temperature")
        temperature = max(16, min(30, request.value))
        data[0] |= 0x08
        data[1] = (data[1] & 0xE0) | (temperature - 16)
    elif request.action == "mode":
        if not isinstance(request.value, HvacMode):
            raise ValueError("Invalid value for mode")
        data[0] = (data[0] & 0xF8) | mode_codes[request.value] | 0x08
        data[1] &= 0xBF
    elif request.action == "fan":
        if not isinstance(request.value, FanMode):
            raise ValueError("Invalid value for fan")
        data[0] = (data[0] & 0x8F) | (fan_codes[request.value] << 4) | 0x08
        data[1] &= 0xBF
    elif request.action == "swing":
        if not isinstance(request.value, SwingMode):
            raise ValueError("Invalid value for swing")
        data[0] |= 0x08
        data[2] = {
            SwingMode.OFF: 0x00,
            SwingMode.VERTICAL: 0x01,
            SwingMode.HORIZONTAL: 0x10,
            SwingMode.BOTH: 0x11,
        }[request.value]
    elif request.action in {"sleep", "quiet", "health", "eco", "light"}:
        _expect_type(request, bool)
        data[0] |= 0x08
        byte_index, mask = {
            "sleep": (3, 0x02),
            "quiet": (1, 0x40),
            "health": (3, 0x40),
            "eco": (3, 0x01),
            "light": (3, 0x80),
        }[request.action]
        data[byte_index] = (data[byte_index] & ~mask) | (mask if request.value else 0)
    else:
        raise ValueError(f"Unsupported control action: {request.action}")

    return with_crc(_CONTROL_PREFIX + b"\x00\x00" + data)
