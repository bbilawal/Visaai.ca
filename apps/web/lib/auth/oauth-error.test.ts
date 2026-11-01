import { describe, it, expect } from 'vitest'
import {
  parseOAuthError,
  sanitizeOAuthDescription,
  OAUTH_ERROR_PARAM,
  OAUTH_ERROR_DETAIL_PARAM,
} from './oauth-error'

describe('parseOAuthError', () => {
  it('returns null for empty input', () => {
    expect(parseOAuthError(null)).toBeNull()
    expect(parseOAuthError(undefined)).toBeNull()
    expect(parseOAuthError('')).toBeNull()
    expect(parseOAuthError('#')).toBeNull()
    expect(parseOAuthError('?')).toBeNull()
  })

  it('returns null when no error is present', () => {
    expect(parseOAuthError('?code=abc123&next=/billing')).toBeNull()
    expect(parseOAuthError('#access_token=xyz&token_type=bearer')).toBeNull()
  })

  // The live failure this was written for: GoTrue redirects the browser with the
  // reason in the URL *fragment*, and percent-encodes the description twice.
  it('parses the real GoTrue fragment, decoding the double-encoded description', () => {
    const hash =
      '#error=server_error&error_code=unexpected_failure' +
      '&error_description=Unable+to+exchange+external+code%253A+4%252F0A&sb='
    expect(parseOAuthError(hash)).toEqual({
      code: 'unexpected_failure',
      description: 'Unable to exchange external code: 4/0A',
    })
  })

  it('accepts a query string, with or without a leading delimiter', () => {
    const expected = { code: 'access_denied', description: 'User cancelled' }
    expect(parseOAuthError('?error=access_denied&error_description=User+cancelled')).toEqual(expected)
    expect(parseOAuthError('error=access_denied&error_description=User+cancelled')).toEqual(expected)
    expect(parseOAuthError('#error=access_denied&error_description=User+cancelled')).toEqual(expected)
  })

  it('accepts URLSearchParams', () => {
    const params = new URLSearchParams({ error: 'access_denied' })
    expect(parseOAuthError(params)).toEqual({ code: 'access_denied', description: null })
  })

  it('prefers error_code over error, and falls back to error', () => {
    expect(parseOAuthError('?error=server_error&error_code=provider_disabled')?.code).toBe(
      'provider_disabled',
    )
    expect(parseOAuthError('?error=server_error')?.code).toBe('server_error')
  })

  it('reports a missing description as null rather than an empty string', () => {
    expect(parseOAuthError('?error=access_denied&error_description=')?.description).toBeNull()
  })

  it('leaves a malformed percent escape alone instead of throwing', () => {
    expect(parseOAuthError('?error=server_error&error_description=100%25+broken')).toEqual({
      code: 'server_error',
      description: '100% broken',
    })
  })
})

describe('sanitizeOAuthDescription', () => {
  it('passes through ordinary provider prose', () => {
    expect(sanitizeOAuthDescription('Unable to exchange external code: 4/0A')).toBe(
      'Unable to exchange external code: 4/0A',
    )
  })

  it('drops markup and control characters', () => {
    // The description is attacker-controllable via the URL. React escapes it as
    // text, so this is about not rendering convincing injected instructions.
    expect(sanitizeOAuthDescription('<b>Call 555-0100</b>')).toBe('bCall 555-0100/b')
    expect(sanitizeOAuthDescription('line one\nline two')).toBe('line one line two')
  })

  it('caps length', () => {
    expect(sanitizeOAuthDescription('x'.repeat(400))).toHaveLength(200)
  })

  it('returns null for empty or whitespace-only input', () => {
    expect(sanitizeOAuthDescription(null)).toBeNull()
    expect(sanitizeOAuthDescription('')).toBeNull()
    expect(sanitizeOAuthDescription('   ')).toBeNull()
    expect(sanitizeOAuthDescription('<<>>')).toBeNull()
  })
})

describe('param names', () => {
  it('are stable, since /callback writes them and the login page reads them', () => {
    expect(OAUTH_ERROR_PARAM).toBe('authError')
    expect(OAUTH_ERROR_DETAIL_PARAM).toBe('authErrorDetail')
  })
})
