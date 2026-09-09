from __future__ import annotations

from typing import Iterable, Sequence

REALTIME_MODELS = (
    "gemini-3.1-flash-live-preview",
    "gemini-2.5-flash-native-audio-preview-12-2025",
)
DEFAULT_REALTIME_MODEL = REALTIME_MODELS[0]
DEFAULT_REALTIME_FALLBACK = REALTIME_MODELS[1]

COACH_MODELS = (
    "gemini-3.5-flash-lite",
    "gemini-3.1-flash-lite",
    "gemini-3.6-flash",
)
DEFAULT_COACH_MODEL = COACH_MODELS[0]
DEFAULT_COACH_FALLBACKS = COACH_MODELS[1:]

_RETRYABLE_ERROR_MARKERS = (
    "RESOURCE_EXHAUSTED",
    "UNAVAILABLE",
    "DEADLINE_EXCEEDED",
    "TIMEOUT",
    "TIMED OUT",
    "CONNECTION RESET",
    "CONNECTION ABORTED",
    "TEMPORARILY UNAVAILABLE",
)


def alternate_realtime_model(selected: str) -> str:
    for model in REALTIME_MODELS:
        if model != selected:
            return model
    return DEFAULT_REALTIME_FALLBACK


def coach_model_order(
    mode: str,
    selected: str,
    fallbacks: Iterable[str] = DEFAULT_COACH_FALLBACKS,
) -> tuple[str, ...]:
    if selected not in COACH_MODELS:
        selected = DEFAULT_COACH_MODEL
    if mode == "manual":
        return (selected,)

    ordered: list[str] = []
    for model in (selected, *fallbacks, *COACH_MODELS):
        if model in COACH_MODELS and model not in ordered:
            ordered.append(model)
    return tuple(ordered)


def rotate_keys(
    keys: Sequence[tuple[int, str]],
    turn_no: int,
) -> tuple[tuple[int, str], ...]:
    if not keys:
        return ()
    start = (max(1, int(turn_no)) - 1) % len(keys)
    return tuple(keys[start:]) + tuple(keys[:start])


def coach_attempt_order(
    *,
    mode: str,
    selected: str,
    fallbacks: Iterable[str],
    keys: Sequence[tuple[int, str]],
    turn_no: int,
) -> tuple[tuple[str, int, str], ...]:
    key_order = rotate_keys(keys, turn_no)
    return tuple(
        (model, slot, api_key)
        for model in coach_model_order(mode, selected, fallbacks)
        for slot, api_key in key_order
    )


def is_retryable_failure(status: int, error: str = "") -> bool:
    if status == 0 or status == 429 or 500 <= status <= 599:
        return True
    upper_error = str(error or "").upper()
    return any(marker in upper_error for marker in _RETRYABLE_ERROR_MARKERS)
