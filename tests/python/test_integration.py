"""Setup, lifecycle, coordinator, climate, and diagnostics tests."""

from __future__ import annotations

import json
from dataclasses import replace
from unittest.mock import AsyncMock, patch

import pytest
from homeassistant.components.climate.const import (
    ATTR_FAN_MODE,
    ATTR_HVAC_MODE,
    ATTR_SWING_MODE,
    SERVICE_SET_FAN_MODE,
    SERVICE_SET_HVAC_MODE,
    SERVICE_SET_SWING_MODE,
    SERVICE_SET_TEMPERATURE,
    HVACMode,
)
from homeassistant.components.climate.const import (
    DOMAIN as CLIMATE_DOMAIN,
)
from homeassistant.const import (
    ATTR_ENTITY_ID,
    ATTR_TEMPERATURE,
    CONF_HOST,
    CONF_PORT,
    SERVICE_TURN_OFF,
    SERVICE_TURN_ON,
    STATE_UNAVAILABLE,
)
from homeassistant.core import HomeAssistant
from homeassistant.exceptions import HomeAssistantError
from pytest_homeassistant_custom_component.common import MockConfigEntry

from custom_components.sky_control.const import (
    CONF_MAC,
    CONF_MODEL,
    CONF_PROTOCOL,
    DOMAIN,
)
from custom_components.sky_control.diagnostics import async_get_config_entry_diagnostics
from custom_components.sky_control.swm100 import (
    ControlRequest,
    FanMode,
    HvacMode,
    State,
    SwingMode,
    Swm100ConnectionError,
)


def _entry() -> MockConfigEntry:
    return MockConfigEntry(
        domain=DOMAIN,
        title="Bedroom AC",
        unique_id="00:11:22:33:44:55",
        data={
            CONF_HOST: "192.0.2.10",
            CONF_PORT: 1998,
            CONF_MAC: "00:11:22:33:44:55",
            CONF_MODEL: "0102",
            CONF_PROTOCOL: "a0b0",
        },
    )


async def test_setup_reload_unload_and_recovery(
    hass: HomeAssistant, cool_state: State
) -> None:
    entry = _entry()
    entry.add_to_hass(hass)
    status = AsyncMock(return_value=cool_state)
    with patch(
        "custom_components.sky_control.swm100.client.Swm100Client.async_get_status",
        status,
    ):
        assert await hass.config_entries.async_setup(entry.entry_id)
        await hass.async_block_till_done()
        entity_id = "climate.bedroom_ac"
        assert hass.states.get(entity_id) is not None

        status.side_effect = Swm100ConnectionError()
        await entry.runtime_data.coordinator.async_refresh()
        assert hass.states.get(entity_id).state == STATE_UNAVAILABLE

        status.side_effect = None
        status.return_value = cool_state
        await entry.runtime_data.coordinator.async_refresh()
        assert hass.states.get(entity_id).state == HVACMode.COOL

        assert await hass.config_entries.async_reload(entry.entry_id)
        await hass.async_block_till_done()
        assert hass.states.get(entity_id) is not None
        assert await hass.config_entries.async_unload(entry.entry_id)
        assert hass.states.get(entity_id).state == STATE_UNAVAILABLE


async def test_climate_mapping_and_every_core_command(
    hass: HomeAssistant, cool_state: State
) -> None:
    entry = _entry()
    entry.add_to_hass(hass)
    commands: list[ControlRequest] = []

    async def control(request: ControlRequest) -> State:
        commands.append(request)
        if request.action == "power":
            return replace(cool_state, power=bool(request.value))
        if request.action == "mode":
            return replace(cool_state, power=True, mode=request.value)  # type: ignore[arg-type]
        if request.action == "temperature":
            return replace(cool_state, target_temperature=int(request.value))
        if request.action == "fan":
            return replace(cool_state, fan=request.value)  # type: ignore[arg-type]
        if request.action == "swing":
            return replace(cool_state, swing=request.value)  # type: ignore[arg-type]
        return cool_state

    with (
        patch(
            "custom_components.sky_control.swm100.client.Swm100Client.async_get_status",
            AsyncMock(return_value=cool_state),
        ),
        patch(
            "custom_components.sky_control.swm100.client.Swm100Client.async_control",
            AsyncMock(side_effect=control),
        ),
    ):
        assert await hass.config_entries.async_setup(entry.entry_id)
        await hass.async_block_till_done()
        entity_id = "climate.bedroom_ac"
        state = hass.states.get(entity_id)
        assert state is not None
        assert state.state == HVACMode.COOL
        assert state.attributes["current_temperature"] == 24.5
        assert state.attributes["temperature"] == 20
        assert state.attributes["fan_modes"] == [mode.value for mode in FanMode]
        assert state.attributes["swing_modes"] == [mode.value for mode in SwingMode]
        assert "hvac_action" not in state.attributes

        calls = (
            (SERVICE_TURN_OFF, {}),
            (SERVICE_TURN_ON, {}),
            (SERVICE_SET_HVAC_MODE, {ATTR_HVAC_MODE: HVACMode.OFF}),
            (SERVICE_SET_HVAC_MODE, {ATTR_HVAC_MODE: HVACMode.HEAT}),
            (SERVICE_SET_TEMPERATURE, {ATTR_TEMPERATURE: 23}),
            (SERVICE_SET_FAN_MODE, {ATTR_FAN_MODE: FanMode.GEAR_5.value}),
            (SERVICE_SET_SWING_MODE, {ATTR_SWING_MODE: SwingMode.BOTH.value}),
        )
        for service, data in calls:
            await hass.services.async_call(
                CLIMATE_DOMAIN,
                service,
                {ATTR_ENTITY_ID: entity_id, **data},
                blocking=True,
            )

    assert commands == [
        ControlRequest("power", False),
        ControlRequest("power", True),
        ControlRequest("power", False),
        ControlRequest("mode", HvacMode.HEAT),
        ControlRequest("temperature", 23),
        ControlRequest("fan", FanMode.GEAR_5),
        ControlRequest("swing", SwingMode.BOTH),
    ]


async def test_failed_command_raises_translated_home_assistant_error(
    hass: HomeAssistant, cool_state: State
) -> None:
    entry = _entry()
    entry.add_to_hass(hass)
    with (
        patch(
            "custom_components.sky_control.swm100.client.Swm100Client.async_get_status",
            AsyncMock(return_value=cool_state),
        ),
        patch(
            "custom_components.sky_control.swm100.client.Swm100Client.async_control",
            AsyncMock(side_effect=Swm100ConnectionError()),
        ),
    ):
        assert await hass.config_entries.async_setup(entry.entry_id)
        await hass.async_block_till_done()
        with pytest.raises(HomeAssistantError) as raised:
            await hass.services.async_call(
                CLIMATE_DOMAIN,
                SERVICE_TURN_OFF,
                {ATTR_ENTITY_ID: "climate.bedroom_ac"},
                blocking=True,
            )
    assert raised.value.translation_domain == DOMAIN
    assert raised.value.translation_key == "command_failed"


async def test_diagnostics_are_allowlisted_and_redacted(
    hass: HomeAssistant, cool_state: State
) -> None:
    entry = _entry()
    entry.add_to_hass(hass)
    with patch(
        "custom_components.sky_control.swm100.client.Swm100Client.async_get_status",
        AsyncMock(return_value=cool_state),
    ):
        assert await hass.config_entries.async_setup(entry.entry_id)
        await hass.async_block_till_done()
        diagnostics = await async_get_config_entry_diagnostics(hass, entry)

    serialized = json.dumps(diagnostics, sort_keys=True)
    assert diagnostics["reported"] == {"model": "0102", "protocol": "a0b0"}
    assert diagnostics["available"] is True
    assert diagnostics["redacted"]["raw_packets"] == "NOT_COLLECTED"
    for secret in (
        "192.0.2.10",
        "00:11:22:33:44:55",
        "Bedroom AC",
        entry.unique_id,
        entry.entry_id,
    ):
        assert secret not in serialized
