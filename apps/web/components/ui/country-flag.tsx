'use client'

import { useState } from 'react'
import { cn } from '@/lib/utils'

/**
 * <CountryFlag> — a tiny, dependency-free country flag.
 *
 * Renders a plain <img> pointing at /flags/4x3/<code>.svg (served from /public,
 * NOT bundled). The `flag-icons` package is a devDependency used ONLY as the
 * source of those SVGs (see scripts/sync-flags.mjs); nothing from it is imported
 * at runtime. Because the <img> is lazy, a visitor only downloads the handful of
 * flags actually on screen, then they're HTTP-cached.
 *
 * Sentinel: the bloc code 'SCHENGEN' is not a country — it maps to the EU flag.
 *
 * Robustness: an unknown/empty code, or a missing SVG file, never shows a broken
 * image. `onError` hides the <img> (display:none) and we fall back to a neutral,
 * same-sized placeholder span so layout never shifts. The component never throws.
 *
 * ── Accessibility rule (decorative vs. meaningful) ───────────────────────────
 * The flag is DECORATIVE when the country name/code is ALSO rendered as visible
 * text right next to it (the common case) — duplicating it for a screen reader
 * is noise, so we emit alt="" + aria-hidden. The flag is MEANINGFUL only when it
 * stands ALONE with no adjacent text label; then it carries the country name (or
 * code) as its accessible name. Call sites choose via the `decorative` prop,
 * which DEFAULTS TO true because nearly every site pairs the flag with text.
 */

const SIZES = {
  sm: { width: 16, height: 12 },
  md: { width: 20, height: 15 },
} as const

export interface CountryFlagProps {
  /** ISO-3166 alpha-2 code (e.g. 'DE'), or the 'SCHENGEN' bloc sentinel. */
  code: string
  /** Country name — used for the accessible name when the flag stands alone. */
  name?: string
  /** Visual size. 4:3 aspect both ways. Defaults to 'sm'. */
  size?: 'sm' | 'md'
  className?: string
  /** Native title tooltip (optional). */
  title?: string
  /**
   * true (default) → decorative (alt="" + aria-hidden): the name/code is visible
   * adjacent text. false → the flag stands alone and carries the country name.
   */
  decorative?: boolean
}

/** lowercase; map the 'schengen' bloc sentinel to the EU flag. */
function normalize(code: string): string {
  const c = code.trim().toLowerCase()
  return c === 'schengen' ? 'eu' : c
}

export function CountryFlag({
  code,
  name,
  size = 'sm',
  className,
  title,
  decorative = true,
}: CountryFlagProps) {
  const [failed, setFailed] = useState(false)
  const normalized = code ? normalize(code) : ''
  const { width, height } = SIZES[size]

  // Empty/unknown code, or a load failure → neutral placeholder, same footprint
  // (width/height set) so nothing reflows. Never a broken-image icon.
  if (!normalized || failed) {
    return (
      <span
        aria-hidden="true"
        className={cn('country-flag country-flag--empty', className)}
        style={{ width, height }}
      />
    )
  }

  // Decorative (the common case): empty alt + aria-hidden so a screen reader
  // doesn't announce the flag on top of the adjacent visible country name.
  // Standalone: the flag carries the country name (or code) as its name.
  const alt = decorative ? '' : name ? `${name} flag` : `${code} flag`

  return (
    // Intentional plain <img>, NOT next/image: a tiny static SVG from /public,
    // served verbatim and lazy + HTTP-cached — the optimizer adds no value and
    // would needlessly route it through the image pipeline.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`/flags/4x3/${normalized}.svg`}
      alt={alt}
      aria-hidden={decorative || undefined}
      width={width}
      height={height}
      loading="lazy"
      decoding="async"
      draggable={false}
      title={title}
      className={cn('country-flag', className)}
      onError={() => setFailed(true)}
    />
  )
}
