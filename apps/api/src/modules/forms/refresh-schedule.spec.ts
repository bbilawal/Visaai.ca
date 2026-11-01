import {
  COUNTRY_TIMEZONES,
  DEFAULT_REFRESH_HOUR,
  refreshHour,
  scheduleFor,
  timezoneFor,
} from './refresh-schedule';
import { withMinuteOffset } from '../doc-templates/doc-refresh.scheduler';
import '../../strategies';
import { strategyRegistry } from '../../strategies';

describe('refreshHour', () => {
  it('defaults to the morning hour', () => {
    expect(refreshHour({})).toBe(DEFAULT_REFRESH_HOUR);
    expect(DEFAULT_REFRESH_HOUR).toBe(9);
  });

  it('honours an operator override', () => {
    expect(refreshHour({ TEMPLATE_REFRESH_HOUR: '6' })).toBe(6);
    expect(refreshHour({ TEMPLATE_REFRESH_HOUR: '0' })).toBe(0);
  });

  // A bad value must not silently become midnight (Number('') === 0) or crash
  // the scheduler at boot — the whole cache would stop refreshing.
  it('falls back to the default on a bad value', () => {
    for (const bad of ['', 'nine', '24', '-1', '9.5']) {
      expect(refreshHour({ TEMPLATE_REFRESH_HOUR: bad })).toBe(
        DEFAULT_REFRESH_HOUR,
      );
    }
  });
});

describe('timezoneFor', () => {
  it('maps a country to the zone of its issuing authority', () => {
    expect(timezoneFor('CA')).toBe('America/Toronto');
    expect(timezoneFor('au')).toBe('Australia/Sydney');
  });

  // A country missing from the table must still be refreshed daily — silently
  // skipping it would mean a newly registered country never updates.
  it('falls back to UTC for an unmapped country', () => {
    expect(timezoneFor('ZZ')).toBe('UTC');
  });

  it('covers every registered country', () => {
    for (const { code } of strategyRegistry.listCountries()) {
      expect(COUNTRY_TIMEZONES[code.toUpperCase()]).toBeDefined();
    }
  });

  it('names only real IANA zones', () => {
    for (const zone of Object.values(COUNTRY_TIMEZONES)) {
      expect(
        () => new Intl.DateTimeFormat('en', { timeZone: zone }),
      ).not.toThrow();
    }
  });
});

describe('scheduleFor', () => {
  it('puts every country at the configured hour, local time', () => {
    const s = scheduleFor('CA', 'form-refresh', {});
    expect(s.pattern).toMatch(/^\d{1,2} 9 \* \* \*$/);
    expect(s.timezone).toBe('America/Toronto');
    expect(s.jobId).toBe('form-refresh:CA');
  });

  it('is deterministic for a given country', () => {
    expect(scheduleFor('DE', 'form-refresh', {}).pattern).toBe(
      scheduleFor('de', 'form-refresh', {}).pattern,
    );
  });

  // The 27 Schengen members mostly share one or two UTC offsets. Firing them
  // all on the minute is exactly the thundering herd that got us rate-limited
  // by the European Commission (HTTP 429) on 2026-08-13.
  it('staggers members that share a timezone across the hour', () => {
    const minutes = new Set(
      ['DE', 'FR', 'IT', 'ES', 'NL', 'BE', 'AT', 'PL'].map(
        (c) => scheduleFor(c, 'form-refresh', {}).pattern.split(' ')[0],
      ),
    );
    expect(minutes.size).toBeGreaterThan(4);
  });

  it('produces a valid cron minute for every registered country', () => {
    for (const { code } of strategyRegistry.listCountries()) {
      const [minute, hour] = scheduleFor(
        code,
        'form-refresh',
        {},
      ).pattern.split(' ');
      expect(Number(minute)).toBeGreaterThanOrEqual(0);
      expect(Number(minute)).toBeLessThan(60);
      expect(Number(hour)).toBe(9);
    }
  });
});

describe('withMinuteOffset', () => {
  it('shifts documents clear of the same country forms run', () => {
    expect(withMinuteOffset('5 9 * * *', 30)).toBe('35 9 * * *');
  });

  // Minute 75 is not a cron minute: the schedule would be rejected and that
  // country would silently never refresh.
  it('rolls over into the next hour instead of emitting minute 75', () => {
    expect(withMinuteOffset('45 9 * * *', 30)).toBe('15 10 * * *');
    expect(withMinuteOffset('45 23 * * *', 30)).toBe('15 0 * * *');
  });
});
