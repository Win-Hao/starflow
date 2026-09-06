# Starflow engine API

`assets/starflow.js` is an ES module with three.js and postprocessing bundled. Import what you need:

```js
import {
  createAstraScene, detectWebGL, prefersReducedMotion, renderStaticFallback,
  createShapeSamples, PATH_PRESETS, DEFAULT_SHAPE_SETTINGS, ICON_PRESETS, TEXT_PRESETS,
  PALETTES, DEFAULT_CONFIG, DEFAULT_FIELD_OPTIONS,
} from './starflow.js'
```

The same API is on npm as `@win-hao/starflow` (`import … from '@win-hao/starflow'`, three as a dependency) and as a
global for non-module pages (`assets/starflow.iife.js` → `window.Starflow`).

## createAstraScene(canvas, config?) → astra

Creates the renderer, the post-processing chain (bloom, lens flare, ACES tone mapping, ambient +
vignette) and the pointer handlers on `canvas`. The canvas should fill its container; the engine
observes size changes. Returns:

| Member | What it does |
|---|---|
| `setSource(source, fieldOptions?)` | Builds the star field. Returns `{ count, layers }`. Replays the intro. |
| `setScroll(patch)` | Feeds scroll state (see below). Call once per frame at most. |
| `setConfig(patch)` | Updates render config live (any `DEFAULT_CONFIG` key). |
| `replay()` | Restarts the 5.5s intro. |
| `setDisperse(value)` | Manual 0..1 scatter, for pages without scroll. |
| `config` | The live config object (read, or write single keys such as `ambientOpacity`). |
| `stats` | `{ count, layers }` or `null`. |
| `dispose()` | Tears down listeners, GPU buffers and the renderer. |

### Sources

| `source` | Notes |
|---|---|
| `{ type: 'galaxy' }` | The five-arm spiral from the launch page. Default. |
| `{ type: 'paths', paths: [d, …], viewBox: [x, y, w, h] }` | Stars along SVG path centre-lines, one layer per path. Use for cursor, knot, logos. |
| `{ type: 'galaxy-text', value: '2026' }` | Galaxy digits 0–9: each digit is five spiral arms plus a core cluster with its own flare, the way the page writes its 6. Multi-digit strings are laid out left to right. |
| `{ type: 'text', value: '6', fontWeight: 700, fontFamily? }` | Rasterised text → stroke centre-lines → a tube of stars. |
| `{ type: 'svg', markup: '<svg …>' }` | Rasterised SVG → contours. Filled shapes work here. |
| `{ type: 'image', src: url }` | Rasterised image (alpha or luminance) → contours. |

### fieldOptions (defaults from `DEFAULT_FIELD_OPTIONS`)

| Key | Default | Meaning |
|---|---|---|
| `starCount` | 4000 | Total stars (galaxy: 5 arms × 390 × density; the page's number). Path shapes use 5000. |
| `size` | 2.05 | Base star size. The "big soft bright star" look comes from this value. |
| `scatter` | 0.041 | Half-width of the star band relative to shape height. Path shapes: 0.07. |
| `backgroundRatio` | 0.14 | Share of stars left in the sky as background. |
| `rotationDepth` | 1.4 | Z undulation of arms so drag-rotation shows depth. |
| `stroke` | auto | Raster sources: `center` = stars ride the stroke centre-line as a round tube (text, stroke icons; the original's digits), `outline` = follow the contour; auto picks by stroke thickness. |
| `strokeSpread` | 1.3 | Centre-line spread, multiple of the local half stroke width. |
| `pathShape` | false | Raster shapes use the original path-shape star rules (thick band, five heroes, half the bright stars dimmed), the look of the page's cursor / heart cues; pair with `scatter: 0.07` and `PATH_SHAPE_SETTINGS`. |
| `depth` | auto | Extra Z spread per star (fraction of shape height) for outline mode, default 0.1; centre-line mode, galaxy and paths default to 0. |
| `palette` | `'astra'` | `astra`, `aurora`, `ember`, `ice`, `gold` (see `PALETTES`). |
| `brightRetention` | 1 | Share of bright stars kept bright in path mode (page: 0.5). |
| `densityFalloff` | 0.22 | Sparser at arm ends, denser mid-arm. |
| `centerCluster` / `clusterCount` | true / 96 | The dense core; it is also the lens-flare light source. |
| `seed` | 0 | 0 reproduces the page's exact star sequence. |

### config (defaults from `DEFAULT_CONFIG`)

Most-used keys. Everything else is documented inline in the engine source.

| Key | Default | Meaning |
|---|---|---|
| `quality` | `'full'` | `full` / `lite` / `none` post-processing. |
| `pixelBudget` | 2.4e6 | Max framebuffer pixels regardless of DPR. |
| `adaptiveQuality` | true | Half-rate rendering, then tighter budget, when frames drop. |
| `bloomIntensity` / `bloomThreshold` / `bloomRadius` | 0.7 / 0.08 / 0.72 | The glow. |
| `intensity` | 1.35 | Star brightness multiplier. |
| `twinkleSpeed` | 0.62 | Twinkle rate. |
| `flowSpeed` | 0.8 | Flow along arms; 0 = still. Cursor preset uses 2.4. |
| `sizeFalloff` | 0.45 | Star shrink toward open path ends. |
| `dimSizeScale` | 1 | Dim-star size multiplier (path shapes: 0.8). |
| `coreSpin` | true | Core cluster rotation. |
| `rotationLag` | 0.68 | Per-layer lag when dragging. |
| `introDuration` | 5.5 | Seconds of intro. |
| `autoRotate` / `autoRotateAmount` / `autoRotateSpeed` | false / 0.16 / 0.22 | Idle rotation for hero-only pages that want motion. |
| `pointerRepel` | true | Hover pushes stars aside (GPGPU; needs `setSource` after toggling). |
| `reducedMotion` | undefined | Force on/off; undefined follows the OS setting. |
| `fillX` / `fillY` | 0.8 / 0.89 | Shape size as a share of the viewport. Path shapes: 0.6 / 0.64. |
| `center` | `[0, 0]` | Shape offset in half-viewports; use to clear a copy column (`[0.25, 0]`). |
| `lensFlare` | `{ enabled: true, intensity: 0.28, … }` | Flare on the core. |
| `ambientColor` / `ambientOpacity` / `vignette` | `#23435f` / 0.55 / 1 | Glow and vignette are rendered in post, not CSS. |
| `ambientFloor` | 0 | Share of the glow spread evenly over the whole canvas (0 = pure radial, the page's CSS). |

The launch-page skeletons use `ambientOpacity 0.55, vignette 0.85` (floor 0): measured against the page's own CSS layers at 1440×900 this reproduces the black centre, the `(4, 8, 11)` mid-edges and the `(6, 12, 18)` corners.
| `scrollEffects` | true | Enables the scroll choreography. |
| `scrollStarDriftSpeed` | 3 | Rail parallax speed. |
| `shapeAutoRotate` / `shapeAutoRotateAmount` | true / 0.42 | Swing on shape formation (radians). |
| `shapeScatter` | 1 | Band-width multiplier for path shapes. |
| `shapeBrightRetention` | 0.5 | Bright stars kept bright inside shapes. |

## setScroll(patch)

```js
astra.setScroll({
  progress,          // scrollY / 800
  tiltProgress,      // 0..1, or null to follow progress
  scatterProgress,   // 0..1, or null to follow progress
  contentBounds,     // { left, right } as viewport fractions; the rails leave this column empty
  shape: {           // omit or strength 0 when no cue is active
    id, samples,     // samples from createShapeSamples(paths, viewBox), cached per cue
    strength,        // 0..1 formation
    centerNdc,       // [x, y] in NDC (-1..1)
    sizeNdc,         // [w, h] in NDC units (2 = full viewport)
  },
})
```

Damping, blending between galaxy / rails / shape, and lens-flare tracking happen inside the engine;
the page only measures the DOM. `assets/template.html` contains the reference `update()`.

## Shapes and presets

- `createShapeSamples(paths, viewBox)` → `Float32Array` of 1024 samples along the paths, ready for
  `setScroll`. Call once per cue, not per frame.
- `PATH_PRESETS.cursor` and `PATH_PRESETS['openai-knot']`: `{ label, paths, viewBox, settings }`.
  `settings` are the hero-only field/config values that make each shape read well.
- `ICON_PRESETS`: `cursor`, `heart`, `star`, `bolt`, `ring` as `{ markup }` for `type: 'svg'`.
- `TEXT_PRESETS`: sample strings for `type: 'text'`.
- `createShapeSamplesFromPolylines(polylines, bbox?)`: shape samples from traced polylines (`rasterize` → `extractStrokes` / `extractContours`), so any icon can be fed to `setScroll({ shape })` and formed by the galaxy's own stars, exactly like the page's cursor and heart cues.
- `GALAXY_DIGITS` / `GALAXY_DIGIT_CHARS` / `createGalaxyTextLayers(value)`: the galaxy-digit arm layouts (100 × 140 grid per digit) if you want to draw your own.
- Custom logo: export outlines from Figma as SVG, take the `d` of each `<path>`, pass them as
  `paths` with the SVG `viewBox`. Keep to a handful of paths; stars follow stroke centre-lines.

## Fallback

```js
if (!detectWebGL() || prefersReducedMotion()) {
  renderStaticFallback(canvas, source, fieldOptions)   // 2D still star map with the same distribution
}
```

Add `data-astra-static="true"` on `<html>` so CSS can reveal the cue paths and stop label animation.

## Embedding without the skeleton

```html
<canvas id="astra" style="position:fixed;inset:0;width:100%;height:100%"></canvas>
<script type="module">
  import { createAstraScene } from './starflow.js'
  const astra = createAstraScene(document.getElementById('astra'), { autoRotate: true })
  astra.setSource({ type: 'galaxy' })
</script>
```

Or `<iframe src="hero.html?shape=openai-knot" style="border:0;width:100%;height:100vh">` for a
hosted block. Query parameters: `shape`, `text`, `icon`.
