export type AddonSku =
  | 'addon_document_review'
  | 'addon_rush_sla'
  | 'addon_premium_upgrade';

// Flat, one-time add-on prices (cents). ESTIMATE per doc 30 §3 / 09 §3.
// Flat-priced => margin on top of the floor-gated base; no floor gate needed.
export const ADDON_PRICES: Record<AddonSku, { amount: number; label: string }> =
  {
    addon_document_review: { amount: 7900, label: 'Document Review' },
    addon_rush_sla: { amount: 9900, label: 'Rush / Priority SLA' },
    addon_premium_upgrade: {
      amount: 30000,
      label: 'Premium Consultant Upgrade',
    },
  };
