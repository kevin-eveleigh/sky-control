"""UI-only config flow for Sky Control units."""

from __future__ import annotations

from typing import Any, override
from uuid import uuid4

import voluptuous as vol
from homeassistant.config_entries import ConfigFlow, ConfigFlowResult
from homeassistant.const import CONF_HOST, CONF_PORT
from homeassistant.helpers.device_registry import format_mac

from .const import (
    CONF_DEVICE,
    CONF_FRIENDLY_NAME,
    CONF_MAC,
    CONF_MODEL,
    CONF_PROTOCOL,
    DEFAULT_NAME,
    DEFAULT_PORT,
    DOMAIN,
)
from .swm100 import (
    DeviceInfo,
    Swm100Client,
    Swm100ConnectionError,
    Swm100ProtocolError,
    async_discover_devices,
)

_HOST = vol.All(str, vol.Strip, vol.Length(min=1, max=253))
_NAME = vol.All(str, vol.Strip, vol.Length(min=1, max=100))
_PORT = vol.All(vol.Coerce(int), vol.Range(min=1, max=65535))


class SkyControlConfigFlow(ConfigFlow, domain=DOMAIN):
    """Configure one directly connected SWM100 unit."""

    VERSION = 1

    def __init__(self) -> None:
        self._discovered: dict[str, DeviceInfo] = {}

    @override
    async def async_step_user(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        """Choose active local scanning or manual setup."""
        return self.async_show_menu(step_id="user", menu_options=["scan", "manual"])

    async def async_step_scan(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        """Discover devices, then validate the selected unit read-only."""
        errors: dict[str, str] = {}
        if not self._discovered:
            try:
                devices = await async_discover_devices()
            except Swm100ConnectionError:
                devices = []
                errors["base"] = "scan_failed"
            self._discovered = {
                device.mac or f"endpoint:{device.host}:{device.port}": device
                for device in devices
            }

        if user_input is not None:
            device = self._discovered[user_input[CONF_DEVICE]]
            name = user_input[CONF_FRIENDLY_NAME]
            error = await self._async_validate(device)
            if error is None:
                return await self._async_create_device_entry(device, name)
            errors["base"] = error

        if not self._discovered and "base" not in errors:
            errors["base"] = "no_devices_found"
        choices = {
            key: device.name or DEFAULT_NAME for key, device in self._discovered.items()
        }
        schema = vol.Schema(
            {
                vol.Required(CONF_DEVICE): vol.In(choices),
                vol.Required(CONF_FRIENDLY_NAME, default=DEFAULT_NAME): _NAME,
            }
        )
        return self.async_show_form(step_id="scan", data_schema=schema, errors=errors)

    async def async_step_manual(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        """Validate and add an explicitly entered endpoint."""
        errors: dict[str, str] = {}
        if user_input is not None:
            device = DeviceInfo(host=user_input[CONF_HOST], port=user_input[CONF_PORT])
            error = await self._async_validate(device)
            if error is None:
                return await self._async_create_device_entry(
                    device, user_input[CONF_FRIENDLY_NAME]
                )
            errors["base"] = error

        schema = vol.Schema(
            {
                vol.Required(CONF_HOST): _HOST,
                vol.Required(CONF_PORT, default=DEFAULT_PORT): _PORT,
                vol.Required(CONF_FRIENDLY_NAME, default=DEFAULT_NAME): _NAME,
            }
        )
        return self.async_show_form(step_id="manual", data_schema=schema, errors=errors)

    async def _async_validate(self, device: DeviceInfo) -> str | None:
        """Perform a read-only status request and return a translated error key."""
        try:
            await Swm100Client(device.host, device.port).async_get_status()
        except Swm100ProtocolError:
            return "invalid_response"
        except Swm100ConnectionError:
            return "cannot_connect"
        return None

    async def _async_create_device_entry(
        self, device: DeviceInfo, name: str
    ) -> ConfigFlowResult:
        """Create an entry with a stable identifier and duplicate prevention."""
        self._async_abort_entries_match(
            {CONF_HOST: device.host, CONF_PORT: device.port}
        )
        if device.mac:
            unique_id = format_mac(device.mac)
            await self.async_set_unique_id(unique_id)
            self._abort_if_unique_id_configured()
        else:
            # A generated identifier remains stable for the entry without
            # incorrectly treating a mutable IP address as a device identity.
            unique_id = f"manual-{uuid4()}"
            await self.async_set_unique_id(unique_id)
        return self.async_create_entry(
            title=name,
            data={
                CONF_HOST: device.host,
                CONF_PORT: device.port,
                CONF_MAC: device.mac,
                CONF_MODEL: device.model,
                CONF_PROTOCOL: device.protocol,
            },
        )
