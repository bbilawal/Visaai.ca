import type { Metadata } from 'next'
import { Link } from '@/i18n/navigation'
import { localeAlternates } from '@/lib/seo/alternates'

/**
 * The page VisaAI-SourceMonitor's User-Agent points at.
 *
 * The agent has always advertised `+https://visaai.co/bots`, and that URL 404'd
 * — so an administrator who saw the traffic, did the one thing the User-Agent
 * invited them to do, and got nothing had every reason to treat it as another
 * anonymous scraper. This is that page.
 *
 * It exists to be READ BY A STRANGER who is deciding whether to block us, so it
 * answers their questions in their order: what is this, what does it take, how
 * do I stop it, who do I shout at. Not what VisaAI wants.
 *
 * Deliberately not localised. Its audience is a server administrator reading
 * their own logs, and the User-Agent string that leads them here is English.
 */

export const revalidate = 86400

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>
}): Promise<Metadata> {
  const { locale } = await params
  return {
    title: 'VisaAI-SourceMonitor — about this crawler',
    description:
      'What the VisaAI source monitor does, how it behaves, and how to block it. Published for the administrators of the government sites it reads.',
    alternates: localeAlternates('/bots', locale),
  }
}

const UA =
  'VisaAI-SourceMonitor/1.0 (+https://visaai.co/bots; visa requirement change monitoring)'

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <tr className="border-b border-hairline-2 last:border-0">
      <th scope="row" className="py-2 pr-6 text-left align-top font-medium whitespace-nowrap">
        {k}
      </th>
      <td className="py-2 align-top">{v}</td>
    </tr>
  )
}

export default function BotsPage() {
  return (
    <main className="mx-auto max-w-[760px] px-5 py-12 md:py-16">
      <p className="eyebrow mb-2">For site administrators</p>
      <h1 className="type-h1 mb-3">VisaAI-SourceMonitor</h1>
      <p className="lede mb-8">
        If you found this page from a User-Agent string in your logs: this is
        what that agent is, what it takes, and how to stop it.
      </p>

      <section className="mb-10">
        <h2 className="type-h3 mb-3">At a glance</h2>
        <table className="w-full text-[14px]">
          <tbody>
            <Row
              k="User-Agent"
              v={<code className="break-all text-[13px]">{UA}</code>}
            />
            <Row k="Operated by" v="VisaAI — visaai.co" />
            <Row k="Purpose" v="Detecting changes to published visa requirements" />
            <Row k="Frequency" v="Once per day, per source" />
            <Row k="Rate" v="At most one request every 2 seconds to the same host" />
            <Row k="Method" v="GET only" />
            <Row k="Contact" v={<a href="mailto:team@visaai.co" className="underline">team@visaai.co</a>} />
          </tbody>
        </table>
      </section>

      <section className="mb-10">
        <h2 className="type-h3 mb-3">What it does</h2>
        <p className="mb-3 text-[14px]">
          VisaAI helps people prepare visa applications. Everything it tells
          someone about a visa requirement is traced to the government page that
          states it, and shown with the date that page was last checked.
        </p>
        <p className="mb-3 text-[14px]">
          This agent is how that date stays true. Once a day it re-reads a small
          set of public pages — typically fewer than thirty per authority — and
          compares the extracted text against the previous copy. When wording
          around a requirement, a fee, a form or an eligibility rule changes, it
          raises the change for a person to review. Nothing shown to a user
          changes until that review happens.
        </p>
        <p className="text-[14px]">
          If it cannot read your pages, VisaAI does not guess. It links people to
          your page instead.
        </p>
      </section>

      <section className="mb-10">
        <h2 className="type-h3 mb-3">How it behaves</h2>
        <ul className="grid gap-2 text-[14px]">
          <li>
            <strong>It reads your robots.txt before every request</strong> and
            follows it (RFC 9309, longest-match). A path you disallow is never
            fetched, and the decision is re-evaluated on every run rather than
            cached — so opening access takes effect the next morning.
          </li>
          <li>
            <strong>It honours <code>Crawl-delay</code></strong>, and waits at
            least 2 seconds between requests to the same host regardless.
          </li>
          <li>
            <strong>A 403 or 429 stops it.</strong> It does not retry, does not
            back off and try again later, and does not change its User-Agent to
            get a different answer.
          </li>
          <li>
            <strong>It reads only.</strong> It submits no forms, lodges no
            applications, and follows no link that would.
          </li>
          <li>
            <strong>It sends no credentials or cookies</strong>, and never
            attempts an authenticated, account-holder or application area.
          </li>
          <li>
            <strong>It never attempts to pass a CAPTCHA or bot check.</strong>
          </li>
          <li>
            <strong>It caps what it reads</strong> — 8 MB and 30 seconds per
            request, at most 5 redirects.
          </li>
          <li>
            <strong>It does not redistribute your files</strong> unless your
            terms plainly permit it. Where they are silent, VisaAI stores only
            metadata and links people to your page.
          </li>
        </ul>
      </section>

      <section className="mb-10">
        <h2 className="type-h3 mb-3">How to block it</h2>
        <p className="mb-3 text-[14px]">
          In your <code>robots.txt</code>. It is checked before every fetch and
          honoured immediately:
        </p>
        <pre className="mb-3 overflow-x-auto rounded-lg border border-hairline-2 p-3 text-[13px]">
{`User-agent: VisaAI-SourceMonitor
Disallow: /`}
        </pre>
        <p className="text-[14px]">
          Or narrow it to particular paths in the usual way. If you would rather
          tell us directly, write to{' '}
          <a href="mailto:team@visaai.co" className="underline">team@visaai.co</a>{' '}
          and we will stop — you do not need to explain why, and we will not ask
          you to.
        </p>
      </section>

      <section className="mb-10">
        <h2 className="type-h3 mb-3">Verifying it is really us</h2>
        <p className="mb-3 text-[14px]">
          A User-Agent string is not proof of anything — anyone can send it. If
          you need to verify the traffic before allowing it, write to{' '}
          <a href="mailto:team@visaai.co" className="underline">team@visaai.co</a>{' '}
          and we will confirm the source addresses in use.
        </p>
        <p className="text-[14px] text-midtone-gray">
          A published, stable IP range is not yet available. Saying so plainly
          seems better than publishing a list we cannot commit to keeping
          accurate, and we will update this section when one exists.
        </p>
      </section>

      <section className="mb-10">
        <h2 className="type-h3 mb-3">What VisaAI is not</h2>
        <p className="text-[14px]">
          VisaAI is not a government body, is not affiliated with or endorsed by
          any immigration authority, and does not issue visas or decide
          applications. It prepares applications with the people making them;
          they submit their own.
        </p>
      </section>

      <p className="text-[13px] text-midtone-gray">
        Questions, complaints, or a request to stop:{' '}
        <a href="mailto:team@visaai.co" className="underline">team@visaai.co</a>.
        {' · '}
        <Link href="/visas" className="underline">Visa information</Link>
        {' · '}
        <Link href="/privacy" className="underline">Privacy</Link>
      </p>
    </main>
  )
}
