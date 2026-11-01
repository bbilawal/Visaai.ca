import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

const APPLICATION_STATUS_LABELS: Record<string, string> = {
  draft: 'In progress',
  ready: 'Ready to submit',
  submitted: 'Submitted',
  decided: 'Decision received',
}

/** Turn a snake_case status token into a readable label. */
export function humanizeStatus(status: string): string {
  return (
    APPLICATION_STATUS_LABELS[status] ??
    status
      .replace(/_/g, ' ')
      .replace(/\b\w/g, c => c.toUpperCase())
  )
}
