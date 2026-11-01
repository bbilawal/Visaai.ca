export class AlertValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AlertValidationError';
  }
}
export class AlertNotFoundError extends Error {
  constructor(public readonly id: string) {
    super(`Alert '${id}' not found`);
    this.name = 'AlertNotFoundError';
  }
}
