"""Library-shaped asynchronous SWM100 protocol client."""

from .client import Swm100Client
from .codec import (
    HEARTBEAT,
    STATUS_QUERY,
    build_control_frame,
    consume_frames,
    crc16_modbus,
    has_valid_crc,
    is_state_frame,
    parse_state,
    with_crc,
)
from .discovery import (
    DEFAULT_CONTROL_PORT,
    async_discover_devices,
    parse_discovery_reply,
)
from .exceptions import (
    Swm100ConnectionError,
    Swm100ConnectionTimeout,
    Swm100Error,
    Swm100InvalidFrame,
    Swm100ProtocolError,
)
from .models import ControlRequest, DeviceInfo, FanMode, HvacMode, State, SwingMode

__all__ = [
    "DEFAULT_CONTROL_PORT",
    "HEARTBEAT",
    "STATUS_QUERY",
    "ControlRequest",
    "DeviceInfo",
    "FanMode",
    "HvacMode",
    "State",
    "SwingMode",
    "Swm100Client",
    "Swm100ConnectionError",
    "Swm100ConnectionTimeout",
    "Swm100Error",
    "Swm100InvalidFrame",
    "Swm100ProtocolError",
    "async_discover_devices",
    "build_control_frame",
    "consume_frames",
    "crc16_modbus",
    "has_valid_crc",
    "is_state_frame",
    "parse_discovery_reply",
    "parse_state",
    "with_crc",
]
