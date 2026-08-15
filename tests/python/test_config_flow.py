"""Config-flow discovery, manual setup, validation, and duplicate tests."""

from __future__ import annotations

from unittest.mock import AsyncMock, patch

from homeassistant.config_entries import SOURCE_USER
from homeassistant.const import CONF_HOST, CONF_PORT
from homeassistant.core import HomeAssistant
from homeassistant.data_entry_flow import FlowResultType
from pytest_homeassistant_custom_component.common import MockConfigEntry

from custom_components.sky_control.const import (
    CONF_DEVICE,
    CONF_FRIENDLY_NAME,
    CONF_MAC,
    DOMAIN,
)
from custom_components.sky_control.swm100 import (
    DeviceInfo,
    State,
    Swm100ConnectionTimeout,
    Swm100ProtocolError,
)


async def _start_manual(hass: HomeAssistant) -> dict[str, object]:
    result = await hass.config_entries.flow.async_init(
        DOMAIN, context={"source": SOURCE_USER}
    )
    assert result["type"] is FlowResultType.MENU
    return await hass.config_entries.flow.async_configure(
        result["flow_id"], {"next_step_id": "manual"}
    )


async def test_manual_setup_uses_read_only_validation(
    hass: HomeAssistant, cool_state: State
) -> None:
    result = await _start_manual(hass)
    assert result["type"] is FlowResultType.FORM
    with patch(
        "custom_components.sky_control.config_flow.Swm100Client.async_get_status",
        AsyncMock(return_value=cool_state),
    ) as status:
        result = await hass.config_entries.flow.async_configure(
            result["flow_id"],
            {
                CONF_HOST: "ac.example.local",
                CONF_PORT: 1998,
                CONF_FRIENDLY_NAME: "Bedroom AC",
            },
        )
    assert result["type"] is FlowResultType.CREATE_ENTRY
    assert result["title"] == "Bedroom AC"
    assert result["data"][CONF_HOST] == "ac.example.local"
    assert result["result"].unique_id.startswith("manual-")
    assert status.await_count == 2


async def test_discovery_selection_uses_mac_unique_id(
    hass: HomeAssistant, cool_state: State
) -> None:
    discovered = DeviceInfo(
        "192.0.2.10",
        1998,
        mac="00:11:22:33:44:55",
        name="AC_TEST",
        model="0102",
        protocol="a0b0",
    )
    with (
        patch(
            "custom_components.sky_control.config_flow.async_discover_devices",
            AsyncMock(return_value=[discovered]),
        ),
        patch(
            "custom_components.sky_control.config_flow.Swm100Client.async_get_status",
            AsyncMock(return_value=cool_state),
        ),
    ):
        result = await hass.config_entries.flow.async_init(
            DOMAIN, context={"source": SOURCE_USER}
        )
        result = await hass.config_entries.flow.async_configure(
            result["flow_id"], {"next_step_id": "scan"}
        )
        result = await hass.config_entries.flow.async_configure(
            result["flow_id"],
            {
                CONF_DEVICE: discovered.mac,
                CONF_FRIENDLY_NAME: "Living room AC",
            },
        )
    assert result["type"] is FlowResultType.CREATE_ENTRY
    assert result["result"].unique_id == "00:11:22:33:44:55"
    assert result["data"][CONF_MAC] == discovered.mac


async def test_validation_errors_are_helpful(
    hass: HomeAssistant, cool_state: State
) -> None:
    for error, expected in (
        (Swm100ConnectionTimeout(), "cannot_connect"),
        (Swm100ProtocolError(), "invalid_response"),
    ):
        result = await _start_manual(hass)
        with patch(
            "custom_components.sky_control.config_flow.Swm100Client.async_get_status",
            AsyncMock(side_effect=error),
        ):
            result = await hass.config_entries.flow.async_configure(
                result["flow_id"],
                {
                    CONF_HOST: "unreachable.example.local",
                    CONF_PORT: 1998,
                    CONF_FRIENDLY_NAME: "Test AC",
                },
            )
        assert result["type"] is FlowResultType.FORM
        assert result["errors"] == {"base": expected}


async def test_duplicate_endpoint_is_aborted(
    hass: HomeAssistant, cool_state: State
) -> None:
    existing = MockConfigEntry(
        domain=DOMAIN,
        title="Existing",
        unique_id="manual-existing",
        data={CONF_HOST: "ac.example.local", CONF_PORT: 1998},
    )
    existing.add_to_hass(hass)
    result = await _start_manual(hass)
    with patch(
        "custom_components.sky_control.config_flow.Swm100Client.async_get_status",
        AsyncMock(return_value=cool_state),
    ):
        result = await hass.config_entries.flow.async_configure(
            result["flow_id"],
            {
                CONF_HOST: "ac.example.local",
                CONF_PORT: 1998,
                CONF_FRIENDLY_NAME: "Duplicate",
            },
        )
    assert result["type"] is FlowResultType.ABORT
    assert result["reason"] == "already_configured"


async def test_scan_handles_no_devices_and_listener_failure(
    hass: HomeAssistant,
) -> None:
    for result_or_error, expected in (
        ([], "no_devices_found"),
        (Swm100ConnectionTimeout(), "scan_failed"),
    ):
        mock = (
            AsyncMock(side_effect=result_or_error)
            if isinstance(result_or_error, BaseException)
            else AsyncMock(return_value=result_or_error)
        )
        with patch(
            "custom_components.sky_control.config_flow.async_discover_devices", mock
        ):
            result = await hass.config_entries.flow.async_init(
                DOMAIN, context={"source": SOURCE_USER}
            )
            result = await hass.config_entries.flow.async_configure(
                result["flow_id"], {"next_step_id": "scan"}
            )
        assert result["type"] is FlowResultType.FORM
        assert result["errors"] == {"base": expected}
