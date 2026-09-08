# E-KAIWA MVP – ChatGPT conversation summary

Date: 2026-09-08

## 1. Project goal

Build a minimal AI 英会話 app for Japanese learners, with a strong preference for simple architecture, low maintenance, free/cheap APIs, and no unnecessary infrastructure.

Target flow discussed:

```text
USER SPEAK
↓
STT
↓
LLM
↙      ↘
reply   correction
↓        ↓
TTS      small correction under user sentence
↓
conversation continues
```

The intended UX is conversation-first. Corrections and pronunciation feedback should help without interrupting the flow.

Initial constraints and philosophy:

- Keep the MVP simple.
- Avoid Docker/GPU/CUDA/complex orchestration unless actually needed.
- VPS target is very small, around Ubuntu 1 GB RAM.
- Prefer API-based inference.
- No DB/framework/async complexity until the basic loop works.
- Early suggested module shape:

```text
main.py
audio.py
stt.py
llm.py
tts.py
```

## 2. Repository and local setup

Repository:

```text
kaitobui25/e-kaiwa
```

Basic preflight files were created:

- `preflight.py`
- `requirements.txt`
- `run.bat`
- `README.md`
- `.gitignore`

`.gitignore` includes:

```text
api.txt
```

`api.txt` is local-only and contains Gemini API keys. API keys must never be committed or exposed.

Known minimal requirements:

```text
numpy>=1.26,<3
sounddevice>=0.4.6,<1
```

The test code intentionally uses stdlib HTTP calls instead of adding Gemini SDK dependencies.

## 3. LLM benchmark

Added:

- `test_llm.py`
- `run_llm_test.bat`

The LLM test reads keys from `api.txt`, masks them in logs, lists models, and checks whether the model can return the structured e-kaiwa response.

Tested models included:

- `gemini-3.5-transcribe`
- `gemini-3.6-flash`
- `gemini-3.7-flash`
- `gemini-3.8-flash`
- `gemma-4-26b-a4b-it`
- `gemma-4-31b-it`
- `gemini-3.5-flash-lite`
- `gemini-3.1-flash-lite`
- `gemini-2.5-flash-lite`
- `gemini-3.5-flash`
- `gemini-2.5-flash`

Observed useful results:

```text
[OK] gemini-3.5-flash-lite  ~0.94s  e-kaiwa JSON OK
[OK] gemini-3.1-flash-lite  ~1.06s  e-kaiwa JSON OK
```

Other models were slower, unavailable, returned invalid JSON, or were unstable.

Initial recommendation:

```text
LLM main     : gemini-3.5-flash-lite
LLM fallback : gemini-3.1-flash-lite
```

## 4. STT test dataset

Added:

- `test_stt.py`
- `run_stt_test.bat`
- `stt_samples/manifest.json`
- `stt_samples/README.md`
- `stt_samples/.gitignore`

Source dataset:

```text
Nexdata-AI/207-Hours-Japanese-Speaking-English-Speech-Data-by-Mobile-Phone
```

Five Japanese-speaker English samples were selected:

1. `01_blind_alley.wav`
   - expected: `The street was a blind alley.`

2. `02_music_life.wav`
   - expected: `Music can change your life more than almost anything.`

3. `03_wishing_on_a_star.wav`
   - source label: `I want to know the ray leaks to Wishing on A Star.`
   - Gemini later heard the more natural phrase `I want to know the lyrics to Wishing on a Star.`

4. `04_rice_cooker.wav`
   - expected: `On the rice cooker`

5. `05_song_on_loop.wav`
   - expected: `Play this single song on loop`

The WAV files are downloaded on first run and normalized to 5 seconds rather than being re-hosted directly in the repo.

## 5. Gemini Transcribe issue

Initial STT testing with `gemini-3.5-transcribe` repeatedly produced this pattern:

```text
HTTP 200 but transcript is empty
usage = {
  promptTokenCount: 125,
  totalTokenCount: 125,
  promptTokensDetails: [{ modality: AUDIO, tokenCount: 125 }]
}
```

Important interpretation:

- Gemini clearly receives and tokenizes the audio.
- There are zero output tokens.
- The failure is therefore not that the WAV file is unreadable.

The first STT script had a design bug: when one key returned HTTP 200 with empty transcript, it rotated through all keys and burned quota. This was fixed.

Key handling decision:

```text
key #4 is dead and must always be skipped
```

The test was changed so it does not retry all keys automatically for an empty result.

A fallback chain was then tested:

```text
gemini-3.5-transcribe
→ gemini-3.5-flash-lite
→ gemini-3.1-flash-lite
→ gemini-3.6-flash
```

Observed results over the five files:

```text
Success        : 5/5
Average WER    : 3.3%
Model wins     : gemini-3.5-flash-lite 5/5
```

Example:

```text
01_blind_alley.wav
Expected : The street was a blind alley.
Got      : The street was a blind alley.
WER      : 0.0%
```

Conclusion:

```text
Do not use gemini-3.5-transcribe in the MVP.
Use gemini-3.5-flash-lite for STT.
```

This also removes ~4 seconds of wasted delay caused by the broken transcribe model.

## 6. Pronunciation / ELSA-like prototype

The user wanted pronunciation feedback similar to ELSA, not just transcription.

Added:

- `test_pronunciation.py`
- `run_pronunciation_test.bat`

The pronunciation prototype asks Gemini to score:

- overall
- pronunciation
- fluency
- intonation

And to return:

- problem words
- sound issue
- severity
- approximate heard form
- Japanese coaching tip
- Japanese summary

Important caveat established:

This is an ELSA-like MVP prototype using a general multimodal model. It is not true phoneme-level scoring and the numeric score should not be treated as authoritative.

Initial results were too lenient, e.g. 100/100 on accented speech, so teacher strictness modes were added.

Current modes:

```text
1 = Easy
    only pronunciation errors that hurt understanding

2 = Normal
    clear learner pronunciation issues

3 = Strict
    picky about sounds, stress, rhythm, linking and intonation
```

Strict mode rules explicitly say:

- STT recognizing the word does not mean pronunciation is correct.
- Small audible vowel/consonant errors can still be reported.
- Do not invent typical Japanese-accent errors.
- Do not penalize accent identity by itself.
- Do not hand out 95–100 unless speech is genuinely near-native.

Example strict-mode result:

```text
01_blind_alley.wav
Scores: overall=88 pronunciation=85 fluency=90 intonation=90

Problems:
[YELLOW] street [vowel length]
[YELLOW] blind [final consonant]
```

Another useful result:

```text
05_song_on_loop.wav
SCORE: overall=82 pronunciation=80 fluency=85 intonation=82

PRON FIX:
[YELLOW] single [ng sound (/ŋ/) and vowel quality]
[YELLOW] loop [vowel length and lip rounding]
```

Conclusion:

The pronunciation feedback is useful enough for MVP experimentation, especially in Strict mode, but needs a confidence gate so uncertain issues are not shown as facts.

## 7. TTS test

Added:

- `test_tts.py`
- `run_tts_test.bat`

TTS flow:

```text
user text
→ gemini-3.5-flash-lite creates a short natural reply
→ Gemini TTS speaks only that AI reply
→ save WAV
→ auto-play on Windows
```

Current TTS models:

```text
Primary  : gemini-3.1-flash-tts-preview
Fallback : gemini-2.5-flash-preview-tts
```

Voice:

```text
Achird
```

Prompt direction:

- natural everyday American English
- warm tone
- clear pronunciation
- medium conversational pace
- natural intonation
- do not sound like a narrator or teacher

Example:

```text
USER : Yesterday I go shopping with my friend.
AI   : Oh nice! Did you two buy anything cool?
LLM  : 1.10s
TTS  : 3.27s
TOTAL: 4.37s
```

Evaluation:

```text
Reply quality : 9/10
TTS clarity   : 9/10
TTS natural   : 8/10
Latency       : 6/10
Overall       : 8/10
```

TTS quality was considered good enough for MVP. The main weakness is latency, not intelligibility or basic naturalness.

## 8. Full-loop test

Added:

- `test_full_loop.py`
- `run_full_loop_test.bat`

The test lists WAV files in `stt_samples` so the user can simply choose by number:

```text
Available audio:
  1. 01_blind_alley.wav
  2. 02_music_life.wav
  3. 03_wishing_on_a_star.wav
  4. 04_rice_cooker.wav
  5. 05_song_on_loop.wav
Choose [1-5]:
```

Full MVP test flow:

```text
WAV
→ STT
→ optional pronunciation scoring
→ LLM(reply + correction + explanation_ja)
→ TTS(reply only)
→ play AI reply
```

Important TTS behavior:

```text
TTS only speaks the AI reply.
It does NOT speak the user's recognized sentence.
```

Current STT chain for the full loop:

```text
gemini-3.5-flash-lite
→ gemini-3.1-flash-lite
→ gemini-3.6-flash
```

`gemini-3.5-transcribe` was intentionally removed from the production-like full loop because it is currently broken and adds needless latency.

## 9. Teacher strictness in full loop

Teacher strictness was added to grammar/naturalness correction:

```text
1 = Easy
    only important mistakes

2 = Normal
    clear grammar + naturalness issues

3 = Strict
    picky grammar + natural phrasing
```

The strictness mode affects only:

- `FIX`
- `JA`

It must not make the AI spoken reply sound like a teacher.

Example:

```text
USER : Play this single song on loop.
AI   : I love that track! What song are you listening to?
FIX  : Play this single song on a loop.
JA   : 「on loop」ではなく「on a loop」と言うのが自然です。
```

## 10. Pronunciation toggle in full loop

The full loop initially had grammar correction only, so pronunciation scoring was added as a separate toggle.

Current UI:

```text
Pronunciation scoring:
  Y = ON  - score + pronunciation problems + Japanese tips (default)
  N = OFF - skip pronunciation analysis for lower latency
Choose [Y/n, default=Y]:
```

Default is ON.

When enabled, the full loop now shows:

```text
TARGET: ...
PRON : model + latency
SCORE: overall / pronunciation / fluency / intonation
PRON FIX:
  detected pronunciation problems
PRON JA:
  Japanese coaching summary
```

Then it continues with:

```text
AI
FIX
JA
TTS
```

Example successful full-loop result:

```text
FILE : 05_song_on_loop.wav
STT  : gemini-3.5-flash-lite 2.33s
USER : Play this single song on loop.
TARGET: Play this single song on loop

PRON : gemini-3.5-flash-lite 2.06s
SCORE: overall=82 pronunciation=80 fluency=85 intonation=82

PRON FIX:
  [YELLOW] single ...
  [YELLOW] loop ...

AI   : I love that track! What song are you listening to?
FIX  : Play this single song on a loop.
JA   : 「on loop」ではなく「on a loop」と言うのが自然です。

LLM  : 0.84s
TTS  : 3.34s
API TOTAL : 8.58s
WALL TOTAL: 8.60s
```

At this point the user considered the product loop functional and said it was working well.

## 11. UX review

The main UX risks identified:

### A. Latency is the biggest problem

Current sequential path can take around 8–9 seconds:

```text
STT  ~2.3s
PRON ~2.1s
LLM  ~0.8s
TTS  ~3.3s
TOTAL ~8.6s
```

The recommended production scheduling is:

```text
                  → pronunciation analysis → show feedback later
STT → recognized text
                  → LLM → TTS → play AI reply ASAP
```

Pronunciation should not block the AI reply.

### B. Do not ask settings every turn

Teacher strictness and pronunciation ON/OFF should be chosen once in settings/session, not before every utterance.

Recommended defaults:

```text
Teacher       = Normal
Pronunciation = ON
```

### C. Too much feedback can overwhelm the learner

Current debug output contains many fields:

```text
USER
TARGET
SCORE
PRON FIX
PRON JA
AI
FIX
JA
```

Production UI should prioritize conversation and progressively disclose correction details.

Recommended compact UI idea:

```text
You: Play this single song on loop.

    82 Pronunciation
    ⚠ single
    ⚠ loop

AI: I love that track! What song are you listening to?

    Play this single song on a loop.
```

Detailed Japanese explanations should appear only after tap/expand.

### D. Pronunciation needs confidence gating

Do not show every possible issue Gemini can imagine.

Rule:

```text
high confidence → show
uncertain       → omit
```

Conversation quality and trust are more important than always finding several errors.

## 12. Final MVP direction

The working MVP architecture at the end of this chat is:

```text
Mic / WAV
↓
STT: gemini-3.5-flash-lite
↓
recognized user text
├─→ Pronunciation feedback (optional, default ON, should later run in parallel)
└─→ LLM: gemini-3.5-flash-lite
      ├─ reply
      ├─ correction
      └─ explanation_ja
         ↓
      TTS: gemini-3.1-flash-tts-preview
         ↓
      speaker
```

Fallbacks:

```text
STT:
  gemini-3.5-flash-lite
  → gemini-3.1-flash-lite
  → gemini-3.6-flash

LLM:
  gemini-3.5-flash-lite
  → gemini-3.1-flash-lite when needed

TTS:
  gemini-3.1-flash-tts-preview
  → gemini-2.5-flash-preview-tts
```

Operational rule:

```text
Always skip API key #4 because it is dead.
```

## 13. Main conclusions

- The core product concept works end-to-end.
- `gemini-3.5-flash-lite` is currently the best all-around choice for STT + LLM in this MVP.
- `gemini-3.5-transcribe` is currently unusable due to HTTP 200 / empty-output behavior and should stay out of the main flow.
- Pronunciation feedback is promising enough for MVP but is not a substitute for a dedicated phoneme engine.
- Strict mode gives much more useful pronunciation feedback than the initial lenient prompt.
- Gemini TTS quality is good enough; latency is the larger problem.
- The highest-value next engineering step is parallelizing pronunciation analysis with the LLM/TTS reply path so pronunciation feedback does not delay conversation.
- Product UX should remain conversation-first, with correction and pronunciation as lightweight secondary layers.

## 14. Status at end of core testing

Working test coverage includes:

```text
[OK] PC preflight
[OK] LLM benchmark
[OK] STT benchmark
[OK] STT fallback handling
[OK] pronunciation scoring prototype
[OK] strictness modes
[OK] TTS test
[OK] full WAV → STT → LLM → TTS loop
[OK] grammar/naturalness correction
[OK] pronunciation ON/OFF toggle
[OK] key #4 skip logic
```

The prototype is ready to move from isolated tests toward a real app UI and latency optimization, while keeping the implementation minimal.

## 15. Repository cleanup

After the core tests were working, the repository root was cleaned up and files were grouped by purpose.

Final root layout:

```text
/
├─ .agent/
├─ .gitignore
├─ README.md
├─ requirements.txt
├─ scripts/
├─ tests/
└─ tools/
```

Files were reorganized as follows:

```text
scripts/
  setup.bat
  run_llm_test.bat
  run_stt_test.bat
  run_pronunciation_test.bat
  run_tts_test.bat
  run_full_loop_test.bat

tests/
  test_llm.py
  test_stt.py
  test_pronunciation.py
  test_tts.py
  test_full_loop.py
  stt_samples/

tools/
  preflight.py
```

Root is now intentionally limited to project-level files and top-level folders.

`api.txt` remains a local-only file at repository root and is still ignored by Git. Generated WAV output and other temporary test artifacts are also ignored so they do not dirty the repository.

The cleanup commit was:

```text
dc97248db673438a1d8eb070bb1de5b989da0444
```

## 16. Current run command

After the cleanup, the Windows command to run the full end-to-end loop from repository root is:

```bat
scripts\run_full_loop_test.bat
```

Typical update-and-run sequence:

```bat
git pull
scripts\run_full_loop_test.bat
```

This is the current entry point for testing the complete WAV → STT → pronunciation → LLM correction/reply → TTS flow.
