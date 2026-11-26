# PAPPU design rule: strict black and white only (permanent)

**Status: permanent product requirement.** It applies to every existing and future screen, feature, component and interface of PAPPU. It is not a theme, a preference or a setting, and there is no dark mode. **No exception may be introduced without the owner's explicit approval.**

Documenting this rule does not mean the existing screens comply. They do not yet; see [Current compliance](#current-compliance).

## The rule

The owner's requirement is **STRICT BLACK AND WHITE ONLY**.

- Backgrounds: pure white `#FFFFFF`.
- Text: pure black `#000000`.
- No other colours anywhere in PAPPU's application UI.
- **No grey shades, including neutral greys.**
- No coloured or grey text.
- No coloured accents or highlights.
- No gradients or tinted backgrounds.
- No coloured or grey buttons.
- No colourful icons.
- No grey or coloured borders, dividers, separators, shadows or focus rings.
- All icons, borders, dividers, buttons and controls use only pure black `#000000` and pure white `#FFFFFF`.
- No dark mode.
- No exceptions without explicit owner approval.

The design must remain clean, minimal, premium, modern and professional, while keeping accessibility, readability, spacing, a clear visual hierarchy and clearly distinguishable interaction states, using only black and white.

## Applying it

**Only two values exist:** `#FFFFFF` and `#000000`. That includes CSS, SVG fills and strokes, canvas and WebGL output, the PWA manifest, `theme-color` and system UI colours. Transparency or opacity that blends black and white into a grey is not allowed (for example `rgba(0,0,0,0.5)` or `opacity: 0.6` on black elements). Browser and PWA chrome use `#FFFFFF`, and `color-scheme` is `light`.

**Visual hierarchy** comes from size, weight, letter-case, spacing, alignment, rule thickness and layout. It never comes from lighter or grey text.

**Interaction states** must be distinguishable using only black and white, and never by colour alone:

| State | Black-and-white treatment |
| --- | --- |
| Default control | `#000000` border (1px or more) on `#FFFFFF`, or solid `#000000` with `#FFFFFF` text for the primary action |
| Hover | Inverted (`#000000` fill, `#FFFFFF` text) or a thicker `#000000` border |
| Focus | Solid `#000000` outline of at least 2px, separated from the control by a `#FFFFFF` offset; never removed |
| Active / pressed | Inverted, or a thicker border |
| Selected / current | Inverted item or a solid `#000000` indicator bar, plus `aria-current` |
| Disabled | Dashed `#000000` border, `not-allowed` cursor and an explicit text label such as "Unavailable"; announced to assistive technology. No greying out |
| Error | Explicit wording ("Error: …"), a distinct black icon, thicker `#000000` border, `role="alert"` |
| Success / warning / info | Distinct black icons plus wording |
| Loading | `#000000` spinner or pattern, with text for screen readers |

**Depth and separation** use `#000000` lines, solid black blocks or white space only. There are no shadows, glows or blurs. Motion stays subtle, and `prefers-reduced-motion` is respected.

**Icons** are drawn in `#000000` on `#FFFFFF`, or inverted. The approved PAPPU logo is black and white and is never recoloured or redesigned.

## Not decided: no exception exists until the owner approves one

These cases are **not** exempt. Each needs an explicit owner decision before any UI that shows it is built:

1. **Photographs, screenshots and other images the owner uploads.** No display treatment is approved yet.
2. **The approved 3D avatar.** It must be preserved exactly. If its approved design is not purely black and white, how it is shown requires the owner's decision. Nothing is assumed (decision D9).
3. **Illustrations or other visual content.** Not approved.
4. **Browser rendering.** Font smoothing and anti-aliased edges are produced by the browser and operating system, not specified by PAPPU. Whether the design must also control them (for example by disabling font smoothing) is for the owner to decide. No setting has been assumed.

## Enforcement (planned)

When the UI is migrated, CI will fail the build if any colour value other than `#FFFFFF` or `#000000` (or the keywords `white` and `black`) appears in `apps/web` styles, components and SVGs, the manifest or `index.html`, or if grey-producing alpha or opacity values are used. It is not added yet, because the current UI would fail it on every screen.

## Current compliance

**The current web UI does not comply.** It predates this rule, and per the owner's instruction it has not been redesigned yet.

| Location | Current state |
| --- | --- |
| `apps/web/src/styles.css` | Dark navy background `#080c16`, light and grey text, amber accent `#f0b46c`, green success and red danger colours, translucent "glass" panels and borders; `color-scheme: dark` |
| `apps/web/index.html` | `theme-color` `#080c16`, `color-scheme` dark |
| `apps/web/public/manifest.webmanifest` | `background_color` and `theme_color` `#080c16` |
| `apps/web/public/icon.svg` | Amber glow on a dark square: a placeholder, not the approved logo |

Migrating these is future UI work, done together with the approved logo assets.
