"""Backward-compatible wrappers for the old web coach imports.

Production code lives in :mod:`e_kaiwa.coach`. New code should import that module
instead of this file.
"""

from __future__ import annotations

from dataclasses import replace
from pathlib import Path

from e_kaiwa.coach import correction as _correction
from e_kaiwa.coach import pronunciation as _pronunciation
from e_kaiwa.config import resolve_teacher


def correction(
    full,
    key: str,
    user_text: str,
    teacher_name: str,
    teacher_rule: str,
    feedback_language: str,
):
    del full
    teacher = replace(resolve_teacher(teacher_name), correction_rule=teacher_rule)
    return _correction(key, user_text, teacher, feedback_language)


def pronunciation(
    full,
    key: str,
    wav: Path,
    reference: str,
    teacher_choice: str,
    feedback_language: str,
):
    del full
    teacher = resolve_teacher(teacher_choice)
    return _pronunciation(key, wav, reference, teacher, feedback_language)
