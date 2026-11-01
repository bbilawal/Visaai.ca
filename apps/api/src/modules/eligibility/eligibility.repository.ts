/**
 * Narrow read-only ports the ExecutionEligibilityService depends on, kept as
 * interfaces so eligibility does NOT import the execution workflow / automation
 * module directly. Concrete adapters bound in a later sub-phase.
 */

/** Payment leg: has the one-time prefill fee been paid for this application? */
export interface IPaymentReadModel {
  hasPaidPrefill(applicationId: string): Promise<boolean>;
}

export const PAYMENT_READ_MODEL = Symbol('IPaymentReadModel');

/** Token leg: validate an execution token (single-use, unexpired, unrevoked). */
export interface ITokenValidator {
  /** Mint a bound execution token at session setup (the only issuer). */
  mint(sessionId: string, applicationId: string, userId: string): string;
  isValid(
    token: string,
    sessionId: string,
    applicationId: string,
    userId: string,
  ): Promise<boolean>;
}

export const TOKEN_VALIDATOR = Symbol('ITokenValidator');
