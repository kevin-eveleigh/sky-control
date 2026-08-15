"""Privacy-preserving config-entry diagnostics."""

from __future__ import annotations

from typing import Any

from homeassistant.core import HomeAssistant

from . import SkyControlConfigEntry
from .const import (
    CAPABILITIES,
    CONF_MODEL,
    CONF_PROTOCOL,
    INTEGRATION_VERSION,
    PROTOCOL_FAMILY,
)


async def async_get_config_entry_diagnostics(
    hass: HomeAssistant, entry: SkyControlConfigEntry
) -> dict[str, Any]:
    """Return only explicitly safe, non-identifying diagnostics."""
    coordinator = entry.runtime_data.coordinator
    return {
        "integration_version": INTEGRATION_VERSION,
        "protocol_family": PROTOCOL_FAMILY,
        "available": coordinator.last_update_success,
        "reported": {
            "model": entry.data.get(CONF_MODEL),
            "protocol": entry.data.get(CONF_PROTOCOL),
        },
        "capabilities": CAPABILITIES,
        "last_communication_error": coordinator.last_error,
        "redacted": {
            "network_address": "REDACTED",
            "mac_address": "REDACTED",
            "unique_id": "REDACTED",
            "user_assigned_name": "REDACTED",
            "area": "REDACTED",
            "raw_packets": "NOT_COLLECTED",
            "private_paths": "NOT_COLLECTED",
        },
    }
