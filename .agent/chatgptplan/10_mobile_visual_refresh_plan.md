# E-KAIWA Mobile Visual Refresh Plan

Status: planned for implementation on `ui/mobile-composition-refresh`.

## Goal

Make the public mobile UI feel like a calm language-practice product instead of a generic AI voice demo, while preserving the existing vanilla HTML/CSS/JS architecture and realtime behavior.

## Principles

- Mobile-first composition, not warning-by-warning cleanup.
- Conversation + talk control are the dominant visual hierarchy.
- Reduce decorative chrome that does not communicate state or function.
- Keep the product familiar, fast, accessible, and maintainable.
- No framework, build-system, or dependency changes.
- Do not touch backend/Gemini/audio/session behavior unless strictly required by UI markup.

## Pass 1 — Conversation + talk dock

- Keep left/right conversation flow.
- Reduce pastel/shadow/radius treatment so messages feel lighter and easier to scan.
- Make AI visually quieter; keep user speech clearly distinguishable.
- Remove decorative voice-wave bars unless they represent real audio state.
- Keep the microphone as the single primary action.
- Reduce dock height and visual chrome.
- Keep status close to the talk control; keep language/speed as quiet metadata.

## Pass 2 — Coach + Settings

### Coach

- Replace card-on-card presentation with simple sections, rows, spacing, and dividers where possible.
- Score is the headline.
- Accuracy / fluency / intonation are compact rows.
- Problem words become a simple actionable list.
- Natural-expression feedback stays prominent without another heavy card layer.
- Tips are supporting content, not another decorative container unless needed.

### Settings

- Use familiar mobile product rows.
- Avoid repeated section heading + row label.
- Remove decorative section-icon circles where they do not improve recognition.
- Keep controls and labels accessible and touch-friendly.
- Preserve version/update behavior.

## Pass 3 — Visual system + polish

- Keep `system-ui`, existing SVG icon system, blue accent, light/dark themes.
- Use accent color mainly for action/state, not decoration.
- Prefer neutrals over pastel surfaces.
- Reduce gradients, shadows, and oversized radii.
- One surface should normally use border OR shadow, not both.
- Normalize typography around 400 / 600 / 700 weights where practical.
- Keep the already-fixed contrast, labels, focus containment, and >=44px touch targets.

## Mobile verification targets

- 320px / 375px / 390px / 430px widths.
- iPhone safe area.
- Long Japanese/Vietnamese/English strings.
- 200% text zoom.
- Conversation with several turns.
- Coach overview, correction, word practice, replay.
- Settings.
- Light/dark themes.
- Push-to-talk and hands-free states.

## Expected code scope

Primary:

- `src/web/live.css`
- `src/web/live.html`
- `src/web/ui_render.js` only if simpler markup materially improves coach layout.

Avoid unrelated changes to realtime/audio/backend/session code.

## Definition of done

- On phone, conversation + microphone read immediately as the primary task.
- The screen no longer feels like a stack of rounded cards.
- Decorative elements do not compete with content/state.
- Coach reads like learning feedback, not a dashboard.
- Settings feels familiar and compact.
- No new dependency or framework.
- Realtime functionality remains unchanged.
- Existing accessibility fixes remain intact.
- CSS stays understandable and does not become a second design framework.
