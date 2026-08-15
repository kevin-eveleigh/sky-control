"""Native climate entity for an SWM100 air conditioner."""

from __future__ import annotations

from typing import Any, override

from homeassistant.components.climate import ClimateEntity
from homeassistant.components.climate.const import ClimateEntityFeature, HVACMode
from homeassistant.const import ATTR_TEMPERATURE, UnitOfTemperature
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddEntitiesCallback

from . import SkyControlConfigEntry
from .entity import SkyControlEntity
from .swm100 import ControlRequest, FanMode, HvacMode, SwingMode

_TO_HA_MODE = {
    HvacMode.AUTO: HVACMode.AUTO,
    HvacMode.COOL: HVACMode.COOL,
    HvacMode.DRY: HVACMode.DRY,
    HvacMode.FAN: HVACMode.FAN_ONLY,
    HvacMode.HEAT: HVACMode.HEAT,
}
_FROM_HA_MODE = {value: key for key, value in _TO_HA_MODE.items()}


async def async_setup_entry(
    hass: HomeAssistant,
    entry: SkyControlConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    """Add the unit's single native climate entity."""
    async_add_entities([SkyControlClimate(entry)])


class SkyControlClimate(SkyControlEntity, ClimateEntity):
    """Control verified core SWM100 climate functions."""

    _attr_name = None
    _attr_temperature_unit = UnitOfTemperature.CELSIUS
    _attr_min_temp = 16
    _attr_max_temp = 30
    _attr_target_temperature_step = 1
    _attr_supported_features = (
        ClimateEntityFeature.TARGET_TEMPERATURE
        | ClimateEntityFeature.FAN_MODE
        | ClimateEntityFeature.SWING_MODE
        | ClimateEntityFeature.TURN_ON
        | ClimateEntityFeature.TURN_OFF
    )

    def __init__(self, entry: SkyControlConfigEntry) -> None:
        super().__init__(entry)
        self._attr_hvac_modes = [
            HVACMode.OFF,
            HVACMode.AUTO,
            HVACMode.COOL,
            HVACMode.DRY,
            HVACMode.FAN_ONLY,
            HVACMode.HEAT,
        ]
        self._attr_fan_modes = [mode.value for mode in FanMode]
        self._attr_swing_modes = [mode.value for mode in SwingMode]

    @property
    @override
    def current_temperature(self) -> float | None:
        return self.coordinator.data.indoor_temperature

    @property
    @override
    def target_temperature(self) -> float:
        return self.coordinator.data.target_temperature

    @property
    @override
    def hvac_mode(self) -> HVACMode | None:
        state = self.coordinator.data
        if not state.power:
            return HVACMode.OFF
        return _TO_HA_MODE.get(state.mode) if state.mode is not None else None

    @property
    @override
    def fan_mode(self) -> str | None:
        return self.coordinator.data.fan.value if self.coordinator.data.fan else None

    @property
    @override
    def swing_mode(self) -> str:
        return self.coordinator.data.swing.value

    @override
    async def async_turn_on(self) -> None:
        await self.coordinator.async_command(ControlRequest("power", True))

    @override
    async def async_turn_off(self) -> None:
        await self.coordinator.async_command(ControlRequest("power", False))

    @override
    async def async_set_hvac_mode(self, hvac_mode: HVACMode) -> None:
        if hvac_mode == HVACMode.OFF:
            await self.async_turn_off()
            return
        await self.coordinator.async_command(
            ControlRequest("mode", _FROM_HA_MODE[hvac_mode])
        )

    @override
    async def async_set_temperature(self, **kwargs: Any) -> None:
        temperature = kwargs.get(ATTR_TEMPERATURE)
        if temperature is None:
            return
        await self.coordinator.async_command(
            ControlRequest("temperature", round(float(temperature)))
        )

    @override
    async def async_set_fan_mode(self, fan_mode: str) -> None:
        await self.coordinator.async_command(ControlRequest("fan", FanMode(fan_mode)))

    @override
    async def async_set_swing_mode(self, swing_mode: str) -> None:
        await self.coordinator.async_command(
            ControlRequest("swing", SwingMode(swing_mode))
        )
