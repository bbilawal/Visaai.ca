import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createTranslator } from 'next-intl'

/**
 * Every message must be parseable ICU MessageFormat.
 *
 * The regression this catches: `adminTemplates.titlePlaceholder` read
 * "Notification title with {{variables}}…". ICU reads `{variables}` as an
 * argument, so the doubled brace is a MALFORMED_ARGUMENT — next-intl caught the
 * throw and fell back to rendering the *key path*, so an admin opening the
 * template editor saw a field whose placeholder said
 * `adminTemplates.titlePlaceholder`. It was wrong in all 15 locales at once and
 * no test failed, because nothing ever parsed the catalogue.
 *
 * Literal braces are legal — they just have to be quoted: '{{'variables'}}'.
 */
const MESSAGES_DIR = join(__dirname, '..', '..', 'messages')
const LOCALE_FILES = readdirSync(MESSAGES_DIR).filter((f) => f.endsWith('.json'))

function flatten(value: unknown, path = ''): Array<[string, string]> {
  if (typeof value === 'string') return [[path, value]]
  if (value && typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>).flatMap(([k, v]) =>
      flatten(v, path ? `${path}.${k}` : k),
    )
  }
  return []
}

describe('translation catalogues are valid ICU', () => {
  it('ships at least the locales the app advertises', () => {
    expect(LOCALE_FILES.length).toBeGreaterThanOrEqual(15)
  })

  it.each(LOCALE_FILES)('%s parses every message', (file) => {
    const locale = file.replace(/\.json$/, '')
    const catalogue = JSON.parse(readFileSync(join(MESSAGES_DIR, file), 'utf8'))
    const broken: string[] = []

    // Go through next-intl itself rather than a parallel parser, so this asserts
    // the behaviour production actually gets. INVALID_MESSAGE is the parse
    // failure that triggers the key-path fallback; missing arguments raise a
    // different code and are not what this guards.
    const t = createTranslator({
      locale,
      messages: catalogue,
      onError(error) {
        if (error.code === 'INVALID_MESSAGE') broken.push(error.message.split('\n')[0])
      },
    })
    for (const [key] of flatten(catalogue)) {
      try {
        t(key as never)
      } catch {
        // Formatting throws for messages needing arguments; onError above has
        // already recorded anything that failed to parse.
      }
    }
    expect(broken, broken.join('\n')).toEqual([])
  })
})
