import { Link } from '@/i18n/navigation'
import type { AppProgress } from '@visaai/types'
import { Button } from '@/components/ui/button'

export function NextActionCard({ progress }: { progress: AppProgress }) {
  return (
    <div className="next-action">
      <div>
        <span className="eyebrow">Next step</span>
        <p className="next-action__label">{progress.nextAction.label}</p>
      </div>
      <Link href={progress.nextAction.href}>
        <Button>Continue</Button>
      </Link>
    </div>
  )
}
