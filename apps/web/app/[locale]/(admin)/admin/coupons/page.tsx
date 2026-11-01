import { getTranslations } from 'next-intl/server'
import { CouponForm } from './coupon-form'

export default async function AdminCouponsPage() {
  const t = await getTranslations('adminBilling')
  const labels: Record<string, string> = {
    code: t('code'), kind: t('kind'), percent: t('percent'), amountKind: t('amountKind'),
    percentOff: t('percentOff'), amountOff: t('amountOff'), appliesTo: t('appliesTo'),
    maxRedemptions: t('maxRedemptions'), validUntil: t('validUntil'),
    createCoupon: t('createCoupon'), couponOk: t('couponOk'), error: t('error'),
  }
  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <h1 className="type-h2">{t('couponsTitle')}</h1>
      <CouponForm labels={labels} />
    </div>
  )
}
