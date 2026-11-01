'use client'

import { useEffect } from 'react'
import { Button } from '@/components/ui/button'

// Root segment error boundary. Renders INSIDE RootLayout (which already owns
// <html>/<body>) — so it must NOT render its own. Root-layout failures are the
// job of global-error.tsx, not this file.
export default function RootError({
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
    <div className="min-h-[100dvh] flex items-center justify-center bg-canvas-white px-4">
      <div className="text-center max-w-[400px]">
        <p className="text-[12px] font-medium text-midtone-gray tracking-widest uppercase mb-4">
          Error
        </p>
        <h1 className="text-[32px] font-semibold tracking-[-1.6px] text-deep-black leading-[1.1] mb-3">
          Something went wrong
        </h1>
        <p className="text-[14px] text-midtone-gray mb-8">
          An unexpected error occurred. Our team has been notified.
        </p>
        <Button onClick={reset}>Try again</Button>
      </div>
    </div>
  )
}
