export const ANALYTICS_REPORTS_REPOSITORY = Symbol(
  'ANALYTICS_REPORTS_REPOSITORY',
);

export interface SavedReportRow {
  id: string;
  name: string;
  metricKey: string;
  metric: string;
  query: any;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}
export interface ScheduledReportRow {
  id: string;
  savedReportId: string;
  cron: string;
  format: 'pdf' | 'xlsx';
  recipients: string[];
  notifyUserIds: string[];
  enabled: boolean;
  lastRunAt: string | null;
  nextRunAt: string | null;
}
export interface ReportRunRow {
  id: string;
  savedReportId: string;
  scheduledReportId: string | null;
  status: 'success' | 'failed';
  resultSnapshot: any;
  error: string | null;
  deliveryError: string | null;
  ranAt: string;
}

export interface IAnalyticsReportsRepository {
  createSaved(
    input: Omit<SavedReportRow, 'id' | 'createdAt' | 'updatedAt'>,
  ): Promise<SavedReportRow>;
  getSaved(id: string): Promise<SavedReportRow | null>;
  listSaved(): Promise<SavedReportRow[]>;
  updateSaved(
    id: string,
    patch: Partial<
      Pick<SavedReportRow, 'name' | 'metricKey' | 'metric' | 'query'>
    >,
  ): Promise<SavedReportRow | null>;
  deleteSaved(id: string): Promise<void>;
  upsertSchedule(
    input: Omit<ScheduledReportRow, 'id' | 'enabled' | 'lastRunAt'> & {
      id?: string;
      enabled?: boolean;
    },
  ): Promise<ScheduledReportRow>;
  getScheduleForReport(
    savedReportId: string,
  ): Promise<ScheduledReportRow | null>;
  deleteScheduleForReport(savedReportId: string): Promise<void>;
  listDueSchedules(now: Date): Promise<ScheduledReportRow[]>;
  setNextRun(scheduleId: string, nextRunAtIso: string): Promise<void>;
  insertRun(
    input: Omit<ReportRunRow, 'id' | 'ranAt'> & { ranAt?: string },
  ): Promise<ReportRunRow>;
  listRuns(savedReportId: string): Promise<ReportRunRow[]>;
}
