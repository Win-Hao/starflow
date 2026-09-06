# Scroll choreography

The launch page tells its story with the same 4,000 stars in four stages. The page measures the
DOM and computes progress values; the engine does damping, blending and light. This file is the
spec for `assets/template.html`'s `update()`.

## Units

- `progress = scrollY / 800`. The page's disperse distance is 800px; scatter keeps going to 1.1875.
- `--astra-viewport-height` is set from `window.innerHeight` on resize; every vh-based size (hero,
  cue frames) uses it so mobile URL bars do not shift the layout.
- Cue "entry" `= (viewportHeight - rect.top) / (viewportHeight + rect.height)`, 0 when the frame's
  top touches the bottom of the viewport, 1 when its bottom leaves the top.

## Stages

| Stage | Driver | Rule |
|---|---|---|
| **Intro** | time | 5.5s. Stars fly in along the arms; ambient glow fades to 0.55; labels reveal from 0.85s. |
| **Tilt** | `[data-astra-intro]` position | Galaxy rotates to −52° about X. Progress 0 when the block's top is at 66% of the viewport, 1 when its centre reaches the viewport centre; the tilt peaks at 75% of that travel and flattens back at 100%. |
| **Scatter** | same driver | 72% of stars move to rails outside `contentBounds`; inner rail edge thinned with a sqrt falloff; brightness → 18%, dim stars → 45% size. Rails keep a depth-weighted parallax (`scrollStarDriftSpeed` 3) while scrolling continues. The ambient glow stays constant; the opaque footer ends it. |
| **Shape** | `[data-astra-shape]` cues | Formation `smoothstep(entry, 0, 0.36)`, dissolve `1 - smoothstep(entry, 0.5, 0.86)`. Each star lands on the path by seed, keeping its own lateral offset and flow speed from the galaxy. On formation the shape swings 0.42 rad. |
| **Hold** | last cue | `holdAtRangeEnd`: the final cue never dissolves. Put the strongest mark last. |

Only the strongest cue is active at a time; `strength` is the max over cues. Scrolling back replays
every stage in reverse; seeds make it deterministic.

## Geometry

- Copy column: `max-width 676px`, centred. `contentBounds` is measured from the first `.copy` and
  passed as viewport fractions.
- Cue frame: `576px` max width × `0.8 × viewport height`. The frame holds an invisible SVG with the
  path so the aspect ratio is reserved; the target rect is converted to NDC (`centerNdc`,
  `sizeNdc`) every frame. Stars land inside the frame, fitted by the path's own aspect ratio.
- Hero: exactly one viewport, no copy. The split labels sit at 50% height, inset
  `clamp(20px, 4vw, 56px)`; on phones 46% / 54% with 16px insets.

## Chrome fades

- `--astra-copy-opacity = 1 - min(1, progress × 2)`: labels, scroll hint and replay fade over the
  first 400px, then the layer is hidden.
- `--astra-title-parallax-y = min(1, progress) × 120px`: the title lags the scroll by up to 120px.

## Tuning

| Symptom | Change |
|---|---|
| Stars crowd the copy | Lower scatter brightness is not the fix; widen the rails by passing a narrower `contentBounds` (e.g. measure `.copy` with 24px extra padding). |
| A cue forms too late | It enters late because the block above is long. Shorten the copy block or move the cue up; do not change the 0.36 threshold. |
| Two cues fight | They overlap in the viewport. Add a `.copy` block between them or increase cue padding (18vh). |
| Shape looks like a blob | The path is filled, not outlined. Use stroke outlines, fewer paths, and `shapeScatter` 0.7. |
| Formation feels stiff | `shapeAutoRotateAmount` 0.42 → 0.6, or `flowSpeed` 0.8 → 1.2 for closed single paths (the cursor preset uses 2.4). |
| Page stutters on laptops | Keep `adaptiveQuality: true`; set `quality: 'lite'` on `deviceMemory < 4`; never exceed `pixelBudget` 2.4e6. |
| Reduced motion | Do not animate anything; call `renderStaticFallback` and reveal cue paths at `#fafafa4d`. |

## What never moves

Copy, buttons, images, section backgrounds. If something other than a star animates on scroll,
remove it.
