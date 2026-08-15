"""Shared entity behavior for Sky Control."""

from __future__ import annotations

from homeassistant.helpers.device_registry import DeviceInfo
from homeassistant.helpers.update_coordinator import CoordinatorEntity

from . import SkyControlConfigEntry
from .const import CONF_MODEL, DOMAIN, INTEGRATION_NAME
from .coordinator import SkyControlCoordinator


class SkyControlEntity(CoordinatorEntity[SkyControlCoordinator]):
    """Base entity backed only by coordinator-cached state."""

    _attr_has_entity_name = True

    def __init__(self, entry: SkyControlConfigEntry) -> None:
        super().__init__(entry.runtime_data.coordinator)
        unique_id = entry.unique_id or entry.entry_id
        self._attr_unique_id = unique_id
        self._attr_device_info = DeviceInfo(
            identifiers={(DOMAIN, unique_id)},
            name=entry.title,
            manufacturer=INTEGRATION_NAME,
            model=entry.data.get(CONF_MODEL) or "SWM100-family air conditioner",
        )
