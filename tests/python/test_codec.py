"""Cross-language fixture conformance and pure packet tests."""

from __future__ import annotations

from typing import Any

import pytest

from custom_components.sky_control.swm100 import (
    STATUS_QUERY,
    ControlRequest,
    FanMode,
    HvacMode,
    SwingMode,
    Swm100InvalidFrame,
    build_control_frame,
    consume_frames,
    has_valid_crc,
    is_state_frame,
    parse_discovery_reply,
    parse_state,
    with_crc,
)


def _request(raw: dict[str, Any]) -> ControlRequest:
    value = raw["value"]
    if raw["action"] == "mode":
        value = HvacMode(value)
    elif raw["action"] == "fan":
        value = FanMode(value)
    elif raw["action"] == "swing":
        value = SwingMode(value)
    return ControlRequest(raw["action"], value)


def test_captured_state_and_status_query_conform(
    protocol_fixture: dict[str, Any],
) -> None:
    """Decode all state fields and reproduce both captured request vectors."""
    frame = bytes.fromhex(protocol_fixture["frames"]["coolVariable"]["hex"])
    expected = protocol_fixture["frames"]["coolVariable"]["expectedState"]
    state = parse_state(frame)

    assert state.power is expected["power"]
    assert state.target_temperature == expected["targetTemperature"]
    assert state.indoor_temperature == expected["indoorTemperature"]
    assert state.mode == expected["mode"]
    assert state.fan == expected["fan"]
    assert state.swing == expected["swing"]
    assert state.sleep is expected["sleep"]
    assert state.quiet is expected["quiet"]
    assert state.light is expected["light"]
    assert state.health is expected["health"]
    assert state.eco is expected["eco"]
    assert STATUS_QUERY.hex() == protocol_fixture["expectedFrames"]["statusQuery"]
    assert (
        build_control_frame(frame, ControlRequest("power", False)).hex()
        == protocol_fixture["expectedFrames"]["powerOff"]
    )


def test_every_derived_control_vector_conforms(
    protocol_fixture: dict[str, Any],
) -> None:
    """Reproduce every explicitly non-captured core climate command vector."""
    group = protocol_fixture["derivedControlVectors"]
    assert "not captured traffic" in group["notice"]
    source = bytes.fromhex(protocol_fixture["frames"][group["sourceFrame"]]["hex"])
    for vector in group["vectors"]:
        assert (
            build_control_frame(source, _request(vector["request"])).hex()
            == vector["hex"]
        )


def test_frame_consumption_preserves_fragmented_tail_and_resynchronizes(
    protocol_fixture: dict[str, Any],
) -> None:
    """Keep partial TCP frames, reject corruption, and skip leading noise."""
    frame = bytes.fromhex(protocol_fixture["frames"]["coolAuto"]["hex"])
    frames, rest = consume_frames(frame[:11])
    assert frames == []
    assert rest == frame[:11]
    frames, rest = consume_frames(rest + frame[11:])
    assert frames == [frame]
    assert rest == b""

    corrupt = frame[:-1] + bytes((frame[-1] ^ 0xFF,))
    assert not has_valid_crc(corrupt)
    assert consume_frames(corrupt)[0] == []
    assert consume_frames(b"\x00\xffgarbage" + frame)[0] == [frame]


def test_state_validation_rejects_malformed_frames(
    protocol_fixture: dict[str, Any],
) -> None:
    frame = bytearray.fromhex(protocol_fixture["frames"]["coolAuto"]["hex"])
    frame[-1] ^= 0xFF
    assert not is_state_frame(bytes(frame))
    with pytest.raises(Swm100InvalidFrame):
        parse_state(bytes(frame))
    with pytest.raises(Swm100InvalidFrame):
        build_control_frame(bytes(frame), ControlRequest("power", True))


def test_discovery_reply_parser_is_typed_and_strict() -> None:
    def field(field_id: int, value: bytes) -> bytes:
        return bytes((field_id, len(value))) + value

    reply = (
        b"\xbe\x02"
        + field(1, bytes.fromhex("001122334455"))
        + field(3, bytes.fromhex("0102"))
        + field(4, bytes.fromhex("a0b0"))
        + field(5, b"AC_TEST")
    )
    device = parse_discovery_reply(reply, "192.0.2.10", 2998)
    assert device is not None
    assert device.host == "192.0.2.10"
    assert device.port == 2998
    assert device.mac == "00:11:22:33:44:55"
    assert device.name == "AC_TEST"
    assert device.model == "0102"
    assert device.protocol == "a0b0"
    assert parse_discovery_reply(reply[:-1], "192.0.2.10") is None
    assert parse_discovery_reply(b"\xbe\x01\x00\x00", "192.0.2.10") is None


def test_unknown_state_codes_and_all_control_validation_branches(
    protocol_fixture: dict[str, Any],
) -> None:
    source = bytes.fromhex(protocol_fixture["frames"]["coolAuto"]["hex"])
    unknown = bytearray(source[:-2])
    unknown[10] = 200
    unknown[13] = (unknown[13] & 0x08) | 0x77
    state = parse_state(with_crc(bytes(unknown)))
    assert state.indoor_temperature is None
    assert state.mode is None
    assert state.fan is None

    for action in ("sleep", "quiet", "health", "eco", "light"):
        assert build_control_frame(source, ControlRequest(action, True))
        assert build_control_frame(source, ControlRequest(action, False))

    invalid = (
        ControlRequest("power", 1),
        ControlRequest("temperature", True),
        ControlRequest("mode", "cool"),
        ControlRequest("fan", "auto"),
        ControlRequest("swing", "off"),
        ControlRequest("unknown", True),
    )
    for request in invalid:
        with pytest.raises(ValueError):
            build_control_frame(source, request)

    assert consume_frames(bytes.fromhex("7a7a000005")) == ([], b"\x7a\x00\x00\x05")
