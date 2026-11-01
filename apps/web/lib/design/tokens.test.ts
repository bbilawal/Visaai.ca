import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Design-token enforcement.
 *
 * The tokens live in CSS, so they cannot be imported — this parses
 * `globals.css` and asserts the properties that matter. That is deliberate:
 * a duplicated TypeScript copy of the palette would be a second source of
 * truth, and the whole point of Task 12 is that there is one.
 *
 * These tests exist because the same class of defect kept recurring: a colour
 * chosen by eye that fails contrast, and dark-mode values bolted on per page.
 */

const CSS = readFileSync(join(__dirname, '..', '..', 'app', 'globals.css'), 'utf8')

/** Read a custom property from a specific block of the stylesheet. */
function tokensIn(selector: string): Record<string, string> {
  const start = CSS.indexOf(selector)
  if (start === -1) throw new Error(`selector not found: ${selector}`)
  const open = CSS.indexOf('{', start)
  // Find the matching close brace, accounting for nesting (media queries).
  let depth = 0
  let end = open
  for (let i = open; i < CSS.length; i += 1) {
    if (CSS[i] === '{') depth += 1
    if (CSS[i] === '}') {
      depth -= 1
      if (depth === 0) {
        end = i
        break
      }
    }
  }
  const block = CSS.slice(open, end)
  const out: Record<string, string> = {}
  for (const match of block.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
    out[match[1]] = match[2].trim()
  }
  return out
}

const PRIMITIVES = tokensIn('@theme')
const LIGHT = tokensIn(':root {\n  color-scheme: light;')
const DARK = tokensIn(":root[data-theme='dark']")

/** Resolve `var(--x)` one level against the primitive palette. */
function resolve(value: string): string {
  const varMatch = /^var\((--[\w-]+)\)$/.exec(value.trim())
  if (!varMatch) return value.trim()
  const target = PRIMITIVES[varMatch[1]] ?? LIGHT[varMatch[1]]
  if (!target) throw new Error(`unresolvable token: ${value}`)
  return resolve(target)
}

function channel(value: number): number {
  const c = value / 255
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

function luminance(hex: string): number {
  const clean = hex.replace('#', '').trim()
  const full =
    clean.length === 3
      ? clean
          .split('')
          .map((c) => c + c)
          .join('')
      : clean
  const r = Number.parseInt(full.slice(0, 2), 16)
  const g = Number.parseInt(full.slice(2, 4), 16)
  const b = Number.parseInt(full.slice(4, 6), 16)
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(resolve(a)), luminance(resolve(b))].sort(
    (x, y) => y - x,
  )
  return (hi + 0.05) / (lo + 0.05)
}

describe('primitive palette', () => {
  it('defines every colour as a literal, never a reference', () => {
    for (const [name, value] of Object.entries(PRIMITIVES)) {
      if (!name.startsWith('--color-')) continue
      expect(value.startsWith('var('), `${name} should be a literal`).toBe(false)
    }
  })

  // The exact regression this catches: apps/mobile darkened these two in Task 9
  // and web did not, so the same named token meant different things per
  // platform and web shipped sub-AA text.
  it('keeps the previously sub-AA values fixed', () => {
    expect(PRIMITIVES['--color-faint-text']).toBe('#6b6968')
    expect(PRIMITIVES['--color-amber']).toBe('#8e6000')
  })

  it('agrees with the mobile token values', () => {
    const mobile = readFileSync(
      join(__dirname, '..', '..', '..', 'mobile', 'src', 'theme', 'tokens.ts'),
      'utf8',
    )
    // Both platforms must resolve the same names to the same values, or the
    // "one design system" claim is false.
    for (const [web, key] of [
      ['--color-faint-text', 'faintText'],
      ['--color-amber', 'amber'],
      ['--color-field-border', 'fieldBorder'],
      ['--color-ink', 'ink'],
      ['--color-paper-canvas', 'paperCanvas'],
      ['--color-rose', 'rose'],
      ['--color-emerald', 'emerald'],
    ] as const) {
      const match = new RegExp(`${key}: '([^']+)'`).exec(mobile)
      expect(match?.[1]?.toLowerCase(), `${key} differs from ${web}`).toBe(
        PRIMITIVES[web].toLowerCase(),
      )
    }
  })
})

/**
 * Every background a token can legitimately sit on.
 *
 * The gap this closes: the first fix for --color-faint-text was checked only
 * against --color-surface, passed at 4.66:1, and shipped — then axe found it
 * at 4.26:1 on --color-surface-sunken, which is the sidebar and card fill on
 * half the app. A contrast test that checks one background proves one thing.
 */
const LIGHT_SURFACES = [
  '--color-surface',
  '--color-surface-sunken',
  '--color-surface-raised',
] as const

const DARK_SURFACES = [
  '--color-surface',
  '--color-surface-sunken',
  '--color-surface-raised',
] as const

describe('light theme contrast (WCAG 2.2 AA)', () => {
  it.each(LIGHT_SURFACES)('body text meets 4.5:1 on %s', (surface) => {
    expect(contrast(LIGHT['--color-text'], LIGHT[surface])).toBeGreaterThanOrEqual(4.5)
  })

  it.each(LIGHT_SURFACES)('secondary text meets 4.5:1 on %s', (surface) => {
    expect(
      contrast(LIGHT['--color-text-secondary'], LIGHT[surface]),
    ).toBeGreaterThanOrEqual(4.5)
  })

  it.each(LIGHT_SURFACES)('muted text meets 4.5:1 on %s', (surface) => {
    expect(
      contrast(LIGHT['--color-text-muted'], LIGHT[surface]),
    ).toBeGreaterThanOrEqual(4.5)
  })

  it.each(LIGHT_SURFACES)('status text meets 4.5:1 on %s', (surface) => {
    for (const status of ['danger', 'success', 'warning', 'info'] as const) {
      expect(
        contrast(LIGHT[`--color-${status}-fg`], LIGHT[surface]),
      ).toBeGreaterThanOrEqual(4.5)
    }
  })
})

describe('dark theme contrast on every surface', () => {
  it.each(DARK_SURFACES)('body text meets 4.5:1 on %s', (surface) => {
    expect(contrast(DARK['--color-text'], DARK[surface])).toBeGreaterThanOrEqual(4.5)
  })

  it.each(DARK_SURFACES)('secondary text meets 4.5:1 on %s', (surface) => {
    expect(
      contrast(DARK['--color-text-secondary'], DARK[surface]),
    ).toBeGreaterThanOrEqual(4.5)
  })

  it.each(DARK_SURFACES)('muted text meets 4.5:1 on %s', (surface) => {
    expect(
      contrast(DARK['--color-text-muted'], DARK[surface]),
    ).toBeGreaterThanOrEqual(4.5)
  })

  it.each(DARK_SURFACES)('status text meets 4.5:1 on %s', (surface) => {
    for (const status of ['danger', 'success', 'warning', 'info'] as const) {
      expect(
        contrast(DARK[`--color-${status}-fg`], DARK[surface]),
      ).toBeGreaterThanOrEqual(4.5)
    }
  })
})

describe('light theme contrast — pairings', () => {
  it('body text meets 4.5:1 on the surface', () => {
    expect(contrast(LIGHT['--color-text'], LIGHT['--color-surface'])).toBeGreaterThanOrEqual(4.5)
  })

  it('secondary and muted text meet 4.5:1', () => {
    expect(
      contrast(LIGHT['--color-text-secondary'], LIGHT['--color-surface']),
    ).toBeGreaterThanOrEqual(4.5)
    expect(
      contrast(LIGHT['--color-text-muted'], LIGHT['--color-surface']),
    ).toBeGreaterThanOrEqual(4.5)
  })

  it('action text meets 4.5:1 on its own fill', () => {
    expect(
      contrast(LIGHT['--color-action-text'], LIGHT['--color-action']),
    ).toBeGreaterThanOrEqual(4.5)
  })

  it.each(['danger', 'success', 'warning', 'info'])(
    '%s text meets 4.5:1 on its own tint',
    (status) => {
      expect(
        contrast(LIGHT[`--color-${status}-fg`], LIGHT[`--color-${status}-bg`]),
      ).toBeGreaterThanOrEqual(4.5)
    },
  )

  it.each(['danger', 'success', 'warning', 'info'])(
    '%s text meets 4.5:1 on the plain surface too',
    (status) => {
      expect(
        contrast(LIGHT[`--color-${status}-fg`], LIGHT['--color-surface']),
      ).toBeGreaterThanOrEqual(4.5)
    },
  )

  // 1.4.11: a control's visual boundary needs 3:1. The decorative hairlines do
  // not qualify, which is why --color-border-strong exists.
  it('the control border meets 3:1', () => {
    expect(
      contrast(LIGHT['--color-border-strong'], LIGHT['--color-surface']),
    ).toBeGreaterThanOrEqual(3)
    expect(
      contrast(LIGHT['--color-border-strong'], LIGHT['--color-surface-raised']),
    ).toBeGreaterThanOrEqual(3)
  })

  it('the focus ring meets 3:1 against the surface', () => {
    expect(
      contrast(LIGHT['--color-focus-ring'], LIGHT['--color-surface']),
    ).toBeGreaterThanOrEqual(3)
  })

  // Disabled controls are exempt from 1.4.3, but text nobody can read is a bug
  // whatever the standard says. 3:1 is the compromise.
  it('disabled text stays legible at 3:1', () => {
    expect(
      contrast(LIGHT['--color-disabled-text'], LIGHT['--color-disabled-bg']),
    ).toBeGreaterThanOrEqual(3)
  })
})

describe('dark theme contrast (WCAG 2.2 AA)', () => {
  it('body text meets 4.5:1 on the surface', () => {
    expect(contrast(DARK['--color-text'], DARK['--color-surface'])).toBeGreaterThanOrEqual(4.5)
  })

  it('secondary and muted text meet 4.5:1', () => {
    expect(
      contrast(DARK['--color-text-secondary'], DARK['--color-surface']),
    ).toBeGreaterThanOrEqual(4.5)
    expect(
      contrast(DARK['--color-text-muted'], DARK['--color-surface']),
    ).toBeGreaterThanOrEqual(4.5)
  })

  it('text stays legible on the raised surface', () => {
    expect(
      contrast(DARK['--color-text'], DARK['--color-surface-raised']),
    ).toBeGreaterThanOrEqual(4.5)
  })

  it('action text meets 4.5:1 on its own fill', () => {
    expect(
      contrast(DARK['--color-action-text'], DARK['--color-action']),
    ).toBeGreaterThanOrEqual(4.5)
  })

  // The reason status hues are re-picked for dark rather than reused: the
  // light values score ~2:1 against a near-black surface.
  it.each(['danger', 'success', 'warning', 'info'])(
    '%s text meets 4.5:1 on its own tint',
    (status) => {
      expect(
        contrast(DARK[`--color-${status}-fg`], DARK[`--color-${status}-bg`]),
      ).toBeGreaterThanOrEqual(4.5)
    },
  )

  it.each(['danger', 'success', 'warning', 'info'])(
    '%s text meets 4.5:1 on the plain surface too',
    (status) => {
      expect(
        contrast(DARK[`--color-${status}-fg`], DARK['--color-surface']),
      ).toBeGreaterThanOrEqual(4.5)
    },
  )

  it('the control border meets 3:1', () => {
    expect(
      contrast(DARK['--color-border-strong'], DARK['--color-surface']),
    ).toBeGreaterThanOrEqual(3)
  })

  it('the focus ring meets 3:1', () => {
    expect(
      contrast(DARK['--color-focus-ring'], DARK['--color-surface']),
    ).toBeGreaterThanOrEqual(3)
  })

  it('disabled text stays legible at 3:1', () => {
    expect(
      contrast(DARK['--color-disabled-text'], DARK['--color-disabled-bg']),
    ).toBeGreaterThanOrEqual(3)
  })
})

describe('theme parity', () => {
  // A token defined in one theme and not the other renders as the light value
  // on a dark surface — invisible text, and only on one page.
  it('defines every semantic token in both themes', () => {
    const semantic = Object.keys(LIGHT).filter((n) => n.startsWith('--color-'))
    for (const name of semantic) {
      expect(DARK[name], `${name} missing from the dark theme`).toBeTruthy()
    }
  })

  it('gives every semantic colour a different value in dark mode', () => {
    const unchanged = Object.keys(LIGHT)
      .filter((n) => n.startsWith('--color-'))
      .filter((n) => resolve(LIGHT[n]) === resolve(DARK[n]))
    // Any token identical across themes was almost certainly copied without
    // being considered.
    expect(unchanged).toEqual([])
  })

  /**
   * Tailwind emits a utility per palette colour (`text-rich-black`), which
   * reads the palette variable directly and so never sees the semantic layer.
   * axe caught `#242424` on `#16151a` — 1.16:1 — because of exactly this. The
   * dark theme must therefore override the palette names too.
   */
  it('overrides every palette colour that has a Tailwind utility', () => {
    const paletteWithUtilities = [
      '--color-ink',
      '--color-deep-black',
      '--color-rich-black',
      '--color-off-black',
      '--color-pale-stone',
      '--color-midtone-gray',
      '--color-faint-text',
      '--color-paper-canvas',
      '--color-canvas-white',
      '--color-bg-2',
      '--color-ghost-gray',
      '--color-subtle-ash',
      '--color-hairline-1',
      '--color-hairline-2',
      '--color-field-border',
      '--color-atmosphere-wash',
      '--color-rose',
      '--color-callout-red',
      '--color-emerald',
      '--color-success-green',
      '--color-amber',
    ]
    const missing = paletteWithUtilities.filter((name) => !DARK[name])
    expect(missing).toEqual([])
  })

  it('keeps text legible where a palette utility is used on a dark surface', () => {
    for (const name of [
      '--color-ink',
      '--color-rich-black',
      '--color-deep-black',
      '--color-pale-stone',
      '--color-midtone-gray',
      '--color-faint-text',
    ]) {
      expect(
        contrast(DARK[name], DARK['--color-surface']),
        `${name} is unreadable on the dark surface`,
      ).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('applies the same overrides to the media query and the explicit choice', () => {
    const mediaBlock = tokensIn(":root:not([data-theme='light'])")
    for (const [name, value] of Object.entries(DARK)) {
      expect(mediaBlock[name], `${name} differs between the two dark blocks`).toBe(
        value,
      )
    }
  })

  it('lets an explicit choice override the OS preference in both directions', () => {
    expect(CSS).toContain(":root:not([data-theme='light'])")
    expect(CSS).toContain(":root[data-theme='dark']")
  })
})

describe('scale tokens', () => {
  it('defines the type scale', () => {
    for (const name of [
      '--text-micro',
      '--text-caption',
      '--text-body',
      '--text-body-lg',
      '--text-subhead',
      '--text-title',
      '--text-display',
    ]) {
      expect(PRIMITIVES[name], `${name} missing`).toBeTruthy()
    }
  })

  it('keeps the type scale monotonically increasing', () => {
    const sizes = [
      '--text-micro',
      '--text-caption',
      '--text-body',
      '--text-body-lg',
      '--text-subhead',
      '--text-title',
      '--text-display',
    ].map((n) => Number.parseInt(PRIMITIVES[n], 10))
    for (let i = 1; i < sizes.length; i += 1) {
      expect(sizes[i]).toBeGreaterThan(sizes[i - 1])
    }
  })

  it('defines motion and z-index scales', () => {
    expect(PRIMITIVES['--motion-base']).toBeTruthy()
    expect(PRIMITIVES['--ease-out-expo']).toBeTruthy()
    expect(PRIMITIVES['--z-modal']).toBeTruthy()
    // A toast must sit above a modal or it is invisible exactly when it matters.
    expect(Number(PRIMITIVES['--z-toast'])).toBeGreaterThan(
      Number(PRIMITIVES['--z-modal']),
    )
  })
})

describe('high contrast', () => {
  it('handles forced-colors mode', () => {
    expect(CSS).toContain('@media (forced-colors: active)')
  })
})

describe('reduced motion', () => {
  it('disables animation when the user asks', () => {
    expect(CSS).toContain('@media (prefers-reduced-motion: reduce)')
  })
})

/**
 * Phase 6 additions. The tests above prove the *tokens* are accessible; these
 * prove the app actually uses them. Every defect below shipped while the token
 * tests were green, because a component that hardcodes a colour never consults
 * a token at all.
 */
describe('status tints pair with their own background', () => {
  // The alert components sit on `--color-<status>-bg`, not on the three
  // surfaces the suite already checks — so `.alert-error` measured 2.16:1 in
  // dark mode with every existing contrast test passing.
  it.each(['danger', 'success', 'warning', 'info'] as const)(
    '%s text meets 4.5:1 on its own tint in both themes',
    (status) => {
      expect(
        contrast(LIGHT[`--color-${status}-fg`], LIGHT[`--color-${status}-bg`]),
      ).toBeGreaterThanOrEqual(4.5)
      expect(
        contrast(DARK[`--color-${status}-fg`], DARK[`--color-${status}-bg`]),
      ).toBeGreaterThanOrEqual(4.5)
    },
  )

  it('builds the alert modifiers from tokens rather than literal hex', () => {
    for (const status of ['error', 'success', 'warning'] as const) {
      const rule = new RegExp(`\\.alert-${status}\\s*\\{([^}]*)\\}`).exec(CSS)?.[1] ?? ''
      expect(rule, `.alert-${status} not found`).not.toBe('')
      // `border-color` keeps a literal rgba() tint, which is theme-neutral.
      // `background` and `color` are what the reader actually needs.
      const declaration = (prop: string) =>
        new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]+)`).exec(rule)?.[1]?.trim() ?? ''
      expect(declaration('background'), `.alert-${status} background`).toContain('var(--color-')
      expect(declaration('color'), `.alert-${status} color`).toContain('var(--color-')
    }
  })
})

describe('components do not hardcode a foreground over a token background', () => {
  /**
   * The regression: several admin screens styled a primary/destructive button
   * inline as `background: var(--color-ink)` with `color: '#fff'`. In dark mode
   * `--color-ink` resolves to #ece9e6, so the label rendered white-on-cream at
   * 1.2:1 — an invisible Send/Save button. The paired token is
   * `--color-surface`, which is what `.btn-primary` and `.btn-danger` use.
   */
  it('has no literal white/black text beside a var() background in tsx', () => {
    const roots = ['app', 'components']
    const offenders: string[] = []
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name)
        if (entry.isDirectory()) walk(full)
        else if (entry.name.endsWith('.tsx') && !entry.name.includes('.test.')) {
          const src = readFileSync(full, 'utf8')
          // Look at each style object / JSX style block that sets a token
          // background, and flag a literal foreground within the same block.
          for (const block of src.matchAll(/\{[^{}]*background[^{}]*\}/g)) {
            const text = block[0]
            if (!/background:\s*'var\(--color-/.test(text)) continue
            if (/color:\s*(?:[^,}]*\?\s*)?'#(?:fff|ffffff|000|000000)'/i.test(text)) {
              offenders.push(`${full}: ${text.replace(/\s+/g, ' ').slice(0, 90)}`)
            }
          }
        }
      }
    }
    roots.forEach(walk)
    expect(offenders, offenders.join('\n')).toEqual([])
  })
})
