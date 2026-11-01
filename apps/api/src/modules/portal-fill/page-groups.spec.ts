import type { SignedWriteIntent } from '@visaai/types';
import { selectPageGroups } from './page-groups';

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
