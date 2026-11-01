import {
  PORTAL_FILL_PROTOCOL_VERSION,
  isPortalFillProtocolCompatible,
  type PortalFillFieldResult,
  type PortalFillMessage,
  type PortalFillPlanMessage,
  type PortalFillWriteCommand,
} from '@visaai/types';

describe('PortalFill protocol contract (Phase 7D)', () => {
  it('accepts the current protocol version', () => {
    expect(isPortalFillProtocolCompatible(PORTAL_FILL_PROTOCOL_VERSION)).toBe(
      true,
    );
  });

  it('rejects any mismatched protocol version (handshake guard)', () => {
    expect(
      isPortalFillProtocolCompatible(PORTAL_FILL_PROTOCOL_VERSION + 1),
    ).toBe(false);
    expect(isPortalFillProtocolCompatible(0)).toBe(false);
    expect(isPortalFillProtocolCompatible(999)).toBe(false);
  });

  it('discriminates messages by kind (contract shape smoke)', () => {
    const plan: PortalFillPlanMessage = {
      protocol: PORTAL_FILL_PROTOCOL_VERSION,
      kind: 'plan',
      executionId: 'e1',
      applicationId: 'a1',
      intents: [],
    };
    const write: PortalFillWriteCommand = {
      protocol: PORTAL_FILL_PROTOCOL_VERSION,
      kind: 'write',
      executionId: 'e1',
      fieldKey: 'dob',
      selector: '#dob',
      mappedValue: '2031-03-14',
      expectedValueHash: 'vh',
    };
    const result: PortalFillFieldResult = {
      protocol: PORTAL_FILL_PROTOCOL_VERSION,
      kind: 'field_result',
      executionId: 'e1',
      fieldKey: 'dob',
      outcome: 'failed',
      reason: 'value_mismatch',
      selectorFound: true,
    };
    const msgs: PortalFillMessage[] = [plan, write, result];
    expect(msgs.map((m) => m.kind)).toEqual(['plan', 'write', 'field_result']);
    expect(msgs.every((m) => isPortalFillProtocolCompatible(m.protocol))).toBe(
      true,
    );
  });
});
