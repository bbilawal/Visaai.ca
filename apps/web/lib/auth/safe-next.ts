/**
 * Resolve a post-auth redirect target from an untrusted ?next= param.
 * Only same-origin, root-relative paths are allowed; everything else → '/'.
 * Blocks open-redirect vectors: protocol-relative ('//host'), backslash
 * smuggling ('/\\host', '/%5Chost'), and absolute URLs ('https://...').
 */
export function resolveSafeNext(param: string | null | undefined): string {
  if (!param) return '/'
  if (!param.startsWith('/')) return '/'
  if (
    param.startsWith('//') ||
    param.startsWith('/\\') ||
    param.startsWith('/%5C') ||
    param.startsWith('/%5c')
  ) return '/'
  return param
}
