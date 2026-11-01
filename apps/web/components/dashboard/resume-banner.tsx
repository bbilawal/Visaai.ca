import { Link } from '@/i18n/navigation'
import type { AppProgress } from '@visaai/types'
import { ProgressRing } from './progress-ring'
import { Button } from '@/components/ui/button'

interface ResumeBannerProps {
  progress: AppProgress
  title: string
}

export function ResumeBanner({ progress, title }: ResumeBannerProps) {
  return (
    <div className="resume-banner anim-fade-up anim-visible">
      <ProgressRing pct={progress.overallPct} size={52} />
      <div className="resume-banner__body">
        <span className="eyebrow">Pick up where you left off</span>
        <p className="resume-banner__title">{title}: {progress.nextAction.label}</p>
      </div>
      <Link href={progress.nextAction.href}>
        <Button size="lg">Resume</Button>
      </Link>
    </div>
  )
}
