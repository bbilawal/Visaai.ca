import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PATH_METADATA, METHOD_METADATA } from '@nestjs/common/constants';
import { RequestMethod } from '@nestjs/common';
import { PartnerV1Controller } from '../partner-v1.controller';
import { PartnerOAuthController } from '../partner-oauth.controller';
import { PARTNER_SCOPES_KEY } from '../partner-auth.guard';
import { ALL_SCOPES, isKnownScope } from '../partner-scopes';
import { buildPartnerOpenApi } from './partner-openapi';

/**
 * Anti-drift tests.
 *
 * A published API spec that has fallen behind the code is worse than no spec:
 * partners generate clients from it and the failure surfaces in THEIR
 * production. So the spec is not reviewed by eye — it is compared against the
 * routes Nest actually registered, by reading the decorator metadata.
 */

interface DiscoveredRoute {
  method: string;
  path: string;
  handler: string;
  scopes: string[];
}

const METHOD_NAMES: Record<number, string> = {
  [RequestMethod.GET]: 'get',
  [RequestMethod.POST]: 'post',
  [RequestMethod.PUT]: 'put',
  [RequestMethod.DELETE]: 'delete',
  [RequestMethod.PATCH]: 'patch',
};

/** Read the routes off a controller class the same way Nest does. */
function discover(
  controller: new (...args: never[]) => object,
): DiscoveredRoute[] {
  const base = Reflect.getMetadata(PATH_METADATA, controller) as string;
  const prototype = controller.prototype as Record<string, unknown>;
  const routes: DiscoveredRoute[] = [];

  for (const name of Object.getOwnPropertyNames(prototype)) {
    if (name === 'constructor') continue;
    const handler = prototype[name];
    if (typeof handler !== 'function') continue;
    const path = Reflect.getMetadata(PATH_METADATA, handler) as
      | string
      | undefined;
    const method = Reflect.getMetadata(METHOD_METADATA, handler) as
      | number
      | undefined;
    if (path === undefined || method === undefined) continue;

    const scopes =
      (Reflect.getMetadata(PARTNER_SCOPES_KEY, handler) as
        | string[]
        | undefined) ?? [];
    routes.push({
      method: METHOD_NAMES[method] ?? String(method),
      path: normalize(`/${base}/${path}`),
      handler: name,
      scopes,
    });
  }
  return routes;
}

/** `/v1/webhooks/:id` → `/v1/webhooks/{id}`, collapsing duplicate slashes. */
function normalize(path: string): string {
  return path
    .replace(/\/+/g, '/')
    .replace(/\/$/, '')
    .replace(/:([A-Za-z0-9_]+)/g, '{$1}');
}

describe('partner OpenAPI document', () => {
  const spec = buildPartnerOpenApi();
  const paths = spec.paths as Record<string, Record<string, unknown>>;

  it('is OpenAPI 3.1', () => {
    expect(spec.openapi).toBe('3.1.0');
  });

  it('declares bearer authentication', () => {
    const schemes = (spec.components as Record<string, Record<string, unknown>>)
      .securitySchemes as Record<string, { type: string; scheme: string }>;
    expect(schemes.bearerAuth).toEqual(
      expect.objectContaining({ type: 'http', scheme: 'bearer' }),
    );
  });

  // The drift test.
  it('documents every registered v1 route', () => {
    const missing = discover(PartnerV1Controller).filter(
      (route) => !paths[route.path]?.[route.method],
    );
    expect(
      missing.map((r) => `${r.method.toUpperCase()} ${r.path} (${r.handler})`),
    ).toEqual([]);
  });

  it('documents both OAuth routes that partners call', () => {
    // The two /authorize routes are the interactive consent screen, driven by
    // a signed-in user rather than a partner credential, so they are not part
    // of the partner-facing document.
    const partnerFacing = discover(PartnerOAuthController).filter(
      (r) => !r.path.endsWith('/authorize'),
    );
    const missing = partnerFacing.filter(
      (route) => !paths[route.path]?.[route.method],
    );
    expect(missing.map((r) => `${r.method} ${r.path}`)).toEqual([]);
  });

  it('does not document a route that no longer exists', () => {
    const registered = new Set(
      [
        ...discover(PartnerV1Controller),
        ...discover(PartnerOAuthController),
      ].map((r) => `${r.method} ${r.path}`),
    );
    const documented: string[] = [];
    for (const [path, operations] of Object.entries(paths)) {
      for (const method of Object.keys(operations)) {
        documented.push(`${method} ${path}`);
      }
    }
    const orphans = documented.filter((d) => !registered.has(d));
    expect(orphans).toEqual([]);
  });

  // Failures are collected into a list rather than asserted in the loop: jest's
  // `expect` takes no message argument, so a bare assertion inside a loop
  // reports "expected true, got false" with no indication of which route.
  it('gives every documented operation a summary and a tag', () => {
    const bad: string[] = [];
    for (const [path, operations] of Object.entries(paths)) {
      for (const [method, operation] of Object.entries(operations)) {
        const op = operation as { summary?: string; tags?: string[] };
        if (!op.summary) bad.push(`${method} ${path}: no summary`);
        if (!op.tags?.length) bad.push(`${method} ${path}: no tag`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('documents the error envelope on every authenticated operation', () => {
    const missing: string[] = [];
    for (const [path, operations] of Object.entries(paths)) {
      if (path.startsWith('/partner/oauth')) continue; // RFC 6749 body
      for (const [method, operation] of Object.entries(operations)) {
        const responses = (operation as { responses: Record<string, unknown> })
          .responses;
        if (!Object.keys(responses).includes('401')) {
          missing.push(`${method} ${path}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });

  it('lists every scope in the catalog', () => {
    const documented = (spec['x-scopes'] as { scope: string }[]).map(
      (s) => s.scope,
    );
    expect(documented.sort()).toEqual([...ALL_SCOPES].sort());
  });
});

describe('partner route declarations', () => {
  // Fail-closed only works if every route actually declares a scope; the guard
  // rejects undeclared routes, so a missing decorator is a 403 in production
  // rather than a leak — but it is still a bug, and this catches it first.
  it('declares a scope on every v1 route', () => {
    const undeclared = discover(PartnerV1Controller).filter(
      (r) => r.scopes.length === 0,
    );
    expect(undeclared.map((r) => r.handler)).toEqual([]);
  });

  it('declares only scopes that exist in the catalog', () => {
    const unknown: string[] = [];
    for (const route of discover(PartnerV1Controller)) {
      for (const scope of route.scopes) {
        if (!isKnownScope(scope)) unknown.push(`${route.handler}: ${scope}`);
      }
    }
    expect(unknown).toEqual([]);
  });

  // Reads must not require a write scope, and writes must not be reachable
  // with a read scope.
  it('requires a write scope for every mutating route', () => {
    const offenders = discover(PartnerV1Controller)
      .filter((r) => r.method === 'post' || r.method === 'delete')
      // Sandbox reset is operational, not a data mutation.
      .filter((r) => !r.path.startsWith('/v1/sandbox'))
      .filter((r) => !r.scopes.some((s) => s.endsWith(':write')))
      .map((r) => r.handler);
    expect(offenders).toEqual([]);
  });

  it('never requires a write scope on a GET', () => {
    const offenders = discover(PartnerV1Controller)
      .filter((r) => r.method === 'get')
      .filter((r) => r.scopes.some((s) => s.endsWith(':write')))
      .map((r) => r.handler);
    expect(offenders).toEqual([]);
  });
});

/**
 * Cross-package drift guard.
 *
 * The SDK is a separate workspace package, so a normal import would make the
 * API depend on its own client. Reading the source as text keeps the check
 * dependency-free while still failing the build if the SDK starts calling a
 * path the API does not document.
 */
describe('TypeScript SDK ↔ OpenAPI', () => {
  const sdkSource = readFileSync(
    join(__dirname, '../../../../../../packages/partner-sdk/src/client.ts'),
    'utf8',
  );
  const spec = buildPartnerOpenApi();

  // Parameter NAMES are not part of the wire contract — `/v1/x/{id}` and
  // `/v1/x/{applicationId}` are the same endpoint — so both sides are
  // collapsed to `{}` before comparing.
  const anonymise = (path: string): string => path.replace(/\{[^}]*\}/g, '{}');

  const documented = new Set(
    Object.keys(spec.paths as Record<string, unknown>).map(anonymise),
  );

  const calledPaths = (): Set<string> =>
    new Set(
      [...sdkSource.matchAll(/['"`](\/(?:v1|partner)\/[^'"`]*)['"`]/g)].map(
        (m) => anonymise(m[1].replace(/\$\{[^}]*\}/g, '{}')),
      ),
    );

  it('calls only paths the OpenAPI document declares', () => {
    const unexpected = [...calledPaths()].filter((p) => !documented.has(p));
    expect(unexpected).toEqual([]);
  });

  it('exercises a meaningful share of the documented surface', () => {
    const called = calledPaths();
    const missing = [...documented].filter((p) => !called.has(p));
    // Every documented path should be reachable from the SDK; a partner
    // forced to hand-roll a request is a partner who will get the signature,
    // retry or pagination wrong.
    expect(missing).toEqual([]);
  });
});
