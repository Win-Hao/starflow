---
name: starflow
zh_name: "星流发布页"
en_name: "Starflow launch page"
description: |
  Build an Astra-style dark launch page or hero: a bundled three.js starfield (Starflow engine)
  that tilts, scatters into side rails and re-forms into a cursor, a knot, or the user's own
  logo path as the reader scrolls. Use for product launches, model announcements, "new generation"
  reveals, or any hero that needs a living galaxy instead of a static gradient. Ships the engine,
  a wired page skeleton, a hero-only page, and the openai-astra DESIGN.md.
zh_description: |
  做 Astra 风格的暗色发布页或首屏：自带 three.js 星空引擎（星流 Starflow），星系随滚动翻转、
  散成两侧星轨、再聚成光标、结或用户自己的 logo 路径。适合产品发布、模型发布、「新一代」揭幕，
  或任何想用活的星系代替静态渐变的首屏。附带引擎、接好线的页面骨架、纯首屏页和 openai-astra DESIGN.md。
triggers:
  - "starflow"
  - "星流"
  - "astra style"
  - "astra 风格"
  - "astra launch page"
  - "particle hero"
  - "粒子首屏"
  - "starfield landing page"
  - "星空发布页"
  - "galaxy scroll animation"
  - "星星聚成 logo"
  - "stars form our logo"
license: MIT
metadata:
  author: Win-Hao
  version: "0.1.0"
  engine: "https://github.com/Win-Hao/starflow"
od:
  mode: prototype
  surface: web
  scenario: marketing
  category: landing
  preview:
    type: html
    entry: assets/template.html
  example_prompt: "Make a launch page for our new model Nova 2 in the Astra style: galaxy hero, three story sections, the stars should form a cursor and then our logo."
  example_prompt_i18n:
    zh-CN: "用 Astra 风格给我们的新模型 Nova 2 做一个发布页：星系首屏、三段故事，星星先聚成光标，再聚成我们的 logo。"
  design_system:
    requires: true
  craft:
    requires: [typography, color, anti-ai-slop, animation-discipline]
  critique:
    policy: opt-in
---

# Starflow launch page

Build a page whose hero is a living galaxy. The engine is bundled; your job is to wire it, lay the
page out in the Astra register, and write copy that the stars can accompany.

> **Skill root:** the folder that contains this `SKILL.md`. Side files live in `assets/`,
> `references/` and `design-systems/` next to it. In Open Design the skill is staged under
> `.od-skills/<alias>/`; read from there.

## What you ship

| Mode | When | Start from |
|---|---|---|
| **Launch page** | A scrolling announcement with story sections and shape reveals | `assets/template.html` |
| **Hero only** | A single screen: galaxy (or a shape) plus a headline and CTAs | `assets/hero.html` |
| **Embed** | The user already has a page and wants the effect in one block | `<iframe src="hero.html?shape=…">` or a `<canvas>` with `createAstraScene` |

Both pages import `./starflow.js` (ES module, self-contained, 646 KB / 165 KB gzip). Copy it next
to the HTML; do not rewrite the engine and do not load it from a CDN unless the user asks.

## Files

```
assets/starflow.js                 the engine (three.js + postprocessing bundled), MIT
assets/template.html               launch page: hero chrome, title stage, copy blocks, two cues, tail
assets/hero.html                   hero only; ?shape= ?text= ?icon= switch the formation
references/DESIGN.md               the openai-astra design system (colours, type, layout, motion)
references/engine-api.md           createAstraScene, setSource, setScroll, config keys, presets
references/choreography.md         the four scroll stages, thresholds, cue geometry, tuning
../design-systems/openai-astra/    the same design system as an Open Design package (repo root; use references/DESIGN.md when only this folder is installed)
```

## Workflow

1. **Pick the mode and collect content.** A launch page needs: two hero labels (a word for each
   side of the screen, e.g. "Nova" / "2"), one title, one lede, two to four story sections of one
   idea each, one caption per shape cue (four words or fewer), and one closing line. Hero-only needs
   an eyebrow, a headline, a lede and up to two CTAs. Ask for a logo path only if the user wants the
   stars to form their mark.
2. **Copy the assets.** `starflow.js` plus the chosen page into the output folder. Rename the page
   to `index.html`. Keep the `:root` token block at the top of the `<style>`; it is the design
   system's contract.
3. **Apply the design system.** If the selected design system is `openai-astra` you already have
   it in context. Otherwise read `references/DESIGN.md` and keep its rules: black canvas, white
   text, white-at-alpha secondaries, one typeface at weight 500 / 400, pill controls, a 669px copy
   column with empty rails, no gradients, no shadows, no scroll effects on copy.
4. **Lay the page out** (launch mode). Keep the section order and the `data-astra-*` attributes:
   - `.hero` is exactly one viewport tall and holds no copy.
   - The first `.copy` after it carries `data-astra-intro`; its position drives tilt and scatter.
   - `[data-astra-shape]` sections are the reveals. The frame is 576px × 80vh; do not resize it.
   - The last cue holds its shape for the rest of the page. Put the strongest shape last.
   - Story sections between cues are plain `.copy` blocks: an `h2` and one or two paragraphs.
   - The page keeps the site chrome from `template.html`: a fixed 54px transparent header (wordmark,
     13px nav links, search, glass "Log in" pill, one white CTA) and a footer of link groups at 13px / 500
     with a bottom bar. Edit the words, not the geometry. Do not add a blur behind the header.
   - For benchmarks, quotes, screenshots and comparison tables use the recipes in `references/DESIGN.md`
     §4 (chart card, dropdown select, quote card, media frame, comparison table); `../design-systems/openai-astra/components.html`
     has working markup for each, including the auto-advancing tabs (6s cycle, 2s hold then a 4s linear fill in the
     selected pill; hover and off-screen pause; click restarts) linked to chart panels.
5. **Choose the shapes.** Presets: `cursor` (single closed path, fast flow) and `openai-knot`
   (six arcs). For the user's own mark, export the outline as SVG paths and set
   `data-astra-shape="brand" data-astra-paths='["M…","M…"]' data-astra-viewbox="0 0 W H"` on the
   cue. Stars follow stroke centre-lines, so use outlines, not filled blobs; keep it to a few
   paths. For filled text or icons in hero-only mode use `setSource({ type: 'text' | 'svg' | 'image' })`.
6. **Write the copy.** Headings at h2 size, sentences that stand alone, no exclamation marks, no
   feature lists in the reveals. The caption under a cue names what the shape means ("It takes
   action"), the note under it is one sentence.
7. **Tune only if asked.** Engine defaults are the page's: 4,000 stars, size 2.05, flow 0.8, bloom
   0.7 / 0.08 / 0.72, ambient `#23435f` at 0.55. Palettes: `astra`, `aurora`, `ember`, `ice`,
   `gold`. See `references/engine-api.md` before changing anything else.
8. **Verify** in a browser at 1440 and 390 wide: intro plays for 5.5s, labels reveal, the galaxy
   tilts and clears the column as the title stage arrives, each cue forms and dissolves, the last
   one holds, scrolling back reverses everything, no console errors, and the page still reads with
   WebGL disabled (static star map, visible cue paths).

## Rules

- The engine is the effect. Never re-implement the particle system, the bloom, or the scroll maths
  from a description; import them.
- Only stars respond to scroll. No parallax on copy, no pinned sections, no scroll-snap, no reveal
  animations on text.
- Black stays black. No charcoal, no noise, no CSS vignette, no gradient backgrounds, no
  `backdrop-filter` over the canvas.
- Monochrome chrome. One white pill per screen; every other control is glass (`#ffffff1f`).
- Content never blocks the canvas: keep `.page { pointer-events: none }` and re-enable it only on
  links and buttons, so dragging and hover-repel keep working.
- Keep the static fallback path and honour `prefers-reduced-motion`.
- Fonts: OpenAI Sans is proprietary. Ship the stack as written (Inter fallback); do not embed it.
- Do not add OpenAI logos or copy. The `openai-knot` preset is a path in the engine; if the user is
  not OpenAI, replace it with their own mark or the cursor.

## Anti-patterns that get a page rejected

Purple-to-pink gradients, glowing card borders, floating 3D blobs, hero copy centred over the
galaxy, more than one CTA colour, a second typeface, stars used as a background texture behind
dense UI, copy that animates on scroll, a canvas that stops the page from scrolling on touch.

## Attribution

Engine: Starflow (<https://github.com/Win-Hao/starflow>, MIT; this skill lives in the same repository under `skill/`), a re-implementation of the
particle choreography on the GPT-6 Astra launch page. The design system is an independent
distillation of that page's public CSS; it is not affiliated with OpenAI.
