import { randomUUID } from 'node:crypto';
import type {
  IAnalyticsAlertsRepository,
  AlertRuleRow,
  AlertEventRow,
  StatePatch,
} from './analytics-alerts.repository';

export class MockAnalyticsAlertsRepository implements IAnalyticsAlertsRepository {
  rules = new Map<string, AlertRuleRow>();
  events: AlertEventRow[] = [];

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
    const now = new Date().toISOString();
    const row: AlertRuleRow = {
      ...input,
      id: randomUUID(),
      state: 'ok',
      lastValue: null,
      lastEvaluatedAt: null,
      lastTransitionAt: null,
      createdAt: now,
      updatedAt: now,
    };
    this.rules.set(row.id, row);
    return row;
  }
  async getRule(id: string) {
    return this.rules.get(id) ?? null;
  }
  async listRules() {
    return [...this.rules.values()];
  }
  async updateRule(id: string, patch: Partial<AlertRuleRow>) {
    const r = this.rules.get(id);
    if (!r) return null;
    Object.assign(r, patch, { updatedAt: new Date().toISOString() });
    return r;
  }
  async deleteRule(id: string) {
    this.rules.delete(id);
    this.events = this.events.filter((e) => e.ruleId !== id);
  }
  async listDueRules(_now: Date) {
    return [...this.rules.values()].filter((r) => r.enabled);
  }
  async updateState(id: string, patch: StatePatch) {
    const r = this.rules.get(id);
    if (r) Object.assign(r, patch);
  }
  async insertEvent(
    input: Omit<AlertEventRow, 'id' | 'firedAt'> & { firedAt?: string },
  ): Promise<AlertEventRow> {
    const row: AlertEventRow = {
      id: randomUUID(),
      firedAt: input.firedAt ?? new Date().toISOString(),
      ...input,
    };
    this.events.push(row);
    return row;
  }
  async listEvents(ruleId: string) {
    return this.events.filter((e) => e.ruleId === ruleId);
  }
}
