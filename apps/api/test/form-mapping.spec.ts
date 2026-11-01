/**
 * Form Mapping Layer + VisaProgramRegistry: forms come from the program strategy
 * and renderers resolve by code through the registry (no hardcoded form in core).
 */
import '../src/modules/prefill/forms'; // registers the Canada IMM 5257 renderer
import { strategyRegistry, visaProgramRegistry } from '../src/strategies';
import {
  isFormRendererRegistered,
  resolveFormRenderer,
} from '../src/strategies/form-mapping/form-renderer.registry';

describe('form mapping', () => {
  it('Canada visitor program declares IMM 5257 via strategy', () => {
    const trv = strategyRegistry.resolve('CA', 'visitor_visa')!;
    const codes = (trv.program.forms?.() ?? []).map((f) => f.formCode);
    expect(codes).toContain('IMM 5257');
  });

  it('resolves a renderer by form code (registered by the Canada module)', () => {
    expect(isFormRendererRegistered('IMM 5257')).toBe(true);
    expect(isFormRendererRegistered('imm5257')).toBe(true); // normalized
    expect(typeof resolveFormRenderer('IMM 5257')).toBe('function');
  });

  it('returns no renderer for an unregistered form (caller falls back)', () => {
    expect(isFormRendererRegistered('DS-160')).toBe(false);
    expect(resolveFormRenderer('DS-160')).toBeUndefined();
  });
});

describe('VisaProgramRegistry', () => {
  it('builds a program by id for any country', () => {
    const p = visaProgramRegistry.build('visitor_visa', 'JP', {
      label: 'Japan Visitor',
    });
    expect(p.id).toBe('visitor_visa');
    expect(p.country).toBe('JP');
    expect(p.requiredDocuments().length).toBeGreaterThan(0);
  });

  it('lists the built-in program types', () => {
    expect(visaProgramRegistry.list()).toEqual(
      expect.arrayContaining([
        'visitor_visa',
        'tourist_visa',
        'business_visa',
        'student_visa',
        'work_permit',
        'family_sponsorship',
      ]),
    );
  });
});
