'use client'

import { useTranslations } from 'next-intl'
import { useTheme, type ThemePreference } from '@/components/providers/theme-provider'

const OPTIONS: { value: ThemePreference; labelKey: string; glyph: string }[] = [
  { value: 'light', labelKey: 'themeLight', glyph: '☀' },
  { value: 'dark', labelKey: 'themeDark', glyph: '☾' },
  { value: 'system', labelKey: 'themeSystem', glyph: '⌘' },
]

/**
 * Theme switcher.
 *
 * A radiogroup rather than a single toggle button, because there are three
 * states and "follow my system" is not reachable by cycling a binary. Native
 * radio semantics also give arrow-key navigation for free.
 *
 * Each option carries a text label alongside its glyph. A sun and a moon are
 * not self-evident to everyone, and the glyphs are marked decorative so a
 * screen reader announces the label rather than "sun with rays".
 */
export function ThemeToggle() {
  const t = useTranslations('nav')
  const { preference, setPreference } = useTheme()

  return (
    <fieldset className="border-0 p-0 m-0">
      <legend className="sr-only">{t('theme')}</legend>
      <div
        role="radiogroup"
        aria-label={t('theme')}
        className="inline-flex rounded-full border border-[var(--color-border)] p-0.5"
      >
        {OPTIONS.map((option) => {
          const selected = preference === option.value
          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => setPreference(option.value)}
              title={t(option.labelKey)}
              // Not colour alone: the selected option is filled AND its
              // aria-checked state is exposed, so the choice is legible
              // without seeing the contrast difference.
              // min-w-[32px]: WCAG 2.2 §2.5.8 wants 24×24 CSS px minimum; the
              // glyph-only form would otherwise be narrower than that.
              className={`flex min-h-[32px] min-w-[32px] items-center justify-center gap-1.5 rounded-full px-2 text-[var(--text-caption)] transition-colors md:px-3 ${
                selected
                  ? 'bg-[var(--color-action)] text-[var(--color-action-text)]'
                  : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-sunken)]'
              }`}
            >
              <span aria-hidden="true">{option.glyph}</span>
              {/*
                Glyph-only below md: three labelled options added 141px to the
                mobile top bar and pushed the page into horizontal scroll. The
                label stays in the DOM as `sr-only`, so the accessible name is
                unchanged — a screen reader still announces "Light, radio,
                selected", and `title` gives sighted users the same text on
                hover or long-press.
              */}
              <span className="sr-only md:not-sr-only">{t(option.labelKey)}</span>
            </button>
          )
        })}
      </div>
    </fieldset>
  )
}
