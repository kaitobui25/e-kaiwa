"""Canonical target-language profiles shared by the realtime and Coach paths."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class LanguageProfile:
    code: str
    name: str
    speech_locale: str
    aliases: tuple[str, ...]
    correction_instruction: str
    pronunciation_instruction: str


_PROFILES = (
    LanguageProfile(
        "en", "English", "en-US", ("en", "en-us", "en-gb", "english"),
        "Correct to natural English according to the correction rule, including tense, articles, "
        "prepositions, word choice, and natural phrasing when applicable.",
        "Assess vowels/consonants, vowel quality/length, consonant articulation and clusters, final sounds, "
        "word stress, linking, rhythm/fluency, reductions, and intonation.",
    ),
    LanguageProfile(
        "ja", "Japanese", "ja-JP", ("ja", "ja-jp", "japanese"),
        "Correct to natural Japanese, including grammar, particles, word choice, and learner-appropriate phrasing.",
        "Assess mora timing, short/long vowels, gemination, moraic nasal, clearly audible consonant/vowel issues, rhythm/fluency, and pitch accent only when clearly supported by the audio.",
    ),
    LanguageProfile(
        "zh-Hans", "Mandarin Chinese (Simplified)", "zh-CN", ("zh", "zh-hans", "zh-cn", "cmn", "cmn-hans", "mandarin", "chinese"),
        "Correct to natural Mandarin Chinese, including grammar, word order, particles, measure words, and word choice.",
        "Assess initials, finals, aspiration, tones 1-4, neutral tone, appropriate tone sandhi, syllable clarity, and rhythm/fluency.",
    ),
)

_BY_CODE = {profile.code: profile for profile in _PROFILES}
_ALIASES = {alias.lower(): profile.code for profile in _PROFILES for alias in profile.aliases}


def normalize_target_language(value: object, fallback: str | None = None) -> str | None:
    raw = str(value or "").strip().lower().replace("_", "-")
    code = _ALIASES.get(raw)
    if code:
        return code
    return fallback if fallback in _BY_CODE else None


def resolve_language_profile(value: object, fallback: str | None = None) -> LanguageProfile | None:
    code = normalize_target_language(value, fallback)
    return _BY_CODE.get(code) if code else None


def supported_target_languages() -> tuple[str, ...]:
    return tuple(_BY_CODE)


def target_language_aliases() -> dict[str, str]:
    """Return the canonical registry aliases for cross-boundary contract checks."""
    return dict(_ALIASES)
