import type { MetadataRoute } from 'next'
import { SITE_URL } from '@/lib/seo/site'

/**
 * There was no robots.txt at all. `/robots.txt` fell through to the locale
 * proxy, which 307'd it into the localised app, so a crawler asking for
 * directives received an HTML document — Lighthouse reported "robots.txt is not
 * valid" with the page's own doctype as the offending line.
 *
 * The signed-in surface is disallowed as defence in depth. Those routes already
 * redirect unauthenticated visitors to /login, so nothing here is a secret;
 * it keeps crawl budget on the pages that are actually indexable and stops
 * login-redirect chains showing up as search results.
 */
/**
 * The signed-in surface. Every crawler group repeats it, because a
 * user-agent-specific group REPLACES the `*` group rather than inheriting it.
 */
const PRIVATE_SURFACE = [
  '/admin',
  '/analytics',
  '/applications',
  '/assignments',
  '/audit',
  '/billing',
  '/broadcasts',
  '/consultant',
  '/developers',
  '/messages',
  '/my-applications',
  '/notification-ops',
  '/notification-templates',
  '/organizations',
  '/profile',
  // Admin-only registry operations (§74). It already redirects a logged-out
  // visitor to /login, so nothing here is secret — it is listed for the same
  // reason as the rest: crawl budget belongs on indexable pages, and a
  // login-redirect chain should not surface as a search result.
  '/registry',
  '/users',
  '/welcome',
  '/invite',
  '/forbidden',
]

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        // `/applications/new` is NOT an app route to a crawler: proxy.ts sends
        // every logged-out visitor from `/` straight to it (the guest funnel's
        // front door), so it is the only thing a crawler ever sees at the site
        // root. Disallowing it under the `/applications` prefix would make the
        // homepage unindexable. The longer, more specific Allow wins.
        allow: ['/', '/applications/new', '/visas', '/bots'],
        disallow: PRIVATE_SURFACE,
      },
      /*
       * AI crawlers, split deliberately.
       *
       * OpenAI documents these as separate agents with separate purposes
       * (https://developers.openai.com/api/docs/bots, read 2026-08-20):
       * OAI-SearchBot surfaces pages in ChatGPT's search features and is
       * explicitly NOT used for model training, while disallowing GPTBot is
       * the documented way to say "do not train on this".
       *
       * VisaAI wants the first and not necessarily the second: the public visa
       * pages exist to be found and cited, and citation is a search behaviour.
       * Both groups repeat the private-surface disallows, because a
       * user-agent-specific group REPLACES the wildcard group rather than
       * adding to it — omitting them here would hand these crawlers the
       * signed-in surface that `*` is denied.
       *
       * Match on the agent token, not a version: the strings are currently
       * OAI-SearchBot/1.4 and GPTBot/1.4, and a rule pinned to /1.0 silently
       * stops matching.
       */
      {
        userAgent: ['OAI-SearchBot', 'ChatGPT-User', 'PerplexityBot', 'ClaudeBot'],
        allow: ['/', '/applications/new', '/visas', '/bots'],
        disallow: PRIVATE_SURFACE,
      },
      {
        userAgent: 'GPTBot',
        allow: ['/visas'],
        disallow: PRIVATE_SURFACE,
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  }
}
