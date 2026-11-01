import { randomUUID } from 'node:crypto';
import type {
  IAnalyticsReportsRepository,
  SavedReportRow,
  ScheduledReportRow,
  ReportRunRow,
} from './analytics-reports.repository';

export class MockAnalyticsReportsRepository implements IAnalyticsReportsRepository {
  saved = new Map<string, SavedReportRow>();
  schedules = new Map<string, ScheduledReportRow>();
  runs: ReportRunRow[] = [];

  async createSaved(
    input: Omit<SavedReportRow, 'id' | 'createdAt' | 'updatedAt'>,
  ): Promise<SavedReportRow> {
    const now = new Date().toISOString();
    const row: SavedReportRow = {
      ...input,
      id: randomUUID(),
      createdAt: now,
      updatedAt: now,
    };
    this.saved.set(row.id, row);
    return row;
  }
  async getSaved(id: string) {
    return this.saved.get(id) ?? null;
  }
  async listSaved() {
    return [...this.saved.values()];
  }
  async updateSaved(
    id: string,
    patch: Partial<
      Pick<SavedReportRow, 'name' | 'metricKey' | 'metric' | 'query'>
    >,
  ) {
    const r = this.saved.get(id);
    if (!r) return null;
    Object.assign(r, patch, { updatedAt: new Date().toISOString() });
    return r;
  }
  async deleteSaved(id: string) {
    this.saved.delete(id);
    for (const [k, s] of this.schedules)
      if (s.savedReportId === id) this.schedules.delete(k);
  }
  async upsertSchedule(
    input: Omit<ScheduledReportRow, 'id' | 'enabled' | 'lastRunAt'> & {
      id?: string;
      enabled?: boolean;
    },
  ): Promise<ScheduledReportRow> {
    const existing = [...this.schedules.values()].find(
      (s) => s.savedReportId === input.savedReportId,
    );
    const row: ScheduledReportRow = {
      id: existing?.id ?? input.id ?? randomUUID(),
      savedReportId: input.savedReportId,
      cron: input.cron,
      format: input.format,
      recipients: input.recipients,
      notifyUserIds: input.notifyUserIds,
      nextRunAt: input.nextRunAt,
      enabled: input.enabled ?? true,
      lastRunAt: existing?.lastRunAt ?? null,
    };
    this.schedules.set(row.id, row);
    return row;
  }
  async getScheduleForReport(savedReportId: string) {
    return (
      [...this.schedules.values()].find(
        (s) => s.savedReportId === savedReportId,
      ) ?? null
    );
  }
  async deleteScheduleForReport(savedReportId: string) {
    for (const [k, s] of this.schedules)
      if (s.savedReportId === savedReportId) this.schedules.delete(k);
  }
  async listDueSchedules(now: Date) {
    return [...this.schedules.values()].filter(
      (s) =>
        s.enabled && s.nextRunAt != null && s.nextRunAt <= now.toISOString(),
    );
  }
  async setNextRun(scheduleId: string, nextRunAtIso: string) {
    const s = this.schedules.get(scheduleId);
    if (s) {
      s.lastRunAt = new Date().toISOString();
      s.nextRunAt = nextRunAtIso;
    }
  }
  async insertRun(
    input: Omit<ReportRunRow, 'id' | 'ranAt'> & { ranAt?: string },
  ): Promise<ReportRunRow> {
    const row: ReportRunRow = {
      id: randomUUID(),
      ranAt: input.ranAt ?? new Date().toISOString(),
      ...input,
    };
    this.runs.push(row);
    return row;
  }
  async listRuns(savedReportId: string) {
    return this.runs.filter((r) => r.savedReportId === savedReportId);
  }
}
