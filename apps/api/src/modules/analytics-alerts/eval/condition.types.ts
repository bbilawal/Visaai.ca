export type ConditionTarget =
  | { kind: 'total' }
  | { kind: 'delta_pct' }
  | { kind: 'series'; agg: 'min' | 'max' | 'last' | 'avg' }
  | { kind: 'dimension'; dimVal: string };
export type Operator = 'gt' | 'lt' | 'gte' | 'lte' | 'eq';
export type Combine = 'all' | 'any';
export interface Condition {
  target: ConditionTarget;
  op: Operator;
  value: number;
}
