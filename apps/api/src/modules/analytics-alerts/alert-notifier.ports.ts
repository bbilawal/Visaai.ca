export const ALERT_NOTIFIER = Symbol('ALERT_NOTIFIER');
export interface AlertNotifier {
  fire(input: {
    ruleId: string;
    title: string;
    message: string;
    userIds: string[];
  }): Promise<void>;
}
