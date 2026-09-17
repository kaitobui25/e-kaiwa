# UI refactor follow-up summary

Date: 2026-09-17

## Context

- Claude UI reference/design was added in commit `092d7fc` (`add claude ui huong dan`).
- `AGENTS.md` was simplified in commit `b4bd6bd` so the main agent acts as a subagent coordinator and uses quota efficiently.
- PC Codex agent then refactored the UI in commit `e2eb5cc` (`0.14 ui update`).
- App version changed from `0.13` to `0.14` in `src/e_kaiwa/__init__.py`.

## What the UI refactor already changed

- Main visual identity changed from generic blue to Voice Teal.
- Talk button now has breathing/ripple motion.
- AI-speaking state uses Ember Coral and animated voice bars.
- New conversation turns animate in lightly.
- Coach score uses a circular progress ring and animated count-up.
- Target-language UI has small language-color accents.
- `prefers-reduced-motion` handling was added.
- JS UI tests were updated for the new coach score markup.
- Realtime/Gemini connection logic was not materially refactored by this UI commit.

## Remaining UI polish vs Claude reference

The implementation is good but not yet a full match to the Claude reference.

1. **AI avatar**
   - Claude reference wanted a coral/AI accent.
   - Current public UI still uses a neutral border and teal icon.
   - Polish the AI avatar so user voice and AI voice are visually distinct without making it heavy.

2. **Typography**
   - Claude reference proposed Bricolage Grotesque for display text and Inter for body text.
   - Current app still uses the system font stack.
   - Only change this if it can stay lightweight and maintainable; avoid unnecessary font/dependency complexity.

3. **Language selector treatment**
   - Current implementation only adds a small colored dot beside the label.
   - Claude mockup made language identity more obvious.
   - Improve this carefully without redesigning the settings flow or making the UI noisy.

## Direction for next agent

Continue from commit `e2eb5cc` instead of redesigning from scratch.

Priority:
1. Match the existing Claude reference more closely.
2. Mobile first.
3. Preserve realtime/Gemini behavior.
4. Keep vanilla implementation simple, clean, modular, and lightweight.
5. Do not add dependencies unless clearly necessary.
6. Reuse existing CSS/DOM where possible.
7. Check light/dark themes and reduced-motion behavior.
8. Run affected tests after UI changes.

Do not overengineer. The current direction is already mostly correct; this should be a polish pass, not another large refactor.
