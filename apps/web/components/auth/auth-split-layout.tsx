import Image from 'next/image'
import { Link } from '@/i18n/navigation'
import { ShieldIcon, CheckIcon } from '@/components/ui/icons'
import { LanguageSelector } from '@/components/language-selector'

const BENEFITS = [
  'AI-guided visa preparation, step by step',
  'Document checks and readiness scoring',
  'Your data stays private and encrypted',
]

export function AuthSplitLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-[100dvh] grid md:grid-cols-2 bg-canvas-white">
      <aside aria-label="VisaAI features" className="hidden md:flex flex-col justify-between bg-bg-2 border-r border-hairline-2 p-12">
        <div>
          <Link href="/" aria-label="VisaAI" className="inline-block">
            <Image src="/brand/wordmark-v3.png" alt="VisaAI" width={1109} height={325} priority className="brand-plate h-9 w-auto" />
          </Link>
          <p className="mt-6 font-serif text-[32px] leading-[1.1] tracking-[-1px] text-deep-black max-w-[15ch]">Your AI immigration copilot</p>
          <ul className="mt-8 flex flex-col gap-3">
            {BENEFITS.map(b => (
              <li key={b} className="flex items-start gap-2 text-[13px] text-rich-black">
                <CheckIcon className="h-4 w-4 mt-0.5 text-success-green" />
                {b}
              </li>
            ))}
          </ul>
        </div>
        <p className="flex items-center gap-2 text-[11px] text-midtone-gray">
          <ShieldIcon className="h-3.5 w-3.5" />
          Preparation tool — not legal advice. No outcome guaranteed.
        </p>
      </aside>
      {/* min-w-0: a grid item defaults to `min-width: auto`, so it refuses to
          shrink below its content and forced a 6px horizontal scroll at 320px
          (WCAG 2.2 §1.4.10 Reflow). */}
      <main className="relative flex min-w-0 items-center justify-center px-4 py-10">
        <div className="absolute top-4 end-4">
          <LanguageSelector className="lang-selector" />
        </div>
        <div className="w-full max-w-[420px]">
          {/* Mobile brand lockup — the split panel that carries it on md+ is
              hidden here, so this is the only branding on a phone. */}
          <div className="mb-8 flex justify-center md:hidden">
            <Image src="/brand/wordmark-v3.png" alt="VisaAI" width={1109} height={325} priority className="brand-plate h-10 w-auto" />
          </div>
          {children}
        </div>
      </main>
    </div>
  )
}
