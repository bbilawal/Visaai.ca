import {
  type ChangeRecord,
  SITE_WIDE_PREFIX,
  classifyChange,
  decodeEntities,
  deriveDisplayExcerpt,
  detectSiteWideChanges,
  extractEmbeddedJsonText,
  looksClientRendered,
  normalizeContent,
  normalizeContentPreservingCase,
  repairStrippedSpacing,
  sha256,
  stripHtml,
} from './normalize';

describe('normalizeContent', () => {
  it('is idempotent', () => {
    // The version comparison depends on this: an extractor whose second pass
    // differs would report a change against its own previous run.
    const html = '<h1>Visitor visa</h1><p>You  must   have a passport.</p>';
    const once = normalizeContent(html);
    expect(normalizeContent(once)).toBe(once);
  });

  it('produces the same hash when only a CSRF token changed', () => {
    const page = (token: string) =>
      `<html><head><meta name="csrf-token" content="${token}"></head>` +
      `<body><h1>Visitor visa</h1><p>You must have a valid passport.</p></body></html>`;
    expect(sha256(normalizeContent(page('abc123')))).toBe(
      sha256(normalizeContent(page('zzz999'))),
    );
  });

  it('produces the same hash when only an asset fingerprint changed', () => {
    const page = (hash: string) =>
      `<html><body><script src="/main.${hash}.js"></script><p>Fee: £100</p></body></html>`;
    expect(sha256(normalizeContent(page('a3f9c1')))).toBe(
      sha256(normalizeContent(page('b7d2e4'))),
    );
  });

  it('produces the same hash when only the page-review date changed', () => {
    const page = (d: string) =>
      `<p>Date modified: ${d}</p><p>You must provide proof of funds.</p>`;
    expect(sha256(normalizeContent(page('2026-08-01')))).toBe(
      sha256(normalizeContent(page('2026-08-20'))),
    );
  });

  it('produces the same hash across whitespace and attribute churn', () => {
    const a = '<p class="x">You   must\n  have\ta passport.</p>';
    const b = '<p class="y">You must have a passport.</p>';
    expect(sha256(normalizeContent(a))).toBe(sha256(normalizeContent(b)));
  });

  it('produces a DIFFERENT hash when a fee amount changes', () => {
    // The failure mode that matters more: normalizing away a real change.
    const a = '<p>The application fee is £100.</p>';
    const b = '<p>The application fee is £135.</p>';
    expect(sha256(normalizeContent(a))).not.toBe(sha256(normalizeContent(b)));
  });

  it('produces a DIFFERENT hash when a requirement is added', () => {
    const a = '<ul><li>Passport</li><li>Photo</li></ul>';
    const b =
      '<ul><li>Passport</li><li>Photo</li><li>Police certificate</li></ul>';
    expect(sha256(normalizeContent(a))).not.toBe(sha256(normalizeContent(b)));
  });

  it('preserves list structure as line breaks', () => {
    const out = normalizeContent('<ul><li>Passport</li><li>Photo</li></ul>');
    expect(out.split('\n').filter(Boolean)).toEqual(['passport', 'photo']);
  });

  it('drops script and style content entirely', () => {
    const out = normalizeContent(
      '<style>.a{color:red}</style><script>var x=1</script><p>Passport</p>',
    );
    expect(out).toBe('passport');
  });

  it('handles a plain-text source with no markup', () => {
    expect(normalizeContent('Fee: £100', 'text/plain')).toBe('fee: £100');
  });

  it('does not throw on unclosed or malformed tags', () => {
    expect(() => normalizeContent('<p>unclosed <div><li>x')).not.toThrow();
  });
});

describe('decodeEntities', () => {
  it('decodes named, decimal and hex entities', () => {
    expect(decodeEntities('&pound;100 &amp; &#163;200 &#x41;')).toBe(
      '£100 & £200 A',
    );
  });

  /**
   * The one that was published. ImmD writes "fiancé/fiancée" as
   * `fianc&eacute;/fianc&eacute;e`; the entity was absent from the table, so it
   * survived normalization as literal markup and reached three Hong Kong pages
   * inside a quotation attributed to a government.
   */
  it('decodes the Latin-1 letters a government page actually uses', () => {
    expect(decodeEntities('fianc&eacute;/fianc&eacute;e')).toBe(
      'fiancé/fiancée',
    );
    expect(decodeEntities('S&atilde;o Tom&eacute;')).toBe('São Tomé');
    expect(decodeEntities('C&ocirc;te d&rsquo;Ivoire')).toBe('Côte d’Ivoire');
    expect(decodeEntities('T&uuml;rkiye')).toBe('Türkiye');
  });

  /**
   * A guard rather than a list. Whatever the table covers, normalized output
   * must not carry an entity reference onward — that is the shape of the defect,
   * independent of which entity caused it.
   */
  it('leaves no entity reference in normalized output', () => {
    const html =
      '<p>fianc&eacute;/fianc&eacute;e, caf&eacute;, na&iuml;ve, &pound;100, ' +
      '&ldquo;quoted&rdquo;, &hellip; &mdash; &nbsp;end</p>';
    expect(normalizeContent(html)).not.toMatch(/&[a-z][a-z0-9]*;/i);
  });
});

describe('stripHtml', () => {
  it('removes comments, which can hide markup churn', () => {
    expect(stripHtml('<!-- build 4821 --><p>Passport</p>').trim()).toContain(
      'Passport',
    );
    expect(stripHtml('<!-- build 4821 --><p>Passport</p>')).not.toContain(
      '4821',
    );
  });
});

describe('classifyChange', () => {
  const norm = (s: string) => normalizeContent(s);

  it('calls an identical page cosmetic and does not require review', () => {
    const a = norm('<p>You must have a passport.</p>');
    const c = classifyChange(a, a);
    expect(c.classification).toBe('cosmetic');
    expect(c.requiresReview).toBe(false);
  });

  it('calls a pure reorder cosmetic', () => {
    const a = norm('<ul><li>Passport</li><li>Photo</li></ul>');
    const b = norm('<ul><li>Photo</li><li>Passport</li></ul>');
    expect(classifyChange(a, b).classification).toBe('cosmetic');
  });

  it('calls a fee change material and escalates it', () => {
    const a = norm('<p>The fee is £100.</p>');
    const b = norm('<p>The fee is £135.</p>');
    const c = classifyChange(a, b);
    expect(c.classification).toBe('material');
    expect(c.requiresReview).toBe(true);
    expect(c.escalationReasons.join(' ')).toMatch(/monetary|fee/);
  });

  it('escalates a new mandatory document', () => {
    const a = norm('<ul><li>Passport</li></ul>');
    const b = norm(
      '<ul><li>Passport</li><li>You must provide a police certificate</li></ul>',
    );
    const c = classifyChange(a, b);
    expect(c.classification).toBe('material');
    expect(c.escalationReasons.length).toBeGreaterThan(0);
  });

  it('escalates a route that appears to have been discontinued', () => {
    const a = norm('<p>This visa is open for applications.</p>');
    const b = norm('<p>This route is closed to new applicants.</p>');
    expect(classifyChange(a, b).classification).toBe('material');
  });

  it('escalates a changed official form identifier', () => {
    const a = norm('<p>Complete form IMM 5257.</p>');
    const b = norm('<p>Complete form IMM 5257 and IMM 5645.</p>');
    expect(classifyChange(a, b).classification).toBe('material');
  });

  it('calls a wording tweak editorial and auto-promotes it', () => {
    const a = norm('<p>Welcome to the visa information hub.</p>');
    const b = norm('<p>Welcome to our visa information hub.</p>');
    const c = classifyChange(a, b);
    expect(c.classification).toBe('editorial');
    expect(c.requiresReview).toBe(false);
  });

  it('calls a mass deletion structural even without material wording', () => {
    // Usually a restructure or a partial fetch. Either way a person looks
    // before requirements are re-derived from it.
    const a = norm(
      '<ul>' +
        Array.from({ length: 30 }, (_, i) => `<li>Item ${i}</li>`).join('') +
        '</ul>',
    );
    const b = norm('<ul><li>Item 0</li></ul>');
    const c = classifyChange(a, b);
    expect(c.classification).toBe('structural');
    expect(c.requiresReview).toBe(true);
  });

  it('reports what changed rather than only that something did', () => {
    const a = norm('<p>Passport required.</p>');
    const b = norm('<p>Passport required.</p><p>Insurance required.</p>');
    const c = classifyChange(a, b);
    expect(c.addedLines).toContain('insurance required.');
    expect(c.summary).toContain('added');
  });

  it('caps the reported diff so one huge change cannot flood the review queue', () => {
    const a = norm('<p>x</p>');
    const b = norm(
      Array.from(
        { length: 500 },
        (_, i) => `<p>Line ${i} must be provided</p>`,
      ).join(''),
    );
    expect(classifyChange(a, b).addedLines.length).toBeLessThanOrEqual(50);
  });
});

describe('extractEmbeddedJsonText — client-rendered pages', () => {
  /**
   * The failure this closes: immi.homeaffairs.gov.au serves ~2k of navigation
   * chrome and keeps every Australian visa requirement in a doubly-escaped JSON
   * blob in a hidden input. Without extraction the monitor normalizes those
   * pages to boilerplate and reports "unchanged" forever — a source that looks
   * monitored while telling us nothing, which is worse than one that visibly
   * fails.
   */
  const embed = (id: string, json: string) =>
    `<html><body><nav>Home About Contact</nav>` +
    `<input type="hidden" id="${id}" value="${json.replace(/"/g, '&quot;')}" />` +
    `</body></html>`;

  it('reads the Home Affairs hidden field', () => {
    const html = embed(
      'ctl00_PlaceHolderMain_PageSchemaHiddenField_Input',
      JSON.stringify({
        title: 'Student visa',
        body: 'You must hold overseas student health cover',
      }),
    );
    const out = extractEmbeddedJsonText(html);
    expect(out).toContain('Student visa');
    expect(out).toContain('overseas student health cover');
  });

  it('handles double HTML escaping', () => {
    // The real payload is HTML-escaped JSON whose strings are themselves
    // HTML-escaped. One decode leaves &quot; inside and JSON.parse fails.
    const inner = JSON.stringify({ text: 'fees are &amp;pound;100' });
    const html = embed(
      'ctl00_PlaceHolderMain_PageSchemaHiddenField_Input',
      inner,
    );
    expect(extractEmbeddedJsonText(html)).toContain('100');
  });

  it('reads a Next.js script payload too', () => {
    const html =
      `<html><body><script id="__NEXT_DATA__" type="application/json">` +
      `{"props":{"requirement":"You must have a valid passport"}}</script></body></html>`;
    expect(extractEmbeddedJsonText(html)).toContain('valid passport');
  });

  it('drops keys, numbers and booleans, keeping only string leaves', () => {
    // A key name is markup by another route, and a JSON reordering would
    // otherwise read as a content change.
    const html = embed(
      'ctl00_PlaceHolderMain_PageSchemaHiddenField_Input',
      JSON.stringify({
        currentActor: 1,
        multipleActors: false,
        description: 'Visit Australia to study',
      }),
    );
    const out = extractEmbeddedJsonText(html)!;
    expect(out).toContain('Visit Australia to study');
    expect(out).not.toContain('currentActor');
    expect(out).not.toContain('false');
  });

  it('drops identifier-length strings', () => {
    const html = embed(
      'ctl00_PlaceHolderMain_PageSchemaHiddenField_Input',
      JSON.stringify({ a: 'x', b: 'id', c: 'You must be in good health' }),
    );
    const out = extractEmbeddedJsonText(html)!;
    expect(out).toContain('good health');
    expect(out.split('\n')).not.toContain('x');
  });

  it('returns null when there is no embedded payload', () => {
    expect(
      extractEmbeddedJsonText('<p>An ordinary server-rendered page</p>'),
    ).toBeNull();
  });

  it('returns null rather than throwing on an unparseable payload', () => {
    expect(
      extractEmbeddedJsonText(embed('__NEXT_DATA__', '{not json')),
    ).toBeNull();
  });

  it('normalizeContent prefers the payload over the chrome', () => {
    const html = embed(
      'ctl00_PlaceHolderMain_PageSchemaHiddenField_Input',
      JSON.stringify({
        req: 'You must have enough money for your stay in Australia',
      }),
    );
    const out = normalizeContent(html, 'text/html');
    expect(out).toContain('enough money for your stay');
    // The nav chrome is not what the diff should see.
    expect(out).not.toContain('about contact');
  });

  it('leaves a server-rendered page untouched', () => {
    // The extraction must not change behaviour for canada.ca or gov.uk, which
    // are 55 of the 78 reachable sources.
    const html =
      '<h1>Visitor visa</h1><p>You must have a valid travel document.</p>';
    // Byte-for-byte the pre-extraction output, blank line included: the closing
    // </h1> and opening <p> each emit a newline. Asserted exactly, because the
    // point is that adding embedded-payload extraction changed NOTHING for the
    // 55 server-rendered sources on canada.ca and gov.uk.
    expect(normalizeContent(html, 'text/html')).toBe(
      'visitor visa\n\nyou must have a valid travel document.',
    );
  });

  it('a payload change is still detected as a change', () => {
    const a = normalizeContent(
      embed('__NEXT_DATA__', JSON.stringify({ fee: 'The fee is 100 dollars' })),
      'text/html',
    );
    const b = normalizeContent(
      embed('__NEXT_DATA__', JSON.stringify({ fee: 'The fee is 250 dollars' })),
      'text/html',
    );
    expect(sha256(a)).not.toBe(sha256(b));
    expect(classifyChange(a, b).classification).toBe('material');
  });
});

describe('detectSiteWideChanges', () => {
  const rec = (
    id: string,
    source_id: string,
    added: string[],
    removed: string[] = [],
    escalation_reasons: string[] | null = ['obligation wording changed'],
  ): ChangeRecord => ({
    id,
    source_id,
    escalation_reasons,
    diff: { added, removed },
  });

  /**
   * The real 2026-08-24 shape: INZ added the same service banner to several
   * pages, and every one escalated as material on words inside the banner.
   */
  it('flags a banner added to several pages, and says nothing was removed', () => {
    const banner = [
      'planned upgrade',
      'from 08:00 to 21:00 sunday 23 august (nzst), you cannot access some applications and online forms.',
      'call 0508 558 855 (toll free from nz landlines)',
    ];
    const out = detectSiteWideChanges([
      rec('c1', 's1', banner),
      rec('c2', 's2', banner),
      rec('c3', 's3', banner),
    ]);

    expect(out).toHaveLength(3);
    for (const o of out) {
      const note = o.escalationReasons.find((r) =>
        r.startsWith(SITE_WIDE_PREFIX),
      );
      expect(note).toBeDefined();
      expect(note).toContain('3 added line(s)');
      expect(note).toContain('2 other source(s)');
      // The original escalation must survive — this annotates, it does not clear.
      expect(o.escalationReasons).toContain('obligation wording changed');
    }
  });

  /**
   * The whole point of the "every line" test. One page also gained a line of
   * its own, so its text DID change and it must not be written off as chrome.
   */
  it('does not flag a page that gained even one line of its own', () => {
    const banner = [
      'planned upgrade',
      'call 0508 558 855 (toll free from nz landlines)',
    ];
    const out = detectSiteWideChanges([
      rec('c1', 's1', banner),
      rec('c2', 's2', [
        ...banner,
        'you must now provide biometrics at a collection point.',
      ]),
    ]);

    expect(out.map((o) => o.id)).toEqual(['c1']);
  });

  /** A deletion is never chrome: something the page used to say is gone. */
  it('does not flag a change that removed anything', () => {
    const banner = [
      'planned upgrade',
      'call 0508 558 855 (toll free from nz landlines)',
    ];
    const out = detectSiteWideChanges([
      rec('c1', 's1', banner, ['applicants aged 18 to 30 may apply.']),
      rec('c2', 's2', banner),
    ]);

    expect(out.map((o) => o.id)).toEqual(['c2']);
  });

  /** A single change has nothing to be compared against. */
  it('needs at least two changes to say anything', () => {
    expect(
      detectSiteWideChanges([rec('c1', 's1', ['planned upgrade'])]),
    ).toEqual([]);
  });

  /** Two pages of ONE source is not evidence of a site-wide edit. */
  it('counts distinct sources, not change rows', () => {
    const banner = ['planned upgrade'];
    const out = detectSiteWideChanges([
      rec('c1', 's1', banner),
      rec('c2', 's1', banner),
    ]);
    expect(out).toEqual([]);
  });

  /**
   * The interaction bug between two fixes, found on production 2026-08-24.
   *
   * `classifyChange` caps the stored diff at 50 lines so one huge change cannot
   * flood the review queue. `detectSiteWideChanges` then read that sample and
   * claimed "ALL added lines also appeared on other sources" — a claim it
   * cannot support from the first 50 of 426. Eight New Zealand changes filed
   * that day reported 426, 370, 311 and 284 added lines with fifty stored.
   *
   * A hedged annotation would be worse than none, because the value of this
   * note is that a reviewer can act on it. So a truncated diff declines.
   */
  it('declines when the diff it can see is only a sample', () => {
    const banner = [
      'planned upgrade',
      'call 0508 558 855 (toll free from nz landlines)',
    ];
    const truncated = (id: string, source_id: string): ChangeRecord => ({
      id,
      source_id,
      escalation_reasons: ['obligation wording changed'],
      diff: { added: banner, removed: [], added_total: 426 },
    });
    expect(
      detectSiteWideChanges([truncated('c1', 's1'), truncated('c2', 's2')]),
    ).toEqual([]);
  });

  /** A complete diff of the same shape still annotates. */
  it('still annotates when it can see the whole diff', () => {
    const banner = [
      'planned upgrade',
      'call 0508 558 855 (toll free from nz landlines)',
    ];
    const complete = (id: string, source_id: string): ChangeRecord => ({
      id,
      source_id,
      escalation_reasons: ['obligation wording changed'],
      diff: { added: banner, removed: [], added_total: banner.length },
    });
    const out = detectSiteWideChanges([
      complete('c1', 's1'),
      complete('c2', 's2'),
    ]);
    expect(out).toHaveLength(2);
  });

  /**
   * Records written before the counts were stored have no `added_total`. A full
   * 50 is exactly what the cap produces, so it is treated as suspect.
   */
  it('treats a legacy record at the cap as truncated', () => {
    const fifty = Array.from({ length: 50 }, (_, i) => `shared line ${i}`);
    const legacy = (id: string, source_id: string): ChangeRecord => ({
      id,
      source_id,
      escalation_reasons: [],
      diff: { added: fifty, removed: [] },
    });
    expect(
      detectSiteWideChanges([legacy('c1', 's1'), legacy('c2', 's2')]),
    ).toEqual([]);
  });

  /** Re-running a sync must not stack the same note twice. */
  it('does not add the note twice', () => {
    const banner = ['planned upgrade'];
    const already = [`${SITE_WIDE_PREFIX} all 1 added line(s) ...`];
    const out = detectSiteWideChanges([
      rec('c1', 's1', banner, [], already),
      rec('c2', 's2', banner, [], already),
    ]);
    expect(out).toEqual([]);
  });
});

describe('normalizeContentPreservingCase', () => {
  const page = `
    <html><body>
      <h1>Visitor Visa</h1>
      <p>You must: have a valid <a href="/doc">travel document</a>, like a passport.</p>
      <p>The fee is £135 (per applicant).</p>
    </body></html>`;

  /**
   * The invariant the whole display-excerpt mechanism rests on. If this ever
   * fails, deriveDisplayExcerpt is slicing one string by offsets found in a
   * different one.
   */
  it('differs from normalizeContent ONLY by case', () => {
    expect(normalizeContentPreservingCase(page).toLowerCase()).toBe(
      normalizeContent(page),
    );
    expect(normalizeContentPreservingCase(page)).toHaveLength(
      normalizeContent(page).length,
    );
  });

  it('keeps the authority capitalisation the monitor throws away', () => {
    expect(normalizeContentPreservingCase(page)).toContain('You must');
    expect(normalizeContent(page)).toContain('you must');
  });
});

describe('repairStrippedSpacing', () => {
  it('closes the space an inline tag left before punctuation', () => {
    expect(
      repairStrippedSpacing('a valid travel document , like a passport'),
    ).toBe('a valid travel document, like a passport');
  });

  it('closes brackets too', () => {
    expect(repairStrippedSpacing('the fee is £135 ( per applicant )')).toBe(
      'the fee is £135 (per applicant)',
    );
  });

  it('leaves ordinary text alone', () => {
    const s = 'you must have a valid passport, and proof of funds.';
    expect(repairStrippedSpacing(s)).toBe(s);
  });
});

describe('deriveDisplayExcerpt', () => {
  const page = `
    <html><body>
      <p>You must: have a valid <a href="/d">travel document</a>, like a passport.</p>
      <p>Applicants MUST be aged 18 or over.</p>
      <p>you must: have a valid travel document, like a passport.</p>
    </body></html>`;
  const lower = normalizeContent(page);
  const cased = normalizeContentPreservingCase(page);

  it('restores the authority capitalisation and repairs the stripped space', () => {
    const stored = 'you must: have a valid travel document , like a passport.';
    expect(deriveDisplayExcerpt(stored, lower, cased)).toBe(
      'You must: have a valid travel document, like a passport.',
    );
  });

  it('preserves shouty capitalisation rather than prettifying it', () => {
    expect(
      deriveDisplayExcerpt('applicants must be aged 18 or over.', lower, cased),
    ).toBe('Applicants MUST be aged 18 or over.');
  });

  /**
   * A declared elision must survive as a declared elision. Silently joining the
   * fragments would assert an adjacency the page does not have.
   */
  it('keeps a declared elision', () => {
    const stored =
      'you must: have a valid travel document ... applicants must be aged 18 or over.';
    expect(deriveDisplayExcerpt(stored, lower, cased)).toBe(
      'You must: have a valid travel document ... Applicants MUST be aged 18 or over.',
    );
  });

  /**
   * Two identical sentences differing only in case: the FIRST match wins, and
   * that is the one the monitor matched too, because both searches run over the
   * same lowercased string.
   */
  it('takes the same occurrence the matching excerpt did', () => {
    const stored = 'like a passport.';
    // The first occurrence is inside the capitalised sentence.
    expect(deriveDisplayExcerpt(stored, lower, cased)).toBe('like a passport.');
  });

  it('returns null when the excerpt is not on the page', () => {
    expect(
      deriveDisplayExcerpt('you must own a boat', lower, cased),
    ).toBeNull();
  });

  /**
   * The refusal that keeps this honest. If the reconstruction disagrees with the
   * text the excerpt was matched against, the offsets describe a string nobody
   * searched, and a slice would return a plausible span from somewhere else.
   */
  it('refuses when the reconstruction disagrees with the matched text', () => {
    expect(
      deriveDisplayExcerpt('you must', lower, cased + ' extra'),
    ).toBeNull();
  });

  /**
   * The regression that cost Finland every quotation it had.
   *
   * A single Turkish dotted capital `İ` lowercases to TWO code units, and one
   * of them on migri.fi shifted every later offset. The first version required
   * equal lengths and refused all 24 Finnish requirements. The offset map
   * recovers the text on the other side of it.
   */
  it('survives a character that expands when lowercased', () => {
    const page =
      '<p>İstanbul office</p>' +
      '<p>You must hold a valid residence permit.</p>';
    const l = normalizeContent(page);
    const c = normalizeContentPreservingCase(page);
    expect(l.length).not.toBe(c.length); // the condition the old check refused on
    expect(
      deriveDisplayExcerpt('you must hold a valid residence permit.', l, c),
    ).toBe('You must hold a valid residence permit.');
  });
});

describe('looksClientRendered', () => {
  // The page that motivated it: esta.cbp.dhs.gov serves 2,355 bytes whose body
  // is one Angular mount element and three script tags. It filed a parse_error
  // on every run — 34 in a week — in the bucket that means "a VisaAI bug".
  const ESTA_SHELL = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>ESTA</title></head>
<body>
  <app-root ngcspnonce="abc"></app-root>
<script src="polyfills.js" type="module"></script><script src="main.js" defer></script></body></html>`;

  it('recognises a script-rendered shell', () => {
    expect(looksClientRendered(ESTA_SHELL)).toBe(true);
    expect(normalizeContent(ESTA_SHELL, 'text/html')).toBe('');
  });

  it('does not excuse a page that has real text', () => {
    const real = `<html><body><h1>Visitor visa</h1><p>You must hold a passport.</p>
      <script src="analytics.js"></script></body></html>`;
    expect(looksClientRendered(real)).toBe(false);
  });

  it('does not excuse an empty body with no script to explain it', () => {
    // Nothing rendered it, so nothing accounts for the emptiness. That is our
    // problem until proven otherwise — wrong in the safe direction.
    expect(looksClientRendered('<html><body>   </body></html>')).toBe(false);
  });

  it('does not excuse a body carrying only entity references', () => {
    // Undecoded entities would leave letters behind and read as content that is
    // not there — the mistake the raw-quote probe made twice before it was right.
    const entitiesOnly = `<html><body><div>&nbsp;&mdash;</div><script src="a.js"></script></body></html>`;
    expect(looksClientRendered(entitiesOnly)).toBe(true);
  });

  it('does not excuse a fragment with no document structure', () => {
    // A truncated or non-HTML response is a fetch/parse problem, not evidence
    // about how the site renders.
    expect(looksClientRendered('<script src="a.js"></script>')).toBe(false);
  });

  it('ignores text that only appears inside script or style', () => {
    const scriptText = `<html><body><div></div>
      <style>.a{content:"Visitor visa"}</style>
      <script>var page = "You must hold a passport";</script></body></html>`;
    expect(looksClientRendered(scriptText)).toBe(true);
  });
});

describe('stripHtml with `>` inside attribute values', () => {
  // B-31. `<[^>]+>` ends the tag at the first `>`, so a `>` inside a quoted
  // attribute left the rest of that attribute in the text. Found on icp.gov.ae
  // while preparing the UAE extraction — Tailwind arbitrary variants put `>`
  // in class names routinely — and caught before any excerpt was published
  // from it.
  it('does not leak a Tailwind arbitrary variant into the text', () => {
    const html = `<div class="[&>div]:p-3 [&>div]:w-72 lg:flex"><p>You must hold a valid passport.</p></div>`;
    const out = normalizeContent(html, 'text/html');
    expect(out).toBe('you must hold a valid passport.');
    expect(out).not.toContain('lg:flex');
    expect(out).not.toContain(']:p-3');
  });

  it('handles single-quoted attributes too', () => {
    const html = `<span data-x='a > b'>Fee is AED 100.</span>`;
    expect(normalizeContent(html, 'text/html')).toBe('fee is aed 100.');
  });

  it('still drops a script whose attributes contain >', () => {
    const html = `<div><script data-cfg="{'a':'>'}">var x = "requirement";</script><p>Real text.</p></div>`;
    const out = normalizeContent(html, 'text/html');
    expect(out).toBe('real text.');
    expect(out).not.toContain('var x');
  });

  it('leaves ordinary markup working exactly as before', () => {
    // Two newlines, not one: `</li><li>` emits a break for each tag. That is
    // pre-existing behaviour and the point of this test is that the attribute
    // fix did not disturb it — my first expectation here was wrong, not the code.
    const html = `<ul><li>Passport</li><li>Photo</li></ul>`;
    expect(normalizeContent(html, 'text/html')).toBe('passport\n\nphoto');
  });

  it('does not treat a bare > in TEXT as markup', () => {
    // A greater-than sign is legitimate content — "stay > 90 days".
    const html = `<p>Stay &gt; 90 days requires a permit.</p>`;
    expect(normalizeContent(html, 'text/html')).toBe(
      'stay > 90 days requires a permit.',
    );
  });
});

describe('stripHtml with UNBALANCED quotes in a tag (B-34)', () => {
  // B-31's matcher walks COMPLETE quoted strings, which assumes the source
  // closes every quote it opens. Two live authorities do not:
  //
  //   en.nia.gov.cn  <a href="https://beian.miit.gov.cn/"" target="_blank">
  //   general-security.gov.lb  <span  New Roman","serif"">
  //
  // Both are a style/href attribute whose own value contains double quotes, so
  // the quoting is invalid. The balanced-only matcher cannot reach the tag's
  // `>` and the whole tag survives into the text — markup inside a quotation
  // attributed to a government, which is the B-26 failure a third time.

  it('strips a tag whose attribute has a doubled quote', () => {
    const html = `<p><a href="https://beian.miit.gov.cn/"" target="_blank">ICP</a> Real text.</p>`;
    const out = normalizeContent(html, 'text/html');
    expect(out).not.toContain('href');
    expect(out).not.toContain('beian');
    expect(out).toContain('real text.');
  });

  it('strips the malformed span found on general-security.gov.lb', () => {
    const html = `<p><span  New Roman","serif"">Those who have been given an order to leave the country</span></p>`;
    const out = normalizeContent(html, 'text/html');
    expect(out).toBe('those who have been given an order to leave the country');
    expect(out).not.toContain('serif');
    expect(out).not.toContain('<span');
  });

  it('strips a tag with a single unterminated quote', () => {
    const html = `<div class="unclosed><p>Passport required.</p></div>`;
    const out = normalizeContent(html, 'text/html');
    expect(out).not.toContain('class=');
    expect(out).toContain('passport required.');
  });

  it('STILL honours a > inside a properly quoted attribute', () => {
    // The B-31 guarantee must survive the fix: a real `>` in a quoted value is
    // not the tag terminator.
    const html = `<div class="[&>div]:p-3 lg:flex"><p>You must hold a valid passport.</p></div>`;
    const out = normalizeContent(html, 'text/html');
    expect(out).toBe('you must hold a valid passport.');
    expect(out).not.toContain('lg:flex');
  });

  it('RECOVERS text an unbalanced quote was swallowing', () => {
    // The regression that matters most. A first attempt at this fix let any
    // unmatched quote be ordinary, which let the quoted alternative run to the
    // next `"` further down the page and delete everything between. Measured on
    // general-security.gov.lb/en/posts/497 it removed 5,384 characters and three
    // numbered requirement items. Text loss is worse than markup residue,
    // because no downstream check can see an absence.
    const html =
      `<p  0in 8pt"><b><span  New Roman","serif"">11-</span></b>` +
      `<span  New Roman","serif""> First item.</span></p>` +
      `<p  0in 8pt"><b><span  New Roman","serif"">12-</span></b>` +
      `<span  New Roman","serif""> Second item.</span></p>`;
    const out = normalizeContent(html, 'text/html');
    expect(out).toContain('11-');
    expect(out).toContain('first item.');
    expect(out).toContain('12-');
    expect(out).toContain('second item.');
    expect(out).not.toContain('serif');
    expect(out).not.toContain('<span');
  });

  it('treats a quote NOT preceded by = as an ordinary character', () => {
    // `<p  0in 8pt">` is a mangled style attribute. The quote opens no value,
    // so the tag ends at its own `>` and the paragraph text survives.
    const html = `<p  0in 8pt">Passport required.</p><p>Second sentence.</p>`;
    const out = normalizeContent(html, 'text/html');
    expect(out).toContain('passport required.');
    expect(out).toContain('second sentence.');
    expect(out).not.toContain('8pt');
  });

  it('does not run away across the whole document on an odd quote', () => {
    // The risk of loosening the matcher is the opposite failure: swallowing
    // real text after an unbalanced quote. The sentence after the bad tag must
    // survive intact.
    const html = `<p><span style="font:"x"">First requirement.</span></p><p>Second requirement.</p>`;
    const out = normalizeContent(html, 'text/html');
    expect(out).toContain('first requirement.');
    expect(out).toContain('second requirement.');
  });
});
