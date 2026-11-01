export function formatAlertMessage(
  name: string,
  kind: 'breach' | 'recovery',
  actual: number | null,
): string {
  const a = actual === null ? 'n/a' : String(actual);
  return kind === 'breach'
    ? `[breach] ${name}: threshold crossed (actual ${a})`
    : `[recovery] ${name}: back within threshold (actual ${a})`;
}
