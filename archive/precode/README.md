# Pre-code archive

This directory contains experiments and utilities created before the current realtime E-KAIWA production flow was established.

It is intentionally frozen and is not part of the normal runtime or CI path.

Contents:

```text
tests/    historical STT, LLM, TTS, pronunciation, Live and full-loop experiments
scripts/  runners for those experiments
tools/    old environment/preflight utility
legacy/   old Gradio UI and compatibility shim
```

Rules:

- Production code must not import from this directory.
- New maintained code belongs under `src/`.
- Files here may be useful for historical comparison or debugging old decisions, but they are not expected to keep working as external model APIs evolve.
