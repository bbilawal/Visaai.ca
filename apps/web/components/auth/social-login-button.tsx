'use client'

import { Button } from '@/components/ui/button'
import { GoogleIcon, MicrosoftIcon } from '@/components/ui/icons'

const META = {
  google: { label: 'Continue with Google', Icon: GoogleIcon },
  azure: { label: 'Continue with Microsoft', Icon: MicrosoftIcon },
} as const

export function SocialLoginButton({
  provider,
  loading,
  onClick,
}: {
  provider: 'google' | 'azure'
  loading?: boolean
  onClick: () => void
}) {
  const { label, Icon } = META[provider]
  return (
    <Button
      type="button"
      variant="outline"
      className="w-full justify-center gap-2"
      loading={loading}
      onClick={onClick}
    >
      {!loading && <Icon className="h-4 w-4" />}
      {label}
    </Button>
  )
}
