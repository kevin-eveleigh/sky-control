"""Normalized exceptions for the SWM100 protocol client."""

from __future__ import annotations


class Swm100Error(Exception):
    """Base exception with a stable, non-sensitive diagnostic code."""

    code = "SWM100_ERROR"


class Swm100ConnectionError(Swm100Error):
    """The device could not be reached or disconnected unexpectedly."""

    code = "CONNECTION_ERROR"


class Swm100ConnectionTimeout(Swm100ConnectionError):
    """A bounded connection or response timeout expired."""

    code = "CONNECTION_TIMEOUT"


class Swm100ProtocolError(Swm100Error):
    """The device returned no usable SWM100 state frame."""

    code = "PROTOCOL_ERROR"


class Swm100InvalidFrame(Swm100ProtocolError):
    """A frame did not satisfy the SWM100 framing contract."""

    code = "INVALID_FRAME"


def normalize_exception(error: BaseException) -> Swm100Error:
    """Convert runtime network exceptions to stable SWM100 exceptions."""
    if isinstance(error, Swm100Error):
        return error
    if isinstance(error, TimeoutError):
        return Swm100ConnectionTimeout()
    if isinstance(error, (ConnectionError, OSError)):
        return Swm100ConnectionError()
    return Swm100Error()
