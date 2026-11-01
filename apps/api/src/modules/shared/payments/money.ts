export interface Money {
  readonly amountMinor: number;
  readonly currency: string; // ISO-4217, lowercase
}

// Currencies whose smallest unit IS the major unit (no cents).
const ZERO_DECIMAL = new Set([
  'bif',
  'clp',
  'djf',
  'gnf',
  'jpy',
  'kmf',
  'krw',
  'mga',
  'pyg',
  'rwf',
  'ugx',
  'vnd',
  'vuv',
  'xaf',
  'xof',
  'xpf',
]);
// Currencies with three-decimal minor units.
const THREE_DECIMAL = new Set(['bhd', 'jod', 'kwd', 'omr', 'tnd']);

export function minorUnitExponent(currency: string): number {
  const c = currency.toLowerCase();
  if (ZERO_DECIMAL.has(c)) return 0;
  if (THREE_DECIMAL.has(c)) return 3;
  return 2;
}

export function money(amountMinor: number, currency: string): Money {
  if (!Number.isInteger(amountMinor)) {
    throw new Error(`Money.amountMinor must be an integer, got ${amountMinor}`);
  }
  return { amountMinor, currency: currency.toLowerCase() };
}

export function toMinor(display: number, currency: string): Money {
  const factor = 10 ** minorUnitExponent(currency);
  return money(Math.round(display * factor), currency);
}

export function fromMinor(m: Money): number {
  const factor = 10 ** minorUnitExponent(m.currency);
  return m.amountMinor / factor;
}

export function assertSameCurrency(a: Money, b: Money): void {
  if (a.currency !== b.currency) {
    throw new Error(`Currency mismatch: ${a.currency} vs ${b.currency}`);
  }
}
