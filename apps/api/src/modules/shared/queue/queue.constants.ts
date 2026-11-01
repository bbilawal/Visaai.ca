export const DOCUMENT_QUEUE = 'document-ocr';
export const REMINDER_QUEUE = 'reminders';
export const NOTIFICATION_QUEUE = 'messaging-notifications';
export const SYSTEM_NOTIFICATION_QUEUE = 'system-notifications';
export const BROADCAST_QUEUE = 'notification-broadcast';
export const NOTIFICATION_OUTBOX_QUEUE = 'notification-outbox';
export const NOTIFICATION_DLQ_ALERT_QUEUE = 'notification-dlq-alert';
export const PRICING_RECOMPUTE_QUEUE = 'pricing-recompute';
export const PAYOUTS_SWEEP_QUEUE = 'payouts-sweep';
export const RECONCILE_QUEUE = 'reconciliation';
export const DUNNING_QUEUE = 'dunning';
export const ANALYTICS_INGEST_QUEUE = 'analytics-ingest';
export const ANALYTICS_ROLLUP_QUEUE = 'analytics-rollup';
export const ANALYTICS_RETENTION_QUEUE = 'analytics-retention';
export const KPI_ROLLUP_QUEUE = 'kpi-rollup';
export const KPI_COHORT_QUEUE = 'kpi-cohort';
export const ANALYTICS_REPORTS_QUEUE = 'analytics-reports';
export const ANALYTICS_ALERTS_QUEUE = 'analytics-alerts';
export const PARTNER_WEBHOOK_QUEUE = 'partner-webhooks';
export const FORM_REFRESH_QUEUE = 'form-refresh';
export const DOC_TEMPLATE_REFRESH_QUEUE = 'doc-template-refresh';
export const TEMPLATE_SWEEP_QUEUE = 'template-sweep';
/**
 * The daily official-source monitor. Distinct from FORM_REFRESH_QUEUE and
 * DOC_TEMPLATE_REFRESH_QUEUE: those cache artifacts a government publishes,
 * this one watches the requirement pages themselves for change.
 */
export const VISA_SOURCE_SYNC_QUEUE = 'visa-source-sync';

/**
 * The knowledge pipeline: extraction, chunking, embedding and the freshness
 * sweep. Distinct from VISA_SOURCE_SYNC_QUEUE, which decides only whether a
 * page CHANGED — this one turns a page into something retrievable.
 */
export const KNOWLEDGE_QUEUE = 'knowledge-ingest';
