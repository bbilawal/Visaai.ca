import type { PartnerScope } from '@visaai/types';
import {
  ALL_SCOPES,
  API_PRODUCTS,
  availableProducts,
  consentRequiredScopes,
  effectiveScopes,
  formatScopeString,
  hasScope,
  isKnownScope,
  isSubset,
  normalizeScopes,
  parseScopeString,
  SCOPE_CATALOG,
  scopeDefinition,
  scopesGrantableWithoutApproval,
} from './partner-scopes';

describe('scope catalog', () => {
  it('has no duplicate scopes', () => {
    expect(new Set(ALL_SCOPES).size).toBe(ALL_SCOPES.length);
  });

  it('classifies every scope that touches a user as consent-requiring', () => {
    for (const def of SCOPE_CATALOG) {
      if (def.dataClassification === 'sensitive_personal') {
        expect(def.requiresUserConsent).toBe(true);
      }
    }
  });

  // The whole point of the classification is that going live with personal
  // data is a human decision, not a self-service one.
  it('requires approval before any personal-data scope goes live', () => {
    for (const def of SCOPE_CATALOG) {
      if (
        def.dataClassification === 'personal' ||
        def.dataClassification === 'sensitive_personal'
      ) {
        expect(def.requiresApprovalForLive).toBe(true);
      }
    }
  });

  it('recognises catalog scopes and nothing else', () => {
    expect(isKnownScope('applications:read')).toBe(true);
    expect(isKnownScope('applications:delete')).toBe(false);
    expect(isKnownScope('*')).toBe(false);
    expect(isKnownScope('')).toBe(false);
  });

  it('describes every scope it recognises', () => {
    for (const scope of ALL_SCOPES) {
      expect(scopeDefinition(scope).description.length).toBeGreaterThan(10);
    }
  });
});

describe('scope normalization', () => {
  it('drops unknown scopes rather than failing the request', () => {
    expect(normalizeScopes(['applications:read', 'admin:everything'])).toEqual([
      'applications:read',
    ]);
  });

  it('de-duplicates', () => {
    expect(normalizeScopes(['usage:read', 'usage:read', 'usage:read'])).toEqual(
      ['usage:read'],
    );
  });

  it('orders by the catalog, not by the request', () => {
    expect(normalizeScopes(['usage:read', 'partner:read'])).toEqual([
      'partner:read',
      'usage:read',
    ]);
  });

  it('parses and formats the OAuth space-delimited form', () => {
    expect(parseScopeString('partner:read  usage:read')).toEqual([
      'partner:read',
      'usage:read',
    ]);
    expect(parseScopeString(undefined)).toEqual([]);
    expect(parseScopeString('')).toEqual([]);
    expect(formatScopeString(['partner:read', 'usage:read'])).toBe(
      'partner:read usage:read',
    );
  });
});

describe('effectiveScopes — narrowing only', () => {
  const held: PartnerScope[] = ['partner:read', 'usage:read'];

  it('returns the intersection of requested and held', () => {
    expect(effectiveScopes(['usage:read', 'applications:read'], held)).toEqual([
      'usage:read',
    ]);
  });

  // The invariant the whole authorization model rests on.
  it('never returns a scope the application does not hold', () => {
    const result = effectiveScopes(
      ['applications:write', 'documents:read', 'consents:read'],
      held,
    );
    expect(result).toEqual([]);
    expect(isSubset(result, held)).toBe(true);
  });

  it('defaults an empty request to everything the application holds', () => {
    expect(effectiveScopes([], held)).toEqual(held);
  });

  it('ignores unknown scopes in the request', () => {
    expect(effectiveScopes(['*', 'root', 'usage:read'], held)).toEqual([
      'usage:read',
    ]);
  });
});

describe('scope checks', () => {
  it('grants only an exact match', () => {
    expect(hasScope(['applications:read'], 'applications:read')).toBe(true);
    expect(hasScope(['applications:read'], 'applications:write')).toBe(false);
  });

  // No prefix or wildcard semantics: `applications:read` must not imply
  // `applications:write` through any string trick.
  it('does not treat a read scope as implying write', () => {
    expect(hasScope(['applications:read'], 'applications:write')).toBe(false);
    expect(isSubset(['applications:write'], ['applications:read'])).toBe(false);
  });

  it('reports subset relationships', () => {
    expect(isSubset(['usage:read'], ['usage:read', 'partner:read'])).toBe(true);
    expect(isSubset([], ['usage:read'])).toBe(true);
    expect(isSubset(['usage:read'], [])).toBe(false);
  });

  it('identifies the scopes that need user consent', () => {
    expect(
      consentRequiredScopes([
        'usage:read',
        'applications:read',
        'documents:read',
      ]),
    ).toEqual(['applications:read', 'documents:read']);
    expect(consentRequiredScopes(['usage:read'])).toEqual([]);
  });
});

describe('self-service grant rules', () => {
  it('lets a sandbox application self-grant operational scopes', () => {
    expect(
      scopesGrantableWithoutApproval(
        ['usage:read', 'webhooks:write'],
        'sandbox',
      ),
    ).toBe(true);
  });

  it('lets a sandbox application self-grant data scopes — that is what a sandbox is', () => {
    expect(
      scopesGrantableWithoutApproval(['applications:read'], 'sandbox'),
    ).toBe(true);
  });

  it('blocks a live application from self-granting a data scope', () => {
    expect(scopesGrantableWithoutApproval(['applications:read'], 'live')).toBe(
      false,
    );
  });

  it('allows live operational scopes without approval', () => {
    expect(
      scopesGrantableWithoutApproval(['partner:read', 'usage:read'], 'live'),
    ).toBe(true);
  });

  it('blocks the whole set if any one scope needs approval', () => {
    expect(
      scopesGrantableWithoutApproval(['usage:read', 'documents:read'], 'live'),
    ).toBe(false);
  });
});

describe('API product catalog', () => {
  it('gives every product a docs link and a classification', () => {
    for (const product of API_PRODUCTS) {
      expect(product.docs_url.length).toBeGreaterThan(0);
      expect(product.data_classification).toBeTruthy();
    }
  });

  // Honesty rule: a product that is not built is listed as `planned` with no
  // scopes, never as available.
  it('gives planned products no scopes and no SLO', () => {
    for (const product of API_PRODUCTS) {
      if (product.status === 'planned') {
        expect(product.required_scopes).toEqual([]);
        expect(product.slo).toBeNull();
      }
    }
  });

  it('requires consent and approval for every sensitive-personal product', () => {
    for (const product of API_PRODUCTS) {
      if (product.data_classification === 'sensitive_personal') {
        expect(product.requires_user_consent).toBe(true);
        expect(product.requires_approval).toBe(true);
      }
    }
  });

  it('only lists products the caller can actually use', () => {
    const products = availableProducts(['usage:read']);
    expect(products.map((p) => p.key)).toEqual(['usage-and-limits']);
  });

  it('never lists a planned product as available', () => {
    const products = availableProducts([...ALL_SCOPES]);
    expect(products.every((p) => p.status !== 'planned')).toBe(true);
  });

  it('references only scopes that exist', () => {
    for (const product of API_PRODUCTS) {
      for (const scope of product.required_scopes) {
        expect(isKnownScope(scope)).toBe(true);
      }
    }
  });
});
