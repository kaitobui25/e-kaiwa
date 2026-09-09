from __future__ import annotations

import copy
import os
import tempfile
from pathlib import Path
from threading import Lock

import yaml

from .config import CONFIG_FILE, TEACHER_MODES
from .model_policy import (
    COACH_MODELS,
    DEFAULT_COACH_FALLBACKS,
    DEFAULT_COACH_MODEL,
    DEFAULT_REALTIME_FALLBACK,
    DEFAULT_REALTIME_MODEL,
    REALTIME_MODELS,
    alternate_realtime_model,
)

ALLOWED_SILENCE_MS = (700, 1000, 1200, 1500)
ALLOWED_PLAYBACK_RATES = tuple(round(0.5 + 0.1 * i, 1) for i in range(11))
ALLOWED_SUPPORT_LANGUAGES = ("vi", "ja")
ALLOWED_TEACHERS = tuple(mode.name for mode in TEACHER_MODES.values())


def default_config() -> dict:
    return {
        "version": 1,
        "settings": {
            "teacher": "Normal",
            "support_language": "vi",
            "pronunciation_enabled": True,
            "silence_duration_ms": 1000,
            "ai_playback_rate": 0.8,
        },
        "models": {
            "realtime_conversation": {
                "selected": DEFAULT_REALTIME_MODEL,
                "fallback": DEFAULT_REALTIME_FALLBACK,
            },
            "coach": {
                "mode": "auto",
                "selected": DEFAULT_COACH_MODEL,
                "fallbacks": list(DEFAULT_COACH_FALLBACKS),
            },
        },
    }


def _mapping(value: object) -> dict:
    return value if isinstance(value, dict) else {}


def _normalize_document(raw: dict) -> tuple[dict, list[str]]:
    defaults = default_config()
    warnings: list[str] = []
    settings_raw = _mapping(raw.get("settings"))
    models_raw = _mapping(raw.get("models"))
    realtime_raw = _mapping(models_raw.get("realtime_conversation"))
    coach_raw = _mapping(models_raw.get("coach"))

    result = default_config()
    result["version"] = 1

    teacher = str(settings_raw.get("teacher", "")).strip()
    if teacher in ALLOWED_TEACHERS:
        result["settings"]["teacher"] = teacher
    elif "teacher" in settings_raw:
        warnings.append("settings.teacher invalid; using Normal")

    support = str(settings_raw.get("support_language", "")).strip().lower()
    if support in ALLOWED_SUPPORT_LANGUAGES:
        result["settings"]["support_language"] = support
    elif "support_language" in settings_raw:
        warnings.append("settings.support_language invalid; using vi")

    pronunciation = settings_raw.get("pronunciation_enabled")
    if isinstance(pronunciation, bool):
        result["settings"]["pronunciation_enabled"] = pronunciation
    elif "pronunciation_enabled" in settings_raw:
        warnings.append("settings.pronunciation_enabled invalid; using true")

    silence = settings_raw.get("silence_duration_ms")
    if isinstance(silence, int) and not isinstance(silence, bool) and silence in ALLOWED_SILENCE_MS:
        result["settings"]["silence_duration_ms"] = silence
    elif "silence_duration_ms" in settings_raw:
        warnings.append("settings.silence_duration_ms invalid; using 1000")

    speed = settings_raw.get("ai_playback_rate")
    if isinstance(speed, (int, float)) and not isinstance(speed, bool):
        normalized_speed = round(float(speed), 1)
        if normalized_speed in ALLOWED_PLAYBACK_RATES:
            result["settings"]["ai_playback_rate"] = normalized_speed
        else:
            warnings.append("settings.ai_playback_rate invalid; using 0.8")
    elif "ai_playback_rate" in settings_raw:
        warnings.append("settings.ai_playback_rate invalid; using 0.8")

    selected_realtime = str(realtime_raw.get("selected", "")).strip()
    if selected_realtime in REALTIME_MODELS:
        result["models"]["realtime_conversation"]["selected"] = selected_realtime
    elif "selected" in realtime_raw:
        warnings.append("models.realtime_conversation.selected invalid; using default")

    fallback_realtime = str(realtime_raw.get("fallback", "")).strip()
    if fallback_realtime in REALTIME_MODELS:
        result["models"]["realtime_conversation"]["fallback"] = fallback_realtime
    elif "fallback" in realtime_raw:
        warnings.append("models.realtime_conversation.fallback invalid; using default")

    selected_realtime = result["models"]["realtime_conversation"]["selected"]
    if result["models"]["realtime_conversation"]["fallback"] == selected_realtime:
        result["models"]["realtime_conversation"]["fallback"] = alternate_realtime_model(selected_realtime)
        warnings.append("realtime fallback matched selected model; using alternate model")

    coach_mode = str(coach_raw.get("mode", "")).strip().lower()
    if coach_mode in {"auto", "manual"}:
        result["models"]["coach"]["mode"] = coach_mode
    elif "mode" in coach_raw:
        warnings.append("models.coach.mode invalid; using auto")

    selected_coach = str(coach_raw.get("selected", "")).strip()
    if selected_coach in COACH_MODELS:
        result["models"]["coach"]["selected"] = selected_coach
    elif "selected" in coach_raw:
        warnings.append("models.coach.selected invalid; using default")

    raw_fallbacks = coach_raw.get("fallbacks")
    if isinstance(raw_fallbacks, list):
        valid: list[str] = []
        for model in raw_fallbacks:
            model_id = str(model or "").strip()
            if model_id in COACH_MODELS and model_id not in valid:
                valid.append(model_id)
        if valid:
            result["models"]["coach"]["fallbacks"] = valid
        elif raw_fallbacks:
            warnings.append("models.coach.fallbacks invalid; using defaults")
    elif "fallbacks" in coach_raw:
        warnings.append("models.coach.fallbacks invalid; using defaults")

    selected_coach = result["models"]["coach"]["selected"]
    result["models"]["coach"]["fallbacks"] = [
        model for model in result["models"]["coach"]["fallbacks"] if model != selected_coach
    ]
    for model in COACH_MODELS:
        if model != selected_coach and model not in result["models"]["coach"]["fallbacks"]:
            result["models"]["coach"]["fallbacks"].append(model)

    return result, warnings


class SettingsStore:
    def __init__(self, path: Path = CONFIG_FILE):
        self.path = Path(path)
        self._lock = Lock()
        self._config = self._load_or_create()

    def _load_or_create(self) -> dict:
        if not self.path.exists():
            config = default_config()
            self._write_atomic(config)
            return config

        try:
            raw = yaml.safe_load(self.path.read_text(encoding="utf-8"))
        except Exception as exc:
            raise RuntimeError(f"config.yaml is unreadable: {exc}") from exc
        if not isinstance(raw, dict):
            raise RuntimeError("config.yaml root must be a YAML mapping")

        config, warnings = _normalize_document(raw)
        for warning in warnings:
            print(f"[CONFIG WARN] {warning}")
        if warnings:
            self._write_atomic(config)
        return config

    def _write_atomic(self, config: dict) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        tmp_path: Path | None = None
        try:
            with tempfile.NamedTemporaryFile(
                "w",
                encoding="utf-8",
                dir=self.path.parent,
                prefix=f".{self.path.name}.",
                suffix=".tmp",
                delete=False,
            ) as handle:
                yaml.safe_dump(config, handle, sort_keys=False, allow_unicode=True)
                handle.flush()
                os.fsync(handle.fileno())
                tmp_path = Path(handle.name)
            os.replace(tmp_path, self.path)
        finally:
            if tmp_path is not None and tmp_path.exists():
                tmp_path.unlink(missing_ok=True)

    def snapshot(self) -> dict:
        with self._lock:
            return copy.deepcopy(self._config)

    def public_payload(self) -> dict:
        config = self.snapshot()
        settings = config["settings"]
        realtime = config["models"]["realtime_conversation"]
        coach = config["models"]["coach"]
        return {
            "version": config["version"],
            "settings": copy.deepcopy(settings),
            "models": {
                "realtime_conversation": realtime["selected"],
                "realtime_fallback": realtime["fallback"],
                "coach_mode": coach["mode"],
                "coach_model": coach["selected"],
            },
            "choices": {
                "realtime_conversation": list(REALTIME_MODELS),
                "coach": ["auto", *COACH_MODELS],
            },
        }

    @property
    def realtime_model(self) -> str:
        return self.snapshot()["models"]["realtime_conversation"]["selected"]

    @property
    def realtime_fallback(self) -> str:
        return self.snapshot()["models"]["realtime_conversation"]["fallback"]

    def coach_policy(self) -> tuple[str, str, tuple[str, ...]]:
        coach = self.snapshot()["models"]["coach"]
        return coach["mode"], coach["selected"], tuple(coach["fallbacks"])

    def update(self, changes: dict) -> dict:
        if not isinstance(changes, dict) or not changes:
            raise ValueError("settings update must be a non-empty object")

        allowed = {
            "teacher",
            "support_language",
            "pronunciation_enabled",
            "silence_duration_ms",
            "ai_playback_rate",
            "realtime_conversation_model",
            "coach_model",
        }
        unknown = set(changes) - allowed
        if unknown:
            raise ValueError(f"unknown setting: {sorted(unknown)[0]}")

        with self._lock:
            updated = copy.deepcopy(self._config)
            settings = updated["settings"]
            realtime = updated["models"]["realtime_conversation"]
            coach = updated["models"]["coach"]

            if "teacher" in changes:
                teacher = str(changes["teacher"] or "").strip()
                if teacher not in ALLOWED_TEACHERS:
                    raise ValueError("invalid teacher")
                settings["teacher"] = teacher

            if "support_language" in changes:
                support = str(changes["support_language"] or "").strip().lower()
                if support not in ALLOWED_SUPPORT_LANGUAGES:
                    raise ValueError("invalid support_language")
                settings["support_language"] = support

            if "pronunciation_enabled" in changes:
                value = changes["pronunciation_enabled"]
                if not isinstance(value, bool):
                    raise ValueError("pronunciation_enabled must be boolean")
                settings["pronunciation_enabled"] = value

            if "silence_duration_ms" in changes:
                value = changes["silence_duration_ms"]
                if not isinstance(value, int) or isinstance(value, bool) or value not in ALLOWED_SILENCE_MS:
                    raise ValueError("invalid silence_duration_ms")
                settings["silence_duration_ms"] = value

            if "ai_playback_rate" in changes:
                value = changes["ai_playback_rate"]
                if not isinstance(value, (int, float)) or isinstance(value, bool):
                    raise ValueError("invalid ai_playback_rate")
                value = round(float(value), 1)
                if value not in ALLOWED_PLAYBACK_RATES:
                    raise ValueError("invalid ai_playback_rate")
                settings["ai_playback_rate"] = value

            if "realtime_conversation_model" in changes:
                model = str(changes["realtime_conversation_model"] or "").strip()
                if model not in REALTIME_MODELS:
                    raise ValueError("invalid realtime_conversation_model")
                realtime["selected"] = model
                realtime["fallback"] = alternate_realtime_model(model)

            if "coach_model" in changes:
                value = str(changes["coach_model"] or "").strip()
                if value == "auto":
                    coach["mode"] = "auto"
                    coach["selected"] = DEFAULT_COACH_MODEL
                    coach["fallbacks"] = list(DEFAULT_COACH_FALLBACKS)
                elif value in COACH_MODELS:
                    coach["mode"] = "manual"
                    coach["selected"] = value
                    coach["fallbacks"] = [model for model in COACH_MODELS if model != value]
                else:
                    raise ValueError("invalid coach_model")

            if updated != self._config:
                self._write_atomic(updated)
                self._config = updated

        return self.public_payload()
