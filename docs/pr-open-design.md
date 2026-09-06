## Summary

Adds `design-systems/openai-astra/`, the dark, cinematic launch-page register of openai.com as seen on the GPT-6 Astra announcement page.

**Why a separate slug from `openai`:** the bundled `openai` system describes the light editorial surface (white canvas, teal accent, Signifier serif, "no parallax, no scroll-jacking"). The Astra launch page is the opposite register: pure black canvas, a particle galaxy whose scroll choreography *is* the page, OpenAI Sans at weight 500 only, monochrome pill chrome, and a single teal-blue ambient glow. Merging them would make both wrong.

## What's included

- `manifest.json` (`od-design-system-project/v1`, `id: openai-astra`, `source.type: bundled`)
- `DESIGN.md`, 10 sections: theme, colour roles (incl. documented extension values for the glow and star palette), typography (fluid scale table), components, layout, depth, motion & scroll choreography, do's and don'ts, responsive, agent prompt guide
- `tokens.css`: every A1 / A2 / B-slot token from the shared schema, no brand extensions; values cross-referenced to the site's `--color-*`, `--type-*`, `--radius-*`, `--transition-*` tokens in header comments
- `components.html` (first `:root` pasted from `tokens.css`; hero chrome, buttons, inputs, badges, cards, links, copy column, shape cue, benchmarks, panels) and `components.manifest.json` derived with `extractComponentsManifest` (94 selectors, 47 referenced tokens, 9/9 groups present, no undeclared references)
- `USAGE.md`, `preview/{colors,typography,spacing}.html`
- `source/evidence.md`: observed values from the page's CSS and DOM, plus the particle choreography numbers measured through the open-source Starflow engine

## Evidence and licensing

Values are read from a local capture of the public page (2026-09-05). No fonts (OpenAI Sans is proprietary; Inter is the declared fallback), logos, images, or scripts are included. The package is an independent distillation and says so in `DESIGN.md` and `USAGE.md`.

## Not included

`design-tokens.json`, `tailwind-v4.css`, `system/` and the localized `DESIGN-<locale>.md` files are derived outputs; I left them for the maintainers' generation scripts. Happy to add them if you prefer they ship in the PR.

## Checks

- `pnpm guard` passes (153 project manifests valid, package quality average 100, token-fixture sync, A1/A2/B-slot, unknown-token allowlist, flag parity, component manifest extraction)
- `pnpm typecheck` passes (full workspace)
- Opened `components.html` and the three preview pages in a browser

## Related

Pairs with the external `starflow-launch` plugin (`github:Win-Hao/starflow-skill`), which bundles the particle engine and a wired page skeleton. That plugin is intentionally not part of this PR.
