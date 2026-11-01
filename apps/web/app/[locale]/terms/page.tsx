import type { Metadata } from 'next'
import { Link } from '@/i18n/navigation'
import { localeAlternates } from '@/lib/seo/alternates'
import { SITE_BRAND } from '@/lib/site-config'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>
}): Promise<Metadata> {
  const { locale } = await params
  return {
    title: `Terms of Service — ${SITE_BRAND}`,
    description: 'The terms that govern your use of VisaAI.',
    alternates: localeAlternates('/terms', locale),
  }
}

// TEMPLATE. Strategy Action 10. Must be reviewed and finalized by counsel
// (Action 9) before launch. Approval-neutral; no guarantees; no legal advice.
export default function TermsPage() {
  return (
    <main className="mx-auto max-w-[760px] px-5 py-12 md:py-16">
      <p className="eyebrow mb-2">Legal</p>
      <h1 className="type-h1 mb-2">Terms of Service</h1>
      <p className="text-[13px] text-midtone-gray mb-8">
        Template pending legal review. Last updated: 2026-06-04.
      </p>

      <section className="flex flex-col gap-6 text-[14px] leading-relaxed text-rich-black">
        <div>
          <h2 className="type-h3 mb-2">What VisaAI is</h2>
          <p className="text-midtone-gray">
            VisaAI is a software preparation tool. It is not a law firm, not a licensed immigration
            consultant, and does not provide legal advice or representation. It does not guarantee
            any visa outcome. You remain responsible for the accuracy of your application and for
            reviewing it before use.
          </p>
        </div>
        <div>
          <h2 className="type-h3 mb-2">Your responsibilities</h2>
          <p className="text-midtone-gray">
            You agree to provide truthful, accurate information and to review every AI-generated
            draft before using it. You must not use VisaAI to create false or misleading documents.
            Misrepresentation in an immigration application can have serious consequences that are
            solely your responsibility.
          </p>
        </div>
        <div>
          <h2 className="type-h3 mb-2">AI-generated content</h2>
          <p className="text-midtone-gray">
            Drafts produced by VisaAI are starting points that you must read, edit, and confirm.
            They may contain errors or omissions. For advice about your specific situation, consult
            a licensed immigration consultant (RCIC) or lawyer.
          </p>
        </div>
        <div>
          <h2 className="type-h3 mb-2">Payments and refunds</h2>
          <p className="text-midtone-gray">
            Fees are for use of the software, not for any immigration outcome. A visa refusal is not
            a basis for a refund. Refunds are available only for product failure or an unused paid
            deliverable, as described at checkout.
          </p>
        </div>
        <div>
          <h2 className="type-h3 mb-2">Limitation of liability</h2>
          <p className="text-midtone-gray">
            To the extent permitted by law, VisaAI is provided as is, and we are not liable for
            immigration decisions, missed deadlines, or losses arising from your use of the service.
          </p>
        </div>
      </section>

      <p className="mt-10 text-[13px]">
        <Link href="/privacy" className="underline underline-offset-2">Privacy Policy</Link>
      </p>
    </main>
  )
}
