from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Iterable

SRC_ROOT = Path(__file__).resolve().parent.parent
PROJECT_ROOT = SRC_ROOT.parent
WEB_DIR = SRC_ROOT / "web"
API_FILE = PROJECT_ROOT / "api.txt"
LOG_ROOT = PROJECT_ROOT / "runtime_logs"

API_BASE = "https://generativelanguage.googleapis.com/v1beta"
TOKEN_URL = f"{API_BASE}/auth_tokens"
LIVE_MODEL = "gemini-3.1-flash-live-preview"
COACH_LLM_MODEL = "gemini-3.5-flash-lite"
PRONUNCIATION_MODELS = (
    "gemini-3.5-flash-lite",
    "gemini-3.1-flash-lite",
    "gemini-3.6-flash",
)

DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 7860
REQUEST_MAX_BYTES = 8_000_000
GEMINI_TIMEOUT_S = 45
SKIP_KEY_NUMBERS = frozenset({4})
SUPPORTED_SAMPLE_RATES = frozenset({16000})


@dataclass(frozen=True)
class TeacherMode:
    key: str
    name: str
    correction_rule: str
    pronunciation_instruction: str
    max_pronunciation_problems: int


TEACHER_MODES: dict[str, TeacherMode] = {
    "1": TeacherMode(
        key="1",
        name="Easy",
        correction_rule=(
            "Correct only mistakes that clearly hurt grammar or understanding. "
            "Ignore small unnatural phrasing."
        ),
        pronunciation_instruction=(
            "Be encouraging and lenient. Report only pronunciation issues that clearly "
            "hurt intelligibility or make a word noticeably wrong. Do not penalize a harmless accent."
        ),
        max_pronunciation_problems=2,
    ),
    "2": TeacherMode(
        key="2",
        name="Normal",
        correction_rule=(
            "Correct clear grammar mistakes and noticeably unnatural learner English."
        ),
        pronunciation_instruction=(
            "Use normal pronunciation-teacher standards. Report clear vowel/consonant, word stress, "
            "rhythm, fluency, or intonation issues, even when the sentence is still understandable."
        ),
        max_pronunciation_problems=4,
    ),
    "3": TeacherMode(
        key="3",
        name="Strict",
        correction_rule=(
            "Be picky. Correct grammar, tense, articles, prepositions, word choice, and unnatural "
            "phrasing when a native speaker would normally say it differently."
        ),
        pronunciation_instruction=(
            "Be a demanding pronunciation coach. Listen critically to every word. Report subtle but "
            "clearly audible vowel quality/length, consonant articulation, consonant clusters, final "
            "sounds, word stress, linking, rhythm, reductions, and intonation issues. Do not give 95-100 "
            "unless the speech is genuinely near-native for this sentence. A clearly non-native but fully "
            "understandable reading should normally score around 70-90, depending on severity. Do not invent "
            "errors that are not audible and do not penalize accent identity by itself."
        ),
        max_pronunciation_problems=6,
    ),
}

_TEACHER_BY_NAME = {mode.name.lower(): mode for mode in TEACHER_MODES.values()}


def load_api_keys(
    path: Path = API_FILE,
    *,
    skip_slots: Iterable[int] = SKIP_KEY_NUMBERS,
) -> list[tuple[int, str]]:
    if not path.exists():
        raise RuntimeError(f"api.txt not found: {path}")

    unique: list[str] = []
    for raw in path.read_text(encoding="utf-8-sig").splitlines():
        key = raw.strip()
        if key and not key.startswith("#") and key not in unique:
            unique.append(key)

    skipped = set(skip_slots)
    active = [(slot, key) for slot, key in enumerate(unique, 1) if slot not in skipped]
    if not active:
        raise RuntimeError("no active Gemini API keys")
    return active


def resolve_teacher(value: object) -> TeacherMode:
    raw = str(value or "Normal").strip()
    if raw in TEACHER_MODES:
        return TEACHER_MODES[raw]
    return _TEACHER_BY_NAME.get(raw.lower(), TEACHER_MODES["2"])


def normalize_feedback_language(value: object) -> str:
    return "ja" if str(value or "").strip().lower() == "ja" else "vi"


def feedback_language_name(code: object) -> tuple[str, str]:
    normalized = normalize_feedback_language(code)
    return ("ja", "Japanese") if normalized == "ja" else ("vi", "Vietnamese")
