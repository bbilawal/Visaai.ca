import type { Metadata } from 'next'
import { jsonLd, organizationSchema, webApplicationSchema } from '@/lib/seo/structured-data'
import { IBM_Plex_Mono, Noto_Serif, Inter } from 'next/font/google'
import { notFound } from 'next/navigation'
import { hasLocale, NextIntlClientProvider } from 'next-intl'
import { setRequestLocale, getMessages } from 'next-intl/server'
import { ToastProvider } from '@/components/providers/toast-provider'
import {
  ThemeProvider,
  THEME_INIT_SCRIPT,
} from '@/components/providers/theme-provider'
import { AnalyticsProvider } from '@/components/providers/analytics-provider'
import { OAuthErrorListener } from '@/components/auth/oauth-error-listener'
import { FeatureFlagsProvider } from '@/components/providers/feature-flags-provider'
import { BetaBanner } from '@/components/beta/beta-banner'
import { FeedbackWidget } from '@/components/beta/feedback-widget'
import { routing } from '@/i18n/routing'
import { LOCALES, dirFor, type Locale } from '@/i18n/config'
import { SITE_BRAND, SITE_CONFIG } from '@/lib/site-config'
import '../globals.css'

const plexMono = IBM_Plex_Mono({ subsets: ['latin'], weight: ['400', '500'], variable: '--font-plex-mono', display: 'swap' })
const notoSerif = Noto_Serif({ subsets: ['latin'], weight: ['400'], variable: '--font-noto-serif', display: 'swap' })
const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' })

// Pre-render every locale at build time.
export function generateStaticParams() {
  return LOCALES.map((locale) => ({ locale }))
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>
}): Promise<Metadata> {
  await params
  return {
    // Without this, Next emits `rel=canonical` and `hreflang` as root-relative
    // URLs; both are only valid absolute, so Lighthouse scored the hreflang set
    // invalid on every public route.
    metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'),
    title: SITE_CONFIG.mode === 'canada'
      ? 'VisaAI Canada — Canada visa application preparation'
      : 'VisaAI — AI-Powered Immigration Copilot',
    description: SITE_CONFIG.mode === 'canada'
      ? 'Prepare a Canada visa application with structured, applicant-controlled guidance.'
      : 'Prepare stronger visa applications with AI-powered guidance.',
    // app/icon.png and app/apple-icon.png are picked up by the file convention,
    // but the 32px mark is declared explicitly so browsers that ignore the
    // large PNG still get a crisp tab icon.
    //
    // The 512px mark (205 KB) was ALSO declared here, as a favicon. A browser
    // that picks the largest declared icon downloads a fifth of a megabyte to
    // draw a 16-pixel tab, on every page. It is replaced by the 192px mark
    // (43 KB), which covers the same high-DPI and pinned-tab cases at a fifth
    // of the weight.
    //
    // The 512px file is still referenced as the schema.org Organization logo
    // in lib/seo/structured-data.ts, which is the right place for it: a crawler
    // fetches that once, not on every page view.
    icons: {
      icon: [
        { url: '/brand/mark-v3-32.png', sizes: '32x32', type: 'image/png' },
        { url: '/brand/mark-v3-192.png', sizes: '192x192', type: 'image/png' },
      ],
      apple: [{ url: '/brand/mark-v3-180.png', sizes: '180x180', type: 'image/png' }],
    },
    openGraph: {
      type: 'website',
      siteName: SITE_CONFIG.mode === 'canada' ? 'VisaAI Canada' : 'VisaAI',
      title: SITE_CONFIG.mode === 'canada'
        ? 'VisaAI Canada — Canada visa application preparation'
        : 'VisaAI — AI-Powered Immigration Copilot',
      description: SITE_CONFIG.mode === 'canada'
        ? 'Prepare a Canada visa application with structured, applicant-controlled guidance.'
        : 'Prepare stronger visa applications with AI-powered guidance.',
      images: [{ url: '/brand/og-v3.png', width: 1200, height: 630, alt: SITE_BRAND }],
    },
    twitter: {
      card: 'summary_large_image',
      title: SITE_CONFIG.mode === 'canada'
        ? 'VisaAI Canada — Canada visa application preparation'
        : 'VisaAI — AI-Powered Immigration Copilot',
      description: SITE_CONFIG.mode === 'canada'
        ? 'Prepare a Canada visa application with structured, applicant-controlled guidance.'
        : 'Prepare stronger visa applications with AI-powered guidance.',
      images: ['/brand/og-v3.png'],
    },
    // NO `alternates` here on purpose. Metadata merges field-by-field, so a
    // canonical set at the layout is inherited by every page that does not
    // override it — which is how all public routes came to declare themselves
    // copies of `/`. Each route declares its own via `localeAlternates()`.
  }
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  if (!hasLocale(routing.locales, locale)) notFound()
  // Enable static rendering for this request's locale.
  setRequestLocale(locale)
  const messages = await getMessages()

  return (
    <html
      lang={locale}
      dir={dirFor(locale as Locale)}
      className={`${plexMono.variable} ${notoSerif.variable} ${inter.variable}`}
      /*
       * THEME_INIT_SCRIPT below sets `data-theme` on this element before React
       * hydrates — that is the whole point of it, so the first paint is not the
       * wrong colour. React then hydrates <html>, finds an attribute the server
       * never rendered, and treats the tree as mismatched:
       *
       *   Minified React error #418; args[]=HTML
       *
       * Seen live on 2026-09-04, repeatedly, on the intake page. It is not
       * fatal — React recovers by re-rendering on the client — but it throws
       * away the server-rendered tree and re-renders the whole page, which is
       * exactly the cost SSR was paying for.
       *
       * Scoped to this element: it suppresses the warning for <html>'s own
       * attributes, not for the app inside it.
       */
      suppressHydrationWarning
    >
      <head>
        {/*
          JSON-LD for search and AI answer engines. Emitted in <head> on every
          locale. Only verifiable claims — no ratings, reviews or prices; see
          lib/seo/structured-data.ts.
        */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: jsonLd(organizationSchema()) }}
        />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: jsonLd(webApplicationSchema()) }}
        />
        {/*
          Applies the stored theme before first paint. Must be inline and
          blocking: anything async paints light first, then flips — a white
          flash into a dark room. Content is a build-time constant, never user
          input.
        */}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body>
        <NextIntlClientProvider locale={locale} messages={messages}>
          <ThemeProvider>
            <ToastProvider>
              <AnalyticsProvider />
              {/*
                Renders nothing unless the URL fragment carries an OAuth
                failure, in which case it routes to /login with the reason.
              */}
              <OAuthErrorListener />
              {/*
                Wraps children so any client component can call useFlag(). It
                starts from the registry defaults, so the first paint is already
                correct for everything not being rolled out — see the provider.
              */}
              <FeatureFlagsProvider>
                {/*
                  Both render null unless their flag is on, so this costs
                  nothing outside the beta. The banner sits before main content
                  so it lands early in reading order; the widget is fixed-
                  position and last, so it is not in the way of the page's own
                  tab order.
                */}
                <BetaBanner />
                {children}
                <FeedbackWidget />
              </FeatureFlagsProvider>
            </ToastProvider>
          </ThemeProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  )
}
