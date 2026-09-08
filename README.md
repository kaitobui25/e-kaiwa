# e-kaiwa

Minimal environment + Gemini LLM checks for the AI English conversation project.

## 1. PC preflight

On Windows, double-click `run.bat` or run:

```bat
run.bat
```

This checks Python, internet, FFmpeg, microphone, speaker, and basic audio recording/playback.

## 2. Gemini API test

Create `api.txt` in the repository root. Put one Gemini API key per non-empty line, for example:

```text
AIza...
AIza...
```

`api.txt` is ignored by Git and must never be committed.

Then run:

```bat
run_llm_test.bat
```

The script will:

- read every key from `api.txt`
- check whether each key can access the Gemini API
- list models that support `generateContent`
- try a small real prompt on suitable text models
- report working/broken/rate-limited keys without printing the full API key
- recommend the most practical model found for this project

No SDK is required; the test uses Python's standard library and Gemini's REST API directly.
