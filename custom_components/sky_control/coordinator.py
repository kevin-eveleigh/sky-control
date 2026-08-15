"""Coordinated polling and serialized commands for Sky Control."""

from __future__ import annotations

import logging

from homeassistant.core import HomeAssistant
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers.update_coordinator import DataUpdateCoordinator, UpdateFailed

from .const import DEFAULT_POLL_INTERVAL, DOMAIN
from .swm100 import ControlRequest, State, Swm100Client, Swm100Error

_LOGGER = logging.getLogger(__name__)


class SkyControlCoordinator(DataUpdateCoordinator[State]):
    """Own cached state and all communication with one unit."""

    def __init__(self, hass: HomeAssistant, client: Swm100Client) -> None:
        super().__init__(
            hass,
            _LOGGER,
            name=DOMAIN,
            update_interval=DEFAULT_POLL_INTERVAL,
            always_update=False,
        )
        self.client = client
        self.last_error: str | None = None

    async def _async_update_data(self) -> State:
        try:
            state = await self.client.async_get_status()
        except Swm100Error as error:
            self.last_error = error.code
            raise UpdateFailed(
                translation_domain=DOMAIN,
                translation_key="communication_failed",
            ) from error
        self.last_error = None
        return state

    async def async_command(self, request: ControlRequest) -> None:
        """Run a command and publish only its confirmed post-command state."""
        try:
            state = await self.client.async_control(request)
        except Swm100Error as error:
            self.last_error = error.code
            raise HomeAssistantError(
                translation_domain=DOMAIN,
                translation_key="command_failed",
            ) from error
        self.last_error = None
        self.async_set_updated_data(state)
