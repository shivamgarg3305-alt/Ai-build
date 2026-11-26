import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Read from disk: Vitest replaces CSS imports (even ?raw) with an empty string.
const read = (relative: string) => readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8');
const css = read('./styles.css');
const html = read('../index.html');

/**
 * jsdom does not lay anything out, so these tests cannot show that the screen LOOKS right on a phone. They pin the
 * CSS and HTML contracts that make it behave on one (no iOS input zoom, touch-target sizes, safe areas, dynamic
 * viewport height, mobile-first breakpoints). A real device check is still required.
 */
// Anchored to the start of a line, so ".btn {" cannot match inside "a.btn {".
const block = (selector: string): string => {
  const match = new RegExp(`(?:^|\\n)${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\{`).exec(css);
  if (!match) throw new Error(`no rule for ${selector}`);
  return css.slice(match.index, css.indexOf('}', match.index));
};
const rem = (text: string, property: string): number => Number(new RegExp(`${property}:\\s*([\\d.]+)rem`).exec(text)?.[1] ?? NaN);

describe('mobile layout contract', () => {
  it('declares a device-width viewport that extends under the notch, and is installable', () => {
    expect(html).toMatch(/name="viewport"[^>]*width=device-width/);
    expect(html).toMatch(/viewport-fit=cover/);
    expect(html).toMatch(/apple-mobile-web-app-capable/);
    expect(html).toMatch(/rel="manifest"/);
  });

  it('keeps text inputs at 16px or larger so iOS Safari does not zoom on focus', () => {
    expect(block('body')).toMatch(/font:\s*400 1rem/); // 1rem = 16px
    expect(block('.composer textarea')).toMatch(/font:\s*inherit/);
    expect(block('.field input')).toMatch(/font-size:\s*1rem/);
  });

  it('gives touch targets at least 44px', () => {
    expect(rem(block('.btn'), 'min-height')).toBeGreaterThanOrEqual(2.75);
    expect(rem(block('.nav-link'), 'min-height')).toBeGreaterThanOrEqual(3.5);
    expect(rem(block('.field input'), 'min-height')).toBeGreaterThanOrEqual(2.75);
    expect(rem(block('.btn-link'), 'min-height')).toBeGreaterThanOrEqual(2.75);
  });

  it('keeps content and the composer clear of the iOS home indicator and notch', () => {
    expect(block('.stage')).toMatch(/safe-area-inset-top/);
    expect(block('.stage')).toMatch(/safe-area-inset-bottom/);
    expect(block('.nav')).toMatch(/safe-area-inset-bottom/);
    expect(block('.composer')).toMatch(/position:\s*sticky/);
    expect(block('.composer')).toMatch(/safe-area-inset-bottom/);
    expect(block('.signin')).toMatch(/safe-area-inset-top/);
  });

  it('sizes the screen with the dynamic viewport height, not 100vh', () => {
    expect(block('.conversation')).toMatch(/100dvh/);
    expect(css).not.toMatch(/\b100vh\b/);
  });

  it('lets long words and wide content wrap instead of overflowing a narrow screen', () => {
    expect(block('.bubble')).toMatch(/overflow-wrap:\s*anywhere/);
    expect(block('.bubble')).toMatch(/max-width:\s*min\(100%/);
    expect(block('.signin-card')).toMatch(/width:\s*min\(100%/);
  });

  it('is mobile-first: base rules are the phone layout and the desktop layout is added at a min-width breakpoint', () => {
    expect(css).not.toMatch(/@media\s*\(max-width/);
    expect(css).toMatch(/@media \(min-width: 900px\)/);
    const desktop = css.slice(css.indexOf('@media (min-width: 900px)'));
    expect(desktop).toMatch(/--nav-h:\s*0px/);
    expect(desktop).toMatch(/\.nav \{[^}]*position:\s*static/);
  });

  it('respects reduced-motion for the new thinking indicator', () => {
    const reduced = css.slice(css.indexOf('prefers-reduced-motion'));
    expect(reduced).toMatch(/\.thinking-dots i/);
  });
});
