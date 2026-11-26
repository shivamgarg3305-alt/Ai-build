# PAPPU visual design rule (permanent)

**Status: permanent product requirement.** This is not a theme, a preference or a setting. All future UI work must follow it. Recorded during F0; the existing screens have **not** been redesigned yet (see [Current compliance](#current-compliance)).

## The rule

PAPPU uses a strictly monochrome visual design.

| Element | Requirement |
| --- | --- |
| Background | Pure white `#FFFFFF` |
| Text | Pure black `#000000`, every piece of text |
| Other colours | **None anywhere in the application UI**: no coloured accents, gradients, tinted backgrounds, coloured buttons or colourful icons |
| Borders, separators, icons, controls | Black, white, or neutral monochrome treatments only |
| Character | Premium, minimal, modern, consistent, professional |
| Accessibility | Readability, a clear visual hierarchy and usable interaction states are preserved |

## How to apply it

**Palette.** Only `#FFFFFF`, `#000000` and, for non-text elements, true neutral greys (equal red, green and blue values, for example `#E5E5E5`). Text is always `#000000`. Nothing with a hue, ever, including in SVGs, shadows and focus rings.

**Hierarchy without grey text.** Secondary information is distinguished by size, weight, spacing, letter-case and layout, not by lighter text.

**Interaction states** must stay distinguishable without colour (this is also a WCAG requirement: never rely on colour alone):

| State | Monochrome treatment |
| --- | --- |
| Default control | Black 1px border on white, or solid black with white text for the primary action |
| Hover | Inverted (black fill, white text) or a heavier border |
| Focus | Visible black outline of at least 2px with a white offset; never removed |
| Active / pressed | Inverted, or inset |
| Selected / current | Solid black indicator or inverted item, plus `aria-current` |
| Disabled | Dashed or lighter neutral border, `not-allowed` cursor and an explicit text label. Text stays black; the state is announced to assistive technology |
| Error | Icon plus explicit wording ("Error: …"), heavier border, `role="alert"`. No red |
| Success / warning / info | Distinct monochrome icons plus wording. No green, amber or blue |
| Loading | Monochrome spinner or skeleton in neutral grey, with text for screen readers |

**Contrast.** Text is black on white (21:1). Neutral greys used for meaningful non-text elements (control borders, icons, focus indicators) must keep at least 3:1 against white (`#949494` or darker); purely decorative separators may be lighter.

**Icons and imagery.** Line or solid icons in black. The approved PAPPU logo is black and white and fits the rule; it is never recoloured.

**Light only.** There is no dark mode: the background is always `#FFFFFF`. Browser and PWA chrome (`theme-color`, manifest `background_color` and `theme_color`) use `#FFFFFF`, and `color-scheme` is `light`.

**Motion and depth.** Subtle and neutral: grey shadows only, no glows, no coloured blur. `prefers-reduced-motion` stays respected.

## Open questions for the owner

These need a decision before the affected UI is built:

1. **Owner content.** Photos, screenshots and documents you upload contain colour. The proposal is to show them as they are, since they are your content and not UI, unless you want them shown in greyscale.
2. **The approved 3D avatar.** If the approved character design contains colour, the avatar must be preserved exactly. That would be a deliberate exception to this rule, or the design is already monochrome. This is decided when the avatar files are supplied (decision D9).
3. **Grey for non-text elements.** This document reads "neutral monochrome treatments" as allowing true neutral greys for borders, separators, control fills and shadows, but never for text. Confirm or tighten to black and white only.

## Enforcement (planned)

When the UI is migrated, a CI check will be added that scans `apps/web` styles, components, SVGs, the manifest and `index.html` for any colour value that is not `#FFFFFF`, `#000000` or a true neutral grey, and fails the build. It is not added in F0, because the current UI would fail it on every screen.

## Current compliance

**The current web UI does not comply.** It predates this rule. It was not redesigned in F0, by instruction.

| Location | Current state |
| --- | --- |
| `apps/web/src/styles.css` | Dark navy background `#080c16`, light text, amber accent `#f0b46c`, green success and red danger colours, translucent "glass" panels; `color-scheme: dark` |
| `apps/web/index.html` | `theme-color` `#080c16`, `color-scheme` dark |
| `apps/web/public/manifest.webmanifest` | `background_color` and `theme_color` `#080c16` |
| `apps/web/public/icon.svg` | Amber glow on a dark square: a placeholder, not the approved logo |

Migrating these is future UI work, to be done together with the approved logo assets.
