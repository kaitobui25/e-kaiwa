# E-KAIWA UI Refinement Plan (Preliminary)

Status: implementation complete for confirmed accessibility, containment, touch-target, i18n, contrast, and visual-noise scope. Rendered/browser and text-zoom verification remain pending because BrowserOS Neo was unavailable.

## Goal

Improve the existing public UI using Impeccable-style **Operate mode** principles:

- task completion and scanability first;
- simple, familiar, maintainable UI;
- fix measurable UX/accessibility problems before visual styling;
- preserve the current vanilla HTML/CSS/JS architecture and realtime behavior.

## Non-goals

- No React/Vue/Tailwind or new UI framework.
- No broad frontend rewrite.
- No backend/realtime/Gemini behavior changes unless strictly required for UI accessibility.
- No visual redesign just for novelty.
- Do not add dependencies unless there is a clear, unavoidable benefit.

## Scope

Primary files:

- `src/web/live.html`
- `src/web/live.css`
- `src/web/ui.js`
- `src/web/ui_overlay.js`
- `src/web/ui_render.js`

Prefer CSS/HTML changes. Touch JavaScript only when needed for behavior/accessibility.

## Phase 1 — Audit / harden first

Fix confirmed or high-confidence issues before aesthetic changes:

1. **Light-theme contrast**
   - Recheck muted and semantic text colors against actual surfaces.
   - Target WCAG AA body-text contrast >= 4.5:1.
   - Preserve dark theme quality.

2. **Form labels**
   - Associate public settings `<select>` controls with real `<label>` elements or equivalent accessible names.

3. **Overlay focus behavior**
   - Keep current initial focus behavior.
   - Add reliable focus containment/restore where necessary.
   - Ensure Escape/backdrop/close behavior remains intact.

4. **Touch targets**
   - Review small interactive controls (`inline-action`, score buttons, audio buttons, selects).
   - Aim for practical ~44x44px touch areas without visually bloating the UI.

5. **i18n consistency**
   - Identify remaining public hard-coded English strings in settings/overlays.
   - Move only user-facing strings that should follow the selected UI language.

## Phase 2 — Distill visual noise

Apply simplification without changing product identity:

- remove duplicate labels/headings in Settings;
- avoid border + shadow on the same surface when one is enough;
- remove or replace thick colored side-stripe card borders;
- remove decorative zero-offset glow/halo where it does not communicate state;
- keep cards only where they represent a real grouped object or interaction;
- preserve functional state indicators and meaningful feedback.

Do **not** remove waveform, avatars, gradients, bubbles, or other elements solely because they are stylistic. Remove/change them only if they fail hierarchy, clarity, state communication, or simplification goals.

## Phase 3 — Layout and typography cleanup

### Layout

- Keep the current mobile-first linear conversation flow.
- Preserve fixed bottom conversation controls unless testing shows a real problem.
- Introduce a small spacing scale where it reduces arbitrary values and drift.
- Use proximity/spacing before adding containers.
- Verify narrow screens, long content, localization, overlays, safe areas, and text zoom.

### Typography

- Keep the existing system-font approach unless a later design decision explicitly changes identity.
- Reduce unnecessary font-weight variation.
- Define a small, clear role system for title/body/label/metadata/score.
- Keep body copy around 16px unless a dense secondary role justifies smaller text.

## Phase 4 — Re-evaluate visual character

Only after Phases 1–3:

- inspect whether the UI still feels bland/generic;
- if needed, run a small scoped **bolder** pass;
- amplify existing E-KAIWA patterns instead of introducing a new visual system;
- do not add new colors, fonts, shadows, radii, motion, or decorative effects without a clear job.

## Phase 5 — Polish / verification

Verify representative public states:

- loading / connecting;
- ready;
- push-to-talk pressed/recording;
- hands-free listening;
- waiting / AI speaking;
- reconnect/error;
- empty conversation;
- normal conversation with several turns;
- pronunciation score + problem words;
- correction overlay;
- word practice overlay;
- replay overlay;
- Settings;
- light and dark theme;
- Japanese and Vietnamese UI;
- narrow mobile and desktop widths;
- keyboard navigation and focus.

Run existing syntax/tests and avoid touching unrelated realtime code.

## Suggested implementation order

```text
1. accessibility + hardening
2. distill
3. layout cleanup
4. typography cleanup
5. evaluate need for scoped bolder pass
6. polish + regression verification
```

## Acceptance criteria

- Current realtime conversation behavior is unchanged.
- No new framework/build system/runtime dependency.
- Public controls have accessible names and usable focus behavior.
- Light/dark themes maintain readable contrast.
- Small phone interaction remains comfortable.
- Settings and coach UI have less redundant visual/container noise.
- CSS becomes more consistent, not more abstract or complex.
- Any visual change has a concrete hierarchy/state/usability reason.

## Important note

This plan is based on a **code-only simulation of Impeccable methodology**, not an official `impeccable critique/audit` run. Before major visual changes, a real rendered/browser inspection should confirm the source-based findings and catch false positives.
