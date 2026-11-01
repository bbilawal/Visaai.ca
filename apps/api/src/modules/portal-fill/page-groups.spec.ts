import type { SignedWriteIntent } from '@visaai/types';
import { pageMatches, selectPageGroups } from './page-groups';

const intent = (selector: string, page?: string): SignedWriteIntent => ({
  executionId: 'e',
  fieldKey: selector.slice(1),
  ...(page ? { page } : {}),
  selector,
  mappedValue: 'v',
  expectedValueHash: 'h',
  category: 'passport',
  lockedDiffHash: 'l',
  sig: 's',
});
const probe = (found: string[], all: string[]) =>
  all.map((selector) => ({ selector, found: found.includes(selector) }));

const BIO = [
  intent('#lastName_input', '/bio-data'),
  intent('#year', '/bio-data'),
];
const PURPOSE = [intent('#visitDetails', '/purpose')];
const ALL = [...PURPOSE, ...BIO];
const SELS = ALL.map((i) => i.selector);

describe('selectPageGroups', () => {
  it('runs only the page group that is fully present', () => {
    const r = selectPageGroups(ALL, probe(['#visitDetails'], SELS));
    expect(r).toEqual({ ok: true, intents: PURPOSE, pages: ['/purpose'] });
  });

  it('refuses a half-matched page (representative page shares #lastName_input)', () => {
    const r = selectPageGroups(ALL, probe(['#lastName_input'], SELS));
    expect(r).toEqual({
      ok: false,
      reason: 'partial_page',
      missing: ['#year'],
    });
  });

  it('refuses a page with none of the mapped fields', () => {
    const r = selectPageGroups(ALL, probe([], SELS));
    expect(r).toMatchObject({ ok: false, reason: 'none_present' });
  });

  it('keeps the old all-or-nothing rule for page-less mappings', () => {
    const legacy = [intent('#a'), intent('#b')];
    expect(selectPageGroups(legacy, probe(['#a'], ['#a', '#b']))).toMatchObject(
      {
        ok: false,
        reason: 'partial_page',
      },
    );
    expect(
      selectPageGroups(legacy, probe(['#a', '#b'], ['#a', '#b'])),
    ).toMatchObject({
      ok: true,
      intents: legacy,
    });
  });
});

describe('selectPageGroups — by the open page (protocol 2)', () => {
  const FAMILY = [
    intent('#currentMaritalStatus_radio-button-01-input', '/family-info'),
    {
      ...intent('#lastName_input', '/family-info'),
      fieldKey: 'spouse_family_name',
      reveal: true,
    },
  ];
  const BIO2 = [
    intent('#lastName_input', '/bio-data'),
    intent('#year', '/bio-data'),
  ];
  const CHILDREN = [
    intent('#hasChild_radio-button-01-input', '/family-info-children'),
    {
      ...intent('main button[id*="add"]', '/family-info-children'),
      reveal: true,
    },
    {
      ...intent('#lastName_input', '/family-info-children'),
      fieldKey: 'ircc_child_1_family_name',
      dialog: true,
    },
  ];
  const all = [...BIO2, ...FAMILY, ...CHILDREN];

  it('runs the group for the URL path, though another page shares its ids', () => {
    // On /family-info, #lastName_input (the spouse) resolves — and is also a
    // /bio-data selector. Without the path that half-match refused the run.
    const r = selectPageGroups(
      all,
      probe(
        ['#currentMaritalStatus_radio-button-01-input', '#lastName_input'],
        all.map((i) => i.selector),
      ),
      '/family-info',
    );
    expect(r).toEqual({ ok: true, intents: FAMILY, pages: ['/family-info'] });
  });

  it('does not probe revealed or dialog targets (they appear during the run)', () => {
    const r = selectPageGroups(
      all,
      probe(
        ['#hasChild_radio-button-01-input'],
        all.map((i) => i.selector),
      ),
      '/x/family-info-children/',
    );
    expect(r).toEqual({
      ok: true,
      intents: CHILDREN,
      pages: ['/family-info-children'],
    });
  });

  it('refuses the open page when one of its own load-time targets is missing', () => {
    const r = selectPageGroups(
      all,
      probe(
        [],
        all.map((i) => i.selector),
      ),
      '/family-info',
    );
    expect(r).toEqual({
      ok: false,
      reason: 'partial_page',
      missing: ['#currentMaritalStatus_radio-button-01-input'],
    });
  });

  it('a page with no mapping fills nothing, even if ids from other pages resolve', () => {
    const r = selectPageGroups(
      all,
      probe(
        ['#lastName_input', '#year'],
        all.map((i) => i.selector),
      ),
      '/representative',
    );
    expect(r).toMatchObject({ ok: false, reason: 'none_present' });
  });

  it('"/bio-data" is not "/bio-data-travel-docs"', () => {
    const r = selectPageGroups(
      BIO2,
      probe(
        ['#lastName_input', '#year'],
        BIO2.map((i) => i.selector),
      ),
      '/bio-data-travel-docs',
    );
    expect(r).toMatchObject({ ok: false, reason: 'none_present' });
  });
});

/**
 * A progressive page (IRCC eTA: one path, questions revealed as earlier ones
 * are answered and as the applicant presses Next) cannot be all-or-nothing:
 * most of its targets are not on the page yet. What is on the page now runs;
 * the rest waits.
 */
describe('selectPageGroups — a progressive page', () => {
  const ETA = '/eta/welcome';
  const E = [
    intent('#rep', ETA),
    intent('#docType', ETA),
    intent('#citizenship', ETA),
  ];
  const SEL = E.map((i) => i.selector);
  const progressive = (p: string) => p === ETA;

  it('runs the targets present now and lists the ones still waiting', () => {
    const r = selectPageGroups(E, probe(['#rep'], SEL), ETA, progressive);
    expect(r).toEqual({
      ok: true,
      intents: [E[0]],
      pages: [ETA],
      waiting: [E[1], E[2]],
    });
  });

  it('with nothing present yet, fills nothing', () => {
    const r = selectPageGroups(E, probe([], SEL), ETA, progressive);
    expect(r).toMatchObject({ ok: false, reason: 'none_present' });
  });

  it('a multi-page portal keeps the all-or-nothing rule', () => {
    const r = selectPageGroups(
      BIO,
      probe(['#lastName_input'], SELS),
      '/bio-data',
      progressive,
    );
    expect(r).toMatchObject({ ok: false, reason: 'partial_page' });
  });
});

describe('selectPageGroups — a progressive screen whose list lacks the answer', () => {
  const intent = (selector: string): SignedWriteIntent =>
    ({
      executionId: 'e',
      fieldKey: selector,
      page: '/eapp/eapp',
      selector,
      mappedValue: 'v',
      expectedValueHash: 'h',
      category: 'passport',
      lockedDiffHash: 'l',
      sig: 's',
    }) as SignedWriteIntent;

  it('refuses the whole screen up front (nothing on it is written)', () => {
    const r = selectPageGroups(
      [intent('a'), intent('b'), intent('c')],
      [
        { selector: 'a', found: true },
        { selector: 'b', found: false, optionMissing: true },
        { selector: 'c', found: false },
      ],
      '/eapp/eapp',
      () => true,
    );
    expect(r).toEqual({ ok: false, reason: 'option_missing', missing: ['b'] });
  });

  it('without a missing option the present ones run as before', () => {
    const r = selectPageGroups(
      [intent('a'), intent('c')],
      [
        { selector: 'a', found: true },
        { selector: 'c', found: false },
      ],
      '/eapp/eapp',
      () => true,
    );
    expect(r.ok && r.intents.map((i) => i.selector)).toEqual(['a']);
  });
});

describe('pageMatches', () => {
  it('matches a page by its path suffix, segment-wise', () => {
    expect(pageMatches('/en/x/nationality', '/nationality')).toBe(true);
    expect(pageMatches('/en/x/nationality/', '/nationality')).toBe(true);
    expect(pageMatches('/en/x/foo-nationality', '/nationality')).toBe(false);
    expect(
      pageMatches('/en/application/case/1/imm0008/page3', '/imm0008/page3'),
    ).toBe(true);
    expect(
      pageMatches('/en/application/case/1/imm0008/page3', '/imm0008/page2'),
    ).toBe(false);
  });

  // IRCC's Permanent Residence Portal puts the application id in the path.
  it('a * segment stands for exactly one path segment', () => {
    const page = '/application/profile/*';
    expect(pageMatches('/en/application/profile/4989734', page)).toBe(true);
    expect(pageMatches('/en/application/profile/4989734/', page)).toBe(true);
    expect(pageMatches('/en/application/profile', page)).toBe(false);
    expect(pageMatches('/en/application/profile/1/extra', page)).toBe(false);
    expect(pageMatches('/en/application/case/4989734', page)).toBe(false);
    expect(pageMatches('/fr/application/profile/7', page)).toBe(true);
  });
});
