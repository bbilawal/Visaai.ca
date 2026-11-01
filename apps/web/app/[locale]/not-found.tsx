import { Link } from '@/i18n/navigation'
import { Button } from '@/components/ui/button'

export default function NotFound() {
  return (
    <div className="min-h-[100dvh] flex items-center justify-center bg-canvas-white px-4">
      <div className="text-center max-w-[400px]">
        <p className="text-[12px] font-medium text-midtone-gray tracking-widest uppercase mb-4">
          404
        </p>
        <h1 className="text-[32px] font-semibold tracking-[-1.6px] text-deep-black leading-[1.1] mb-3">
          Page not found
        </h1>
        <p className="text-[14px] text-midtone-gray mb-8">
          The page you&apos;re looking for doesn&apos;t exist or has been moved.
        </p>
        <Link href="/">
          <Button>Back to dashboard</Button>
        </Link>
      </div>
    </div>
  )
}
