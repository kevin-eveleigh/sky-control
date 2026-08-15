"""Shared fixtures for Sky Control Home Assistant tests."""

from __future__ import annotations

import json
from collections.abc import Generator
from pathlib import Path
from typing import Any

import pytest

from custom_components.sky_control.swm100 import FanMode, HvacMode, State, SwingMode

FIXTURE_PATH = (
    Path(__file__).parents[2] / "fixtures" / "protocol" / "swm100-status.json"
)


@pytest.fixture(autouse=True)
def auto_enable_custom_integrations(
    enable_custom_integrations: None,
) -> Generator[None]:
    """Allow Home Assistant to load custom integrations in every test."""
    yield


@pytest.fixture
def protocol_fixture() -> dict[str, Any]:
    """Load the same sanitized fixture consumed by the TypeScript suite."""
    return json.loads(FIXTURE_PATH.read_text(encoding="utf-8"))


@pytest.fixture
def cool_state() -> State:
    """Return the captured cool/auto-fan state in typed form."""
    return State(
        power=True,
        target_temperature=20,
        indoor_temperature=24.5,
        mode=HvacMode.COOL,
        fan=FanMode.AUTO,
        swing=SwingMode.OFF,
        sleep=False,
        quiet=False,
        light=True,
        health=False,
        eco=False,
    )
