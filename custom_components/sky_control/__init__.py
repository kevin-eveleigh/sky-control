"""Set up the Sky Control custom integration."""

from __future__ import annotations

from dataclasses import dataclass

from homeassistant.config_entries import ConfigEntry
from homeassistant.const import CONF_HOST, CONF_PORT, Platform
from homeassistant.core import HomeAssistant

from .coordinator import SkyControlCoordinator
from .swm100 import Swm100Client

PLATFORMS = [Platform.CLIMATE]


@dataclass(slots=True)
class SkyControlRuntimeData:
    """Typed objects whose lifecycle matches a config entry."""

    client: Swm100Client
    coordinator: SkyControlCoordinator


type SkyControlConfigEntry = ConfigEntry[SkyControlRuntimeData]


async def async_setup_entry(hass: HomeAssistant, entry: SkyControlConfigEntry) -> bool:
    """Set up a Sky Control unit from a config entry."""
    client = Swm100Client(entry.data[CONF_HOST], entry.data[CONF_PORT])
    coordinator = SkyControlCoordinator(hass, client)
    await coordinator.async_config_entry_first_refresh()
    entry.runtime_data = SkyControlRuntimeData(client, coordinator)
    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)
    return True


async def async_unload_entry(hass: HomeAssistant, entry: SkyControlConfigEntry) -> bool:
    """Unload a Sky Control config entry."""
    return await hass.config_entries.async_unload_platforms(entry, PLATFORMS)
