"""Typed models independent of Home Assistant."""

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum


class HvacMode(StrEnum):
    """Modes reported by an SWM100 unit."""

    AUTO = "auto"
    COOL = "cool"
    DRY = "dry"
    FAN = "fan"
    HEAT = "heat"


class FanMode(StrEnum):
    """Fan settings reported by an SWM100 unit."""

    AUTO = "auto"
    GEAR_1 = "gear-1"
    GEAR_2 = "gear-2"
    GEAR_3 = "gear-3"
    GEAR_4 = "gear-4"
    GEAR_5 = "gear-5"
    VARIABLE = "variable"


class SwingMode(StrEnum):
    """Louvre movement settings reported by an SWM100 unit."""

    OFF = "off"
    VERTICAL = "vertical"
    HORIZONTAL = "horizontal"
    BOTH = "both"


@dataclass(frozen=True, slots=True)
class DeviceInfo:
    """Safe protocol metadata plus the endpoint used to contact a unit."""

    host: str
    port: int
    mac: str | None = None
    name: str | None = None
    model: str | None = None
    protocol: str | None = None


@dataclass(frozen=True, slots=True)
class State:
    """Decoded SWM100 air-conditioner state."""

    power: bool
    target_temperature: int
    indoor_temperature: float | None
    mode: HvacMode | None
    fan: FanMode | None
    swing: SwingMode
    sleep: bool
    quiet: bool
    light: bool
    health: bool
    eco: bool


type ControlValue = bool | int | HvacMode | FanMode | SwingMode


@dataclass(frozen=True, slots=True)
class ControlRequest:
    """A validated control mutation used by the packet builder and client."""

    action: str
    value: ControlValue
