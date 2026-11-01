import { Injectable } from '@nestjs/common';
import { SupabaseService } from '../../shared/supabase/supabase.service';
import type {
  IAnalyticsReportsRepository,
  SavedReportRow,
  ScheduledReportRow,
  ReportRunRow,
} from './analytics-reports.repository';

function mapSaved(r: any): SavedReportRow {
  return {
    id: r.id,
    name: r.name,
    metricKey: r.metric_key,
    metric: r.metric,
    query: r.query,
    createdBy: r.created_by,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}
function mapSchedule(r: any): ScheduledReportRow {
  return {
    id: r.id,
    savedReportId: r.saved_report_id,
    cron: r.cron,
    format: r.format,
    recipients: r.recipients ?? [],
    notifyUserIds: r.notify_user_ids ?? [],
    enabled: r.enabled,
    lastRunAt: r.last_run_at,
    nextRunAt: r.next_run_at,
  };
}
function mapRun(r: any): ReportRunRow {
  return {
    id: r.id,
    savedReportId: r.saved_report_id,
    scheduledReportId: r.scheduled_report_id,
    status: r.status,
    resultSnapshot: r.result_snapshot,
    error: r.error,
    deliveryError: r.delivery_error,
    ranAt: r.ran_at,
  };
}

@Injectable()
export class SupabaseAnalyticsReportsRepository implements IAnalyticsReportsRepository {
  constructor(private readonly supabase: SupabaseService) {}
  private get db() {
    return this.supabase.admin;
  }

  async createSaved(
    input: Omit<SavedReportRow, 'id' | 'createdAt' | 'updatedAt'>,
  ): Promise<SavedReportRow> {
    const { data, error } = await this.db
      .from('analytics_saved_report')
      .insert({
        name: input.name,
        metric_key: input.metricKey,
        metric: input.metric,
        query: input.query,
        created_by: input.createdBy,
      })
      .select()
      .single();
    if (error) throw error;
    return mapSaved(data);
  }
  async getSaved(id: string): Promise<SavedReportRow | null> {
    const { data, error } = await this.db
      .from('analytics_saved_report')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (error) throw error;
    return data ? mapSaved(data) : null;
  }
  async listSaved(): Promise<SavedReportRow[]> {
    const { data, error } = await this.db
      .from('analytics_saved_report')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) throw error;
    return (data ?? []).map(mapSaved);
  }
  async updateSaved(
    id: string,
    patch: Partial<
      Pick<SavedReportRow, 'name' | 'metricKey' | 'metric' | 'query'>
    >,
  ): Promise<SavedReportRow | null> {
    const row: any = { updated_at: new Date().toISOString() };
    if (patch.name !== undefined) row.name = patch.name;
    if (patch.metricKey !== undefined) row.metric_key = patch.metricKey;
    if (patch.metric !== undefined) row.metric = patch.metric;
    if (patch.query !== undefined) row.query = patch.query;
    const { data, error } = await this.db
      .from('analytics_saved_report')
      .update(row)
      .eq('id', id)
      .select()
      .maybeSingle();
    if (error) throw error;
    return data ? mapSaved(data) : null;
  }
  async deleteSaved(id: string): Promise<void> {
    const { error } = await this.db
      .from('analytics_saved_report')
      .delete()
      .eq('id', id);
    if (error) throw error;
  }
  async upsertSchedule(
    input: Omit<ScheduledReportRow, 'id' | 'enabled' | 'lastRunAt'> & {
      id?: string;
      enabled?: boolean;
    },
  ): Promise<ScheduledReportRow> {
    const row = {
      saved_report_id: input.savedReportId,
      cron: input.cron,
      format: input.format,
      recipients: input.recipients,
      notify_user_ids: input.notifyUserIds,
      next_run_at: input.nextRunAt,
      enabled: input.enabled ?? true,
    };
    const { data, error } = await this.db
      .from('analytics_scheduled_report')
      .upsert(row, { onConflict: 'saved_report_id' })
      .select()
      .single();
    if (error) throw error;
    return mapSchedule(data);
  }
  async getScheduleForReport(
    savedReportId: string,
  ): Promise<ScheduledReportRow | null> {
    const { data, error } = await this.db
      .from('analytics_scheduled_report')
      .select('*')
      .eq('saved_report_id', savedReportId)
      .maybeSingle();
    if (error) throw error;
    return data ? mapSchedule(data) : null;
  }
  async deleteScheduleForReport(savedReportId: string): Promise<void> {
    const { error } = await this.db
      .from('analytics_scheduled_report')
      .delete()
      .eq('saved_report_id', savedReportId);
    if (error) throw error;
  }
  async listDueSchedules(now: Date): Promise<ScheduledReportRow[]> {
    const { data, error } = await this.db
      .from('analytics_scheduled_report')
      .select('*')
      .eq('enabled', true)
      .lte('next_run_at', now.toISOString());
    if (error) throw error;
    return (data ?? []).map(mapSchedule);
  }
  async setNextRun(scheduleId: string, nextRunAtIso: string): Promise<void> {
    const { error } = await this.db
      .from('analytics_scheduled_report')
      .update({
        last_run_at: new Date().toISOString(),
        next_run_at: nextRunAtIso,
      })
      .eq('id', scheduleId);
    if (error) throw error;
  }
  async insertRun(
    input: Omit<ReportRunRow, 'id' | 'ranAt'> & { ranAt?: string },
  ): Promise<ReportRunRow> {
    const { data, error } = await this.db
      .from('analytics_report_run')
      .insert({
        saved_report_id: input.savedReportId,
        scheduled_report_id: input.scheduledReportId,
        status: input.status,
        result_snapshot: input.resultSnapshot,
        error: input.error,
        delivery_error: input.deliveryError,
      })
      .select()
      .single();
    if (error) throw error;
    return mapRun(data);
  }
  async listRuns(savedReportId: string): Promise<ReportRunRow[]> {
    const { data, error } = await this.db
      .from('analytics_report_run')
      .select('*')
      .eq('saved_report_id', savedReportId)
      .order('ran_at', { ascending: false });
    if (error) throw error;
    return (data ?? []).map(mapRun);
  }
}
