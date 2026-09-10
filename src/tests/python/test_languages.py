from __future__ import annotations

import base64
import json
import subprocess
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch

from e_kaiwa.coach import CoachService, StructuredCallResult, correction, pronunciation
from e_kaiwa.config import TEACHER_MODES
from e_kaiwa.languages import (
    normalize_target_language,
    resolve_language_profile,
    supported_target_languages,
    target_language_aliases,
)
from e_kaiwa.server import _metric_target_language


ROOT = Path(__file__).resolve().parents[3]


class LanguageProfileTests(unittest.TestCase):
    def test_supported_profiles_have_locales(self):
        self.assertEqual(supported_target_languages(), ("en", "ja", "zh-Hans"))
        self.assertEqual(resolve_language_profile("ja").speech_locale, "ja-JP")
        self.assertEqual(resolve_language_profile("zh-Hans").speech_locale, "zh-CN")

    def test_aliases_normalize_to_canonical_codes(self):
        self.assertEqual(normalize_target_language("en-US"), "en")
        self.assertEqual(normalize_target_language("ja_JP"), "ja")
        self.assertEqual(normalize_target_language("cmn-Hans"), "zh-Hans")
        self.assertIsNone(normalize_target_language("zh-Hant"))

    def test_metric_target_language_preserves_invalid_explicit_values(self):
        self.assertEqual(_metric_target_language({}), "en")
        self.assertEqual(_metric_target_language({"target_language": "cmn"}), "zh-Hans")
        self.assertIsNone(_metric_target_language({"target_language": "zh-Hant"}))

    def test_coach_rejects_explicit_unsupported_target(self):
        service = CoachService.__new__(CoachService)
        service.sessions = SimpleNamespace(get=Mock(return_value=object()))
        payload = {"session_id": "test", "transcript": "hello"}
        for invalid in ("zh-Hant", "fr-FR", "", None, {"code": "ja"}):
            with self.subTest(invalid=invalid):
                with self.assertRaisesRegex(ValueError, "invalid target_language"):
                    service.run_turn({**payload, "target_language": invalid})

    def test_teacher_guidance_is_language_neutral(self):
        forbidden = ("English", "tense", "articles", "prepositions", "consonant clusters", "final sounds", "word stress", "linking", "reductions")
        for mode in TEACHER_MODES.values():
            with self.subTest(mode=mode.name):
                guidance = f"{mode.correction_rule} {mode.pronunciation_instruction}"
                self.assertFalse(any(term in guidance for term in forbidden))

    def test_prompt_bodies_apply_target_rubric_and_keep_feedback_language_independent(self):
        captured: list[str] = []

        def request(**kwargs):
            captured.append(kwargs["body"]["contents"][0]["parts"][0]["text"])
            return StructuredCallResult(
                {"correction": "fixed", "explanation": "tip", "problems": [], "summary": "good"},
                0.0, "model", 1, [], ""
            )

        with tempfile.TemporaryDirectory() as directory, patch("e_kaiwa.coach._structured_request", side_effect=request):
            wav = Path(directory) / "audio.wav"
            wav.write_bytes(b"RIFF")
            for target in supported_target_languages():
                profile = resolve_language_profile(target)
                for teacher in TEACHER_MODES.values():
                    with self.subTest(target=target, teacher=teacher.name):
                        corrected = correction([], "sample", teacher, "vi", profile, mode="auto", selected_model="m", fallback_models=(), turn_no=1)
                        assessed = pronunciation([], wav, "sample", teacher, "ja", profile, mode="auto", selected_model="m", fallback_models=(), turn_no=1)
                        self.assertEqual(corrected.value["feedback_language"], "vi")
                        self.assertEqual(assessed.value["feedback_language"], "ja")
                        correction_prompt, pronunciation_prompt = captured[-2:]
                        self.assertIn(profile.correction_instruction, correction_prompt)
                        self.assertIn(profile.pronunciation_instruction, pronunciation_prompt)
                        self.assertIn(f"natural {profile.name}", correction_prompt)
                        self.assertIn(f"standard {profile.name}", pronunciation_prompt)
                        if target != "en":
                            self.assertNotIn("articles, prepositions", correction_prompt)
                            self.assertNotIn("consonant clusters", pronunciation_prompt)

    def test_coach_run_turn_accepts_omitted_and_alias_targets_with_common_response_shape(self):
        with tempfile.TemporaryDirectory() as directory:
            session_dir = Path(directory)
            service = CoachService.__new__(CoachService)
            service.keys = [(1, "key")]
            service.sessions = SimpleNamespace(get=Mock(return_value=session_dir), log=Mock())
            service.settings = SimpleNamespace(
                snapshot=Mock(return_value={"settings": {"teacher": "Normal", "support_language": "vi", "pronunciation_enabled": True}}),
                coach_policy=Mock(return_value=("auto", "model", ())),
            )

            def request(**kwargs):
                prompt = kwargs["body"]["contents"][0]["parts"][0]["text"]
                value = {"correction": "fixed", "explanation": "tip"} if "correction:" in prompt else {"problems": [], "summary": "good"}
                return StructuredCallResult(value, 0.0, "model", 1, [], "")

            payload = {"session_id": "session", "turn": 1, "transcript": "hello", "sample_rate": 16000, "pcm_b64": base64.b64encode(b"\0\0").decode()}
            with patch("e_kaiwa.coach._structured_request", side_effect=request):
                for target, expected in ((None, "en"), ("ja_JP", "ja"), ("cmn-Hans", "zh-Hans")):
                    with self.subTest(target=target):
                        request_payload = dict(payload)
                        if target is not None:
                            request_payload["target_language"] = target
                        result = service.run_turn(request_payload, temporary_audio=True)
                        self.assertEqual(result["target_language"], expected)
                        self.assertEqual(set(result), {"correction", "explanation", "feedback_language", "target_language", "pronunciation", "coach_wall_s", "coach_model_mode", "coach_requested_model", "correction_effective_model", "pronunciation_effective_model"})
                        self.assertEqual(set(result["pronunciation"]), {"problems", "summary", "feedback_language"})

    def test_frontend_and_backend_alias_contracts_match(self):
        policy_path = (ROOT / "src" / "web" / "language_policy.js").as_posix()
        script = (
            "const fs=require('fs'); (async()=>{const source=fs.readFileSync(process.argv[1],'utf8');"
            "const policy=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));"
            "console.log(JSON.stringify(policy.TARGET_LANGUAGE_ALIASES));})().catch(error=>{console.error(error);process.exit(1)})"
        )
        frontend = json.loads(subprocess.check_output(["node", "-e", script, policy_path], text=True))
        self.assertEqual(frontend, target_language_aliases())


if __name__ == "__main__":
    unittest.main()
