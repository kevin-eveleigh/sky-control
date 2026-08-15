"""Constants for the Sky Control integration."""

from datetime import timedelta

DOMAIN = "sky_control"
INTEGRATION_NAME = "Sky Control (SWM100)"
INTEGRATION_VERSION = "0.3.0-beta.1"
PROTOCOL_FAMILY = "Skyworth SWM100"
DEFAULT_NAME = "Sky Control AC"
DEFAULT_PORT = 1998
DEFAULT_POLL_INTERVAL = timedelta(seconds=30)

CONF_MAC = "mac"
CONF_MODEL = "model"
CONF_PROTOCOL = "protocol"
CONF_DEVICE = "device"
CONF_FRIENDLY_NAME = "friendly_name"

CAPABILITIES: dict[str, object] = {
    "temperature_celsius": {"minimum": 16, "maximum": 30, "step": 1},
    "hvac_modes": ["off", "auto", "cool", "dry", "fan_only", "heat"],
    "fan_modes": [
        "auto",
        "gear-1",
        "gear-2",
        "gear-3",
        "gear-4",
        "gear-5",
        "variable",
    ],
    "swing_modes": ["off", "vertical", "horizontal", "both"],
}
