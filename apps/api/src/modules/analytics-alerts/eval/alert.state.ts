export function transition(
  prev: 'ok' | 'breached',
  breached: boolean,
): { next: 'ok' | 'breached'; fire: null | 'breach' | 'recovery' } {
  if (prev === 'ok')
    return breached
      ? { next: 'breached', fire: 'breach' }
      : { next: 'ok', fire: null };
  return breached
    ? { next: 'breached', fire: null }
    : { next: 'ok', fire: 'recovery' };
}
