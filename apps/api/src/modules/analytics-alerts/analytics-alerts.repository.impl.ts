import { Injectable } from '@nestjs/common';
import { SupabaseService } from '../shared/supabase/supabase.service';
import type {
  IAnalyticsAlertsRepository,
  AlertRuleRow,
  AlertEventRow,
  StatePatch,
} from './analytics-alerts.repository';

function mapRule(r: any): AlertRuleRow {
  return {
    id: r.id,
    name: r.name,
    metricKey: r.metric_key,
    metric: r.metric,
    query: r.query,
    conditions: r.conditions ?? [],
    combine: r.combine,
    recipients: r.recipients ?? [],
    notifyUserIds: r.notify_user_ids ?? [],
    enabled: r.enabled,
    state: r.state,
    lastValue:
      r.last_value === null || r.last_value === undefined
        ? null
        : Number(r.last_value),
    lastEvaluatedAt: r.last_evaluated_at,
    lastTransitionAt: r.last_transition_at,
    createdBy: r.created_by,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}
function mapEvent(r: any): AlertEventRow {
  return {
    id: r.id,
    ruleId: r.rule_id,
    kind: r.kind,
    value: r.value === null || r.value === undefined ? null : Number(r.value),
    message: r.message,
    firedAt: r.fired_at,
  };
}

@Injectable()
export class SupabaseAnalyticsAlertsRepository implements IAnalyticsAlertsRepository {
  constructor(private readonly supabase: SupabaseService) {}
  private get db() {
    return this.supabase.admin;
  }

  async createRule(
    input: Omit<
      AlertRuleRow,
      | 'id'
      | 'state'
      | 'lastValue'
      | 'lastEvaluatedAt'
      | 'lastTransitionAt'
      | 'createdAt'
      | 'updatedAt'
    >,
  ): Promise<AlertRuleRow> {
    const { data, error } = await this.db
      .from('analytics_alert_rule')
      .insert({
        name: input.name,
        metric_key: input.metricKey,
        metric: input.metric,
        query: input.query,
        conditions: input.conditions,
        combine: input.combine,
        recipients: input.recipients,
        notify_user_ids: input.notifyUserIds,
        enabled: input.enabled,
        created_by: input.createdBy,
      })
      .select()
      .single();
    if (error) throw error;
    return mapRule(data);
  }
  async getRule(id: string): Promise<AlertRuleRow | null> {
    const { data, error } = await this.db
      .from('analytics_alert_rule')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (error) throw error;
    return data ? mapRule(data) : null;
  }
  async listRules(): Promise<AlertRuleRow[]> {
    const { data, error } = await this.db
      .from('analytics_alert_rule')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) throw error;
    return (data ?? []).map(mapRule);
  }
  async updateRule(
    id: string,
    patch: Partial<AlertRuleRow>,
  ): Promise<AlertRuleRow | null> {
    const row: any = { updated_at: new Date().toISOString() };
    if (patch.name !== undefined) row.name = patch.name;
    if (patch.metricKey !== undefined) row.metric_key = patch.metricKey;
    if (patch.metric !== undefined) row.metric = patch.metric;
    if (patch.query !== undefined) row.query = patch.query;
    if (patch.conditions !== undefined) row.conditions = patch.conditions;
    if (patch.combine !== undefined) row.combine = patch.combine;
    if (patch.recipients !== undefined) row.recipients = patch.recipients;
    if (patch.notifyUserIds !== undefined)
      row.notify_user_ids = patch.notifyUserIds;
    if (patch.enabled !== undefined) row.enabled = patch.enabled;
    const { data, error } = await this.db
      .from('analytics_alert_rule')
      .update(row)
      .eq('id', id)
      .select()
      .maybeSingle();
    if (error) throw error;
    return data ? mapRule(data) : null;
  }
  async deleteRule(id: string): Promise<void> {
    const { error } = await this.db
      .from('analytics_alert_rule')
      .delete()
      .eq('id', id);
    if (error) throw error;
  }
  async listDueRules(): Promise<AlertRuleRow[]> {
    const { data, error } = await this.db
      .from('analytics_alert_rule')
      .select('*')
      .eq('enabled', true);
    if (error) throw error;
    return (data ?? []).map(mapRule);
  }
  async updateState(id: string, patch: StatePatch): Promise<void> {
    const { error } = await this.db
      .from('analytics_alert_rule')
      .update({
        state: patch.state,
        last_value: patch.lastValue,
        last_evaluated_at: patch.lastEvaluatedAt,
        last_transition_at: patch.lastTransitionAt,
      })
      .eq('id', id);
    if (error) throw error;
  }
  async insertEvent(
    input: Omit<AlertEventRow, 'id' | 'firedAt'> & { firedAt?: string },
  ): Promise<AlertEventRow> {
    const { data, error } = await this.db
      .from('analytics_alert_event')
      .insert({
        rule_id: input.ruleId,
        kind: input.kind,
        value: input.value,
        message: input.message,
      })
      .select()
      .single();
    if (error) throw error;
    return mapEvent(data);
  }
  async listEvents(ruleId: string): Promise<AlertEventRow[]> {
    const { data, error } = await this.db
      .from('analytics_alert_event')
      .select('*')
      .eq('rule_id', ruleId)
      .order('fired_at', { ascending: false });
    if (error) throw error;
    return (data ?? []).map(mapEvent);
  }
}
