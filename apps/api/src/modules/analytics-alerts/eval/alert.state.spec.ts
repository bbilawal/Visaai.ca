import { transition } from './alert.state';
import { formatAlertMessage } from './alert.message';

describe('transition', () => {
  it.each([
    ['ok', false, 'ok', null],
    ['ok', true, 'breached', 'breach'],
    ['breached', true, 'breached', null],
    ['breached', false, 'ok', 'recovery'],
  ] as const)(
    '%s + breached=%s -> %s, fire=%s',
    (prev, breached, next, fire) => {
      expect(transition(prev, breached)).toEqual({ next, fire });
    },
  );
});

describe('formatAlertMessage', () => {
  it('breach + recovery messages include the name + actual', () => {
    expect(formatAlertMessage('MRR floor', 'breach', 84000)).toMatch(
      /breach.*MRR floor.*84000/i,
    );
    expect(formatAlertMessage('MRR floor', 'recovery', 105000)).toMatch(
      /recovery.*MRR floor/i,
    );
  });
});
