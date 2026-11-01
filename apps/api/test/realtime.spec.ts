import {
  AssignmentEventBus,
  computeVisibility,
  isRelevantToConsultant,
  toQueueEvent,
  type AssignmentBusEvent,
} from '../src/modules/event-bus/assignment-event-bus';

const CA_CONS = 'cons-ca';
const AU_CONS = 'cons-au';
const caCountries = new Set(['CA', 'US']);
const auCountries = new Set(['AU']);

function busEvent(p: Partial<AssignmentBusEvent>): AssignmentBusEvent {
  return {
    type: 'APPLICATION_CREATED',
    application_id: 'app-1',
    destination_country: 'CA',
    previous_consultant_id: null,
    new_consultant_id: null,
    timestamp: new Date().toISOString(),
    ...p,
  };
}

describe('AssignmentEventBus — emit/subscribe', () => {
  it('delivers emitted events to subscribers with a timestamp', () => {
    const bus = new AssignmentEventBus();
    const got: AssignmentBusEvent[] = [];
    bus.events.subscribe((e) => got.push(e));
    bus.emit({
      type: 'APPLICATION_CREATED',
      application_id: 'a',
      destination_country: 'CA',
      previous_consultant_id: null,
      new_consultant_id: null,
    });
    expect(got).toHaveLength(1);
    expect(got[0].timestamp).toEqual(expect.any(String));
  });

  it('is hot — only delivers events emitted AFTER subscription (per-connection isolation)', () => {
    const bus = new AssignmentEventBus();
    bus.emit(busEvent({})); // before any subscriber
    const got: AssignmentBusEvent[] = [];
    bus.events.subscribe((e) => got.push(e));
    expect(got).toHaveLength(0);
  });
});

describe('Realtime filter — relevance (no cross-country leakage)', () => {
  it('a CA-country app is relevant to a CA consultant', () => {
    expect(
      isRelevantToConsultant(
        busEvent({ destination_country: 'CA' }),
        CA_CONS,
        caCountries,
      ),
    ).toBe(true);
  });

  it('a CA-country app is NOT relevant to an AU consultant', () => {
    expect(
      isRelevantToConsultant(
        busEvent({ destination_country: 'CA' }),
        AU_CONS,
        auCountries,
      ),
    ).toBe(false);
  });

  it('an out-of-country app is still relevant if the consultant is the (prev/new) assignee', () => {
    const asNew = busEvent({
      destination_country: 'GB',
      new_consultant_id: AU_CONS,
    });
    const asPrev = busEvent({
      destination_country: 'GB',
      previous_consultant_id: AU_CONS,
    });
    expect(isRelevantToConsultant(asNew, AU_CONS, auCountries)).toBe(true);
    expect(isRelevantToConsultant(asPrev, AU_CONS, auCountries)).toBe(true);
  });

  it('a member-coded (DE) app IS relevant + visible to a SCHENGEN consultant (bloc-aware)', () => {
    const schengen = new Set(['SCHENGEN']);
    const deEvent = busEvent({
      type: 'APPLICATION_CREATED',
      destination_country: 'DE',
    });
    expect(isRelevantToConsultant(deEvent, 'cons-schengen', schengen)).toBe(
      true,
    );
    expect(computeVisibility(deEvent, 'cons-schengen', schengen)).toBe(true);
  });

  it('a non-member (CA) app is NOT relevant to a SCHENGEN consultant', () => {
    const schengen = new Set(['SCHENGEN']);
    const caEvent = busEvent({
      type: 'APPLICATION_CREATED',
      destination_country: 'CA',
    });
    expect(isRelevantToConsultant(caEvent, 'cons-schengen', schengen)).toBe(
      false,
    );
    expect(computeVisibility(caEvent, 'cons-schengen', schengen)).toBe(false);
  });
});

describe('Realtime filter — visibility per event type', () => {
  it('created/unassigned → visible when country-eligible (unassigned)', () => {
    expect(
      computeVisibility(
        busEvent({ type: 'APPLICATION_CREATED', destination_country: 'CA' }),
        CA_CONS,
        caCountries,
      ),
    ).toBe(true);
    expect(
      computeVisibility(
        busEvent({ type: 'APPLICATION_UNASSIGNED', destination_country: 'CA' }),
        CA_CONS,
        caCountries,
      ),
    ).toBe(true);
  });

  it('assigned/self-assigned/reassigned → visible only if assigned to me', () => {
    const mine = busEvent({
      type: 'APPLICATION_ASSIGNED',
      new_consultant_id: CA_CONS,
    });
    const theirs = busEvent({
      type: 'APPLICATION_ASSIGNED',
      new_consultant_id: 'someone-else',
    });
    expect(computeVisibility(mine, CA_CONS, caCountries)).toBe(true);
    expect(computeVisibility(theirs, CA_CONS, caCountries)).toBe(false);
  });

  it('toQueueEvent projects the per-consultant payload', () => {
    const e = busEvent({
      type: 'APPLICATION_SELF_ASSIGNED',
      new_consultant_id: CA_CONS,
      destination_country: 'CA',
    });
    expect(toQueueEvent(e, CA_CONS, caCountries)).toEqual({
      event_type: 'APPLICATION_SELF_ASSIGNED',
      application_id: 'app-1',
      destination_country: 'CA',
      consultant_visibility: true,
      timestamp: e.timestamp,
    });
  });
});
