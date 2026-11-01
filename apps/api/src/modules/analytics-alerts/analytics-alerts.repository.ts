import type { Condition, Combine } from './eval/condition.types';

export const ANALYTICS_ALERTS_REPOSITORY = Symbol(
  'ANALYTICS_ALERTS_REPOSITORY',
);

export interface AlertRuleRow {
  id: string;
  name: string;
  metricKey: string;
  metric: string;
  query: any;
  conditions: Condition[];
  combine: Combine;
  recipients: string[];
  notifyUserIds: string[];
  enabled: boolean;
  state: 'ok' | 'breached';
  lastValue: number | null;
  lastEvaluatedAt: string | null;
  lastTransitionAt: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}
export interface AlertEventRow {
  id: string;
  ruleId: string;
  kind: 'breach' | 'recovery';
  value: number | null;
  message: string;
  firedAt: string;
}
export interface StatePatch {
  state: 'ok' | 'breached';
  lastValue: number | null;
  lastEvaluatedAt: string;
  lastTransitionAt: string | null;
}

export interface IAnalyticsAlertsRepository {
  createRule(
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
  ): Promise<AlertRuleRow>;
  getRule(id: string): Promise<AlertRuleRow | null>;
  listRules(): Promise<AlertRuleRow[]>;
  updateRule(
    id: string,
    patch: Partial<
      Pick<
        AlertRuleRow,
        | 'name'
        | 'metricKey'
        | 'metric'
        | 'query'
        | 'conditions'
        | 'combine'
        | 'recipients'
        | 'notifyUserIds'
        | 'enabled'
      >
    >,
  ): Promise<AlertRuleRow | null>;
  deleteRule(id: string): Promise<void>;
  listDueRules(now: Date): Promise<AlertRuleRow[]>;
  updateState(id: string, patch: StatePatch): Promise<void>;
  insertEvent(
    input: Omit<AlertEventRow, 'id' | 'firedAt'> & { firedAt?: string },
  ): Promise<AlertEventRow>;
  listEvents(ruleId: string): Promise<AlertEventRow[]>;
}
