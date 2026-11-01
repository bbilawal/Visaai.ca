import type { MetricUnit } from '@visaai/types'

export function formatMetricValue(value: number, unit: MetricUnit, locale = 'en-US'): string {
  switch (unit) {
    case 'cents':
      return new Intl.NumberFormat(locale, { style: 'currency', currency: 'USD' }).format(value / 100)
    case 'usd':
      return new Intl.NumberFormat(locale, { style: 'currency', currency: 'USD' }).format(value)
    case 'ratio':
      return `${(value * 100).toFixed(1)}%`
    case 'count':
    default:
      return new Intl.NumberFormat(locale).format(value)
  }
}
