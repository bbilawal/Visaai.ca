'use client'

import { useEffect } from 'react'
import { Link } from '@/i18n/navigation'
import { Button } from '@/components/ui/button'

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error(error)
  }, [error])

  return (
    <div className="flex flex-col items-center justify-center py-24 text-center">
      <p className="text-[12px] font-medium text-midtone-gray tracking-widest uppercase mb-4">
        Error
      </p>
      <h2 className="text-[24px] font-semibold tracking-[-1px] text-deep-black mb-3">
        Something went wrong
      </h2>
      <p className="text-[14px] text-midtone-gray mb-6 max-w-[360px]">
        This section failed to load. You can try again or return to the dashboard.
      </p>
      <div className="flex gap-3">
        <Button onClick={reset}>Try again</Button>
        <Link href="/">
          <Button variant="ghost">Back to dashboard</Button>
        </Link>
      </div>
    </div>
  )
}
