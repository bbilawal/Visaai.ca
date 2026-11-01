/**
 * Monad design tokens, ported 1:1 from apps/web/app/globals.css `@theme`.
 * Values are duplicated (not imported) because Metro cannot consume Tailwind v4
 * CSS custom properties — the *values* are the contract, so any change to
 * globals.css must be mirrored here. Names match the web token names exactly to
 * make that diff mechanical.
 */
export const colors = {
  ink: '#000000',
  paperCanvas: '#f6f3f1',
  offBlack: '#242424',
  paleStone: '#4e4d4d',
  whisperGray: '#3d3d3d',
  atmosphereWash: '#cfdaf5',
  subtleLink: '#333333',
  /**
   * Was #797776 on web (4.03:1 on paper-canvas), below the 4.5:1 WCAG 2.2 AA
   * minimum for body text (1.4.3). Mobile darkened it to #6f6d6c in Task 9;
   * Task 12 found that value still failed at 4.26:1 on the SUNKEN surface and
   * darkened both platforms again. Now 4.94:1 on the canvas and 4.52:1 on the
   * sunken surface. Web and mobile now hold the same value, asserted by
   * apps/web/lib/design/tokens.test.ts.
   */
  faintText: '#6b6968',
  hairline1: 'rgba(0, 0, 0, 0.08)',
  hairline2: 'rgba(0, 0, 0, 0.15)',
  /**
   * Border for interactive controls. WCAG 2.2 AA 1.4.11 requires 3:1 for the
   * visual boundary of a control; the Monad hairlines are 1.41:1 and 1.19:1,
   * which is fine for a decorative card edge but not for the only edge a text
   * field has. #767676 is 4.54:1 on both #ffffff and paper-canvas.
   */
  fieldBorder: '#767676',
  bg2: '#ede9e6',
  surface3: '#bfcaed',

  emerald: '#1a6b40',
  /** Same finding as `faintText`. Web's original #9a6800 was 4.37:1; this is
   *  4.97:1 on the canvas and 4.55:1 on the sunken surface. */
  amber: '#8e6000',
  rose: '#b53030',
  violet: '#6040a0',
  cyan: '#a0b5eb',
  teal: '#a7fccd',
} as const;

export const radii = {
  sm: 6,
  md: 10,
  lg: 14,
  xl: 20,
  // Web uses 40px pill/card radii. On a 390pt-wide phone a 40pt card radius
  // eats the content box, so mobile caps cards at 20 and keeps the pill button.
  card: 20,
  btn: 100,
  tag: 999,
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  '2xl': 32,
  '3xl': 48,
} as const;

/**
 * Minimum interactive size. WCAG 2.2 AA (2.5.8 Target Size Minimum) requires
 * 24x24 CSS px; both Apple (44pt) and Android (48dp) HIG demand more. We take
 * the strictest of the three so a control that passes here passes everywhere.
 */
export const MIN_TOUCH_TARGET = 48;

export const fonts = {
  /** Body/UI. IBM Plex Mono on web; system mono until the font is bundled. */
  mono: undefined as string | undefined,
  /** Display/headings (Noto Serif on web). */
  serif: undefined as string | undefined,
  sans: undefined as string | undefined,
} as const;

export const typography = {
  display: { fontSize: 28, lineHeight: 34, fontWeight: '700' as const },
  title: { fontSize: 22, lineHeight: 28, fontWeight: '700' as const },
  heading: { fontSize: 17, lineHeight: 24, fontWeight: '600' as const },
  body: { fontSize: 16, lineHeight: 24, fontWeight: '400' as const },
  label: { fontSize: 14, lineHeight: 20, fontWeight: '500' as const },
  caption: { fontSize: 12, lineHeight: 16, fontWeight: '400' as const },
} as const;

export const theme = {
  colors,
  radii,
  spacing,
  typography,
  minTouchTarget: MIN_TOUCH_TARGET,
} as const;

export type Theme = typeof theme;
