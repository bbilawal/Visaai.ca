/**
 * Single-use ledger for readback tokens (replay protection).
 *
 * `consume` is the atomic execution-commit gate: it returns true exactly once
 * per token hash (first use) and false on every subsequent attempt (replay).
 * Implemented over a primary-key insert so concurrent executes cannot both win.
 */
export interface IExecutionTokenStore {
  /** True if this is the first consumption (proceed); false if already used (replay). */
  consume(tokenHash: string, applicationId: string): Promise<boolean>;
}

export const EXECUTION_TOKEN_STORE = Symbol('IExecutionTokenStore');
