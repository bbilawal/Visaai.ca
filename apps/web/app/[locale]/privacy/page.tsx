import type { Metadata } from 'next'
import { Link } from '@/i18n/navigation'
import { localeAlternates } from '@/lib/seo/alternates'
import { SITE_BRAND } from '@/lib/site-config'

// generateMetadata, not a static `metadata` object: canonical is per-locale
// now, and only the route receives the locale it is rendering.
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>
}): Promise<Metadata> {
  const { locale } = await params
  return {
    title: `Privacy Policy — ${SITE_BRAND}`,
    description: 'How VisaAI collects, uses, stores, and protects your personal information.',
    alternates: localeAlternates('/privacy', locale),
  }
}

// TEMPLATE. Strategy Action 10. Must be reviewed and finalized by counsel
// (Action 9) before launch. Reflects the product as built: identity/financial
// document handling, Supabase storage, PIPEDA/GDPR rights.
export default function PrivacyPage() {
  return (
    <main className="mx-auto max-w-[760px] px-5 py-12 md:py-16">
      <p className="eyebrow mb-2">Legal</p>
      <h1 className="type-h1 mb-2">Privacy Policy</h1>
      <p className="text-[13px] text-midtone-gray mb-8">
        Template pending legal review. Last updated: 2026-06-04.
      </p>

      <section className="flex flex-col gap-6 text-[14px] leading-relaxed text-rich-black">
        <div>
          <h2 className="type-h3 mb-2">What we collect</h2>
          <p className="text-midtone-gray">
            Account details (name, email), the information you provide during intake, and the
            documents you upload (which may include identity and financial documents such as
            passports and bank statements). We also collect basic usage analytics that do not
            contain your document contents.
          </p>
        </div>
        <div>
          <h2 className="type-h3 mb-2">How we use it</h2>
          <p className="text-midtone-gray">
            To help you prepare your visa application: structuring your information, verifying
            documents, and generating a readiness assessment and supporting drafts. We do not sell
            your personal information. We do not use your documents to make decisions about you.
          </p>
        </div>
        <div>
          <h2 className="type-h3 mb-2">Where it is stored</h2>
          <p className="text-midtone-gray">
            Your data is stored with our infrastructure providers (including Supabase) under
            access controls and encryption. Where required, data for users in a given region is
            kept within that region. Documents are processed only to provide the service.
          </p>
        </div>
        <div>
          {/* PRIV-001: this section previously ended "Backups are purged on a
              rolling schedule." That was not true — the production project was
              measured with pitr_enabled=false and backups=[] (BLK-1), so there
              were no backups to purge. The sentence was removed rather than
              reworded: stating nothing beats stating something false, and
              adding a NEW commitment about backups is counsel's call, not an
              engineering one. The export/deletion sentence now points at the
              profile page, where PrivacySection actually implements it. */}
          <h2 className="type-h3 mb-2">Retention and deletion</h2>
          <p className="text-midtone-gray">
            You can export or delete your data at any time from your profile page. We honor
            data-subject rights under PIPEDA (Canada) and the GDPR (EU/UK), including access,
            correction, and erasure, subject to limited legal retention exceptions.
          </p>
        </div>
        <div>
          {/* The Chrome Web Store review reads THIS page to decide whether the
              extension's data handling is disclosed, so the claims below are
              written from the code rather than from intent:

              - readback.ts reads field values and normalizes them; it never
                assigns (`// READ ONLY — never assigns`).
              - readback-engine.ts hashes and compares in the page. No portal
                value is put on the wire.
              - preflight-panel.ts, which this comment used to cite as the
                ONLY outbound call, was removed (REVIEW_HANDOFF item 54). The
                authorizing POST /execution/request is now made by the web app,
                and the extension talks to the API over the side panel's
                socket: the approval (portal-fill:start), selector presence
                booleans (portal-fill:probe), and per field an outcome, reason
                and hash of the read-back value (PortalFillFieldResult). Still
                no page contents — but the visible paragraph below ("the only
                thing it sends us is a request to authorize the fill") no
                longer described that exactly.

              2026-09-27 (extension 0.1.5 — 0.1.4 plus: the probe applies the
              writer's visibility rule, and a field result carries a value hash
              only on a match, i.e. the expected hash the server already holds;
              content.ts): the paragraphs below were rewritten
              to match that code — what is stored locally and for how long
              (PENDING_SESSION_TTL_MS, PENDING_PURGE_ALARM), the connect token
              and the memory-only resume token (sidepanel.ts, item 60), the
              approval gate (startRequested), and exactly what goes over the
              socket. They are NOT counsel-reviewed; the visible note under the
              heading says so. Remove the note only after owner/legal sign-off
              (REVIEW_HANDOFF §34.13).

              DEPLOY ORDER: the 5-minute purge and the resume token exist only
              in 0.1.4+ and the matching automation.gateway.ts. The served zip
              was 0.1.2 when this was written — it skips a stale hand-off but
              never deletes it, and has no resume token. Ship 0.1.5 (zip + API)
              no later than this text, or the purge sentence is false.

              2026-10-15 (extension 0.1.6): the side panel binds the one IRCC
              tab in its window instead of requiring it to be the active tab
              (portal-tab.ts). It reads tab URLs only where it already has host
              permission; nothing new is stored or sent.

              2026-10-15 (extension 0.1.7): the fill covers the whole IRCC
              visitor application, one page per launch. It now clicks — only
              radio answers, check boxes and a table's own Add / dialog Save
              buttons (executor/control-actuator.ts; never "Save and continue"
              or any page-leaving control, safety-guards.ts) — and the probe
              reply carries the open page's URL path (no query string) so the
              server fills only that page (background.ts boundTabPath).

              If any of those change, this paragraph is wrong and must change
              with them. */}
          <h2 className="type-h3 mb-2">The VisaAI Portal Assistant (Chrome extension)</h2>
          <p className="text-[13px] text-midtone-gray mb-2">
            This section was updated on 2026-10-15 to describe version 0.1.7 of the extension. It
            is pending owner and legal review.
          </p>
          <p className="text-midtone-gray">
            The optional browser extension works only on Canada&rsquo;s IRCC online portal
            (canada.ca and cic.gc.ca pages); no other government portal is supported. It enters
            nothing until you have approved the answers for your application in VisaAI and started
            the fill from your application&rsquo;s submission page, and it ignores any fill that
            was not started with that approval. It then checks the portal page open in the tab you
            are using: if any expected field is missing, nothing is entered. Only when every
            expected field is present does it enter your approved answers, and it reads each field
            back to check that what was written matches what you approved.
          </p>
          <p className="text-midtone-gray mt-3">
            The contents of the portal page are not sent to VisaAI. The extension sends data to
            VisaAI only over its connection to our servers, and sends: the one-time approval you
            gave; a single-use session token that connects it to your VisaAI session, and, if the
            connection drops, a resume token our servers issued to reconnect it (kept only in
            memory while the side panel is open); which IRCC page is open (the page&rsquo;s path,
            without the application numbers in its address); for each expected field, whether it
            exists on the page (yes or no); and for each field it entered, whether it matched, the reason if it
            did not, and a one-way (SHA-256) hash of the value it read back. The approval it
            receives from VisaAI, and each instruction to enter a field, contain the answers you
            approved (for example your name, date of birth and passport number). Until you open the
            extension&rsquo;s side panel, that hand-off &mdash; the session token, the VisaAI server
            and portal addresses, and the approval &mdash; is kept in your browser&rsquo;s local
            extension storage; it is deleted when the side panel reads it, and in any case after 5
            minutes.
          </p>
          <p className="text-midtone-gray mt-3">
            To enter your approved answers the extension selects answers (radio buttons and check
            boxes) and adds table rows with the form&rsquo;s own Add and Save buttons. It never
            presses &ldquo;Save and continue&rdquo; or any button that leaves the page, and never
            uploads files, signs, pays, or submits your application. Signature, payment and submission are always yours to do. You can remove
            it at any time from your browser&rsquo;s extensions page; nothing in your VisaAI
            account depends on it.
          </p>
        </div>
        <div>
          <h2 className="type-h3 mb-2">Contact</h2>
          <p className="text-midtone-gray">
            For privacy requests, contact us through the in-app support channel.
          </p>
        </div>
      </section>

      <p className="mt-10 text-[13px]">
        <Link href="/terms" className="underline underline-offset-2">Terms of Service</Link>
      </p>
    </main>
  )
}
