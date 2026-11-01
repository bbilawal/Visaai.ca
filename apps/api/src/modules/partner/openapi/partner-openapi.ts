import { API_PRODUCTS, SCOPE_CATALOG } from '../partner-scopes';
import { SUBSCRIBABLE_EVENTS } from '../partner-webhook.service';
import { CURRENT_API_VERSION, MAX_PAGE_SIZE } from '../partner-governance';

/**
 * The authoritative OpenAPI 3.1 description of the partner API.
 *
 * Built in TypeScript from the same constants the runtime uses — the scope
 * catalog, the event list, the page-size cap — rather than hand-maintained as
 * YAML. A hand-written spec is a second source of truth that drifts the moment
 * someone adds a scope, and a wrong spec is worse than none: an SDK generated
 * from it fails in the partner's production, not ours.
 *
 * `partner-openapi.spec.ts` asserts that every route actually registered on
 * the controller appears here, so adding an endpoint without documenting it
 * fails the build.
 */

const SECURITY = [{ bearerAuth: [] }];

function errorResponses(...codes: number[]): Record<string, unknown> {
  const catalog: Record<number, string> = {
    400: 'Invalid request',
    401: 'Missing or invalid credential',
    403: 'Insufficient scope, consent or permission',
    404: 'Not found',
    409: 'Conflict',
    413: 'Payload too large',
    429: 'Rate limit or quota exceeded',
    500: 'Internal error',
  };
  const out: Record<string, unknown> = {};
  for (const code of codes) {
    out[String(code)] = {
      description: catalog[code] ?? 'Error',
      content: {
        'application/json': { schema: { $ref: '#/components/schemas/Error' } },
      },
    };
  }
  return out;
}

function ok(
  schemaRef: string,
  description = 'Success',
): Record<string, unknown> {
  return {
    '200': {
      description,
      content: { 'application/json': { schema: { $ref: schemaRef } } },
    },
  };
}

const CURSOR_PARAMS = [
  {
    name: 'limit',
    in: 'query',
    required: false,
    schema: {
      type: 'integer',
      minimum: 1,
      maximum: MAX_PAGE_SIZE,
      default: 25,
    },
    description: `Page size. Values above ${MAX_PAGE_SIZE} are clamped.`,
  },
  {
    name: 'cursor',
    in: 'query',
    required: false,
    schema: { type: 'string' },
    description: 'Opaque cursor from `next_cursor` on the previous page.',
  },
];

const IDEMPOTENCY_HEADER = {
  name: 'Idempotency-Key',
  in: 'header',
  required: false,
  schema: { type: 'string', maxLength: 255 },
  description:
    'Optional. Replaying the same key with the same body returns the original response instead of repeating the operation.',
};

export function buildPartnerOpenApi(): Record<string, unknown> {
  return {
    openapi: '3.1.0',
    info: {
      title: 'VisaAI Partner API',
      version: CURRENT_API_VERSION,
      description: [
        'The VisaAI Partner API lets approved organizations integrate with the',
        'immigration platform.',
        '',
        'Authentication is an API key or an OAuth 2.0 access token, presented as',
        '`Authorization: Bearer <credential>`. Every endpoint requires a scope;',
        'anything touching a user’s immigration data additionally requires that',
        'user’s recorded consent.',
        '',
        'Two environments. Sandbox credentials (`vak_test_…`) read synthetic data',
        'and can never reach production records.',
      ].join('\n'),
      contact: {
        name: 'VisaAI Partner Support',
        email: 'partners@visaai.example',
      },
    },
    servers: [
      { url: 'https://api.visaai.example', description: 'Production' },
      {
        url: 'http://localhost:4000',
        description: 'Local development',
      },
    ],
    tags: [
      { name: 'Identity', description: 'Who you are calling as' },
      { name: 'Usage', description: 'Rate limits and quotas' },
      { name: 'Webhooks', description: 'Event subscriptions and deliveries' },
      {
        name: 'Applications',
        description: 'Visa applications (consent required)',
      },
      {
        name: 'Documents',
        description: 'Document metadata (consent required)',
      },
      {
        name: 'Consents',
        description: 'Users who authorized your application',
      },
      { name: 'Sandbox', description: 'Synthetic data and reset' },
      { name: 'OAuth', description: 'Token issuance and revocation' },
    ],
    security: SECURITY,
    paths: {
      '/partner/oauth/token': {
        post: {
          tags: ['OAuth'],
          summary: 'Issue an access token',
          description:
            'Supports `client_credentials` and `authorization_code` (PKCE, S256 only). The password and implicit grants are not supported.',
          security: [],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/TokenRequest' },
              },
            },
          },
          responses: {
            ...ok('#/components/schemas/TokenResponse', 'Token issued'),
            '400': {
              description: 'OAuth error (RFC 6749 body)',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/OAuthError' },
                },
              },
            },
            '401': {
              description: 'Client authentication failed',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/OAuthError' },
                },
              },
            },
          },
        },
      },
      '/partner/oauth/revoke': {
        post: {
          tags: ['OAuth'],
          summary: 'Revoke an access token',
          description:
            'Always returns 200, per RFC 7009, so the endpoint cannot be used to test whether a token is live.',
          security: [],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['client_id', 'client_secret', 'token'],
                  properties: {
                    client_id: { type: 'string' },
                    client_secret: { type: 'string' },
                    token: { type: 'string' },
                  },
                },
              },
            },
          },
          responses: { '200': { description: 'Acknowledged' } },
        },
      },
      '/v1/me': {
        get: {
          tags: ['Identity'],
          summary: 'Describe the calling credential',
          responses: {
            ...ok('#/components/schemas/Identity'),
            ...errorResponses(401, 403, 429),
          },
        },
      },
      '/v1/catalog': {
        get: {
          tags: ['Identity'],
          summary: 'List API products',
          responses: {
            ...ok('#/components/schemas/Catalog'),
            ...errorResponses(401, 403, 429),
          },
        },
      },
      '/v1/usage': {
        get: {
          tags: ['Usage'],
          summary: 'Current rate-limit and quota state',
          responses: {
            ...ok('#/components/schemas/Usage'),
            ...errorResponses(401, 403, 429),
          },
        },
      },
      '/v1/webhooks/events': {
        get: {
          tags: ['Webhooks'],
          summary: 'List subscribable event types',
          responses: {
            ...ok('#/components/schemas/EventTypeList'),
            ...errorResponses(401, 403, 429),
          },
        },
      },
      '/v1/webhooks': {
        get: {
          tags: ['Webhooks'],
          summary: 'List webhook endpoints',
          responses: {
            ...ok('#/components/schemas/EndpointList'),
            ...errorResponses(401, 403, 429),
          },
        },
        post: {
          tags: ['Webhooks'],
          summary: 'Register a webhook endpoint',
          description:
            'Returns the signing secret exactly once. The endpoint starts in `pending_verification` and must be verified before it receives events.',
          parameters: [IDEMPOTENCY_HEADER],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/CreateEndpoint' },
              },
            },
          },
          responses: {
            ...ok(
              '#/components/schemas/CreatedEndpoint',
              'Endpoint registered',
            ),
            ...errorResponses(400, 401, 403, 409, 429),
          },
        },
      },
      '/v1/webhooks/{id}': {
        post: {
          tags: ['Webhooks'],
          summary: 'Replace the event subscription',
          parameters: [pathId()],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['events'],
                  properties: {
                    events: { type: 'array', items: { type: 'string' } },
                  },
                },
              },
            },
          },
          responses: {
            ...ok('#/components/schemas/Endpoint'),
            ...errorResponses(400, 401, 403, 404, 429),
          },
        },
        delete: {
          tags: ['Webhooks'],
          summary: 'Delete a webhook endpoint',
          parameters: [pathId()],
          responses: {
            '200': { description: 'Deleted' },
            ...errorResponses(401, 403, 404, 429),
          },
        },
      },
      '/v1/webhooks/{id}/verify': {
        post: {
          tags: ['Webhooks'],
          summary: 'Verify endpoint ownership',
          description:
            'We POST `{"type":"endpoint.verification","challenge":"…"}`. Respond 2xx echoing the challenge value.',
          parameters: [pathId()],
          responses: {
            ...ok('#/components/schemas/Endpoint', 'Verified and active'),
            ...errorResponses(401, 403, 404, 409, 429),
          },
        },
      },
      '/v1/webhooks/{id}/rotate-secret': {
        post: {
          tags: ['Webhooks'],
          summary: 'Rotate the signing secret',
          description:
            'The previous secret keeps signing alongside the new one until `previousValidUntil`, so you can roll your verifier without dropping events.',
          parameters: [pathId()],
          responses: {
            ...ok('#/components/schemas/RotatedSecret'),
            ...errorResponses(401, 403, 404, 429),
          },
        },
      },
      '/v1/webhooks/{id}/deliveries': {
        get: {
          tags: ['Webhooks'],
          summary: 'List delivery attempts',
          parameters: [pathId(), ...CURSOR_PARAMS],
          responses: {
            ...ok('#/components/schemas/DeliveryPage'),
            ...errorResponses(400, 401, 403, 404, 429),
          },
        },
      },
      '/v1/webhooks/{id}/deliveries/{deliveryId}/replay': {
        post: {
          tags: ['Webhooks'],
          summary: 'Replay a delivery',
          parameters: [pathId(), pathId('deliveryId')],
          responses: {
            ...ok('#/components/schemas/Delivery'),
            ...errorResponses(401, 403, 404, 429),
          },
        },
      },
      '/v1/applications': {
        get: {
          tags: ['Applications'],
          summary: "List a consenting user's applications",
          parameters: [
            {
              name: 'user_id',
              in: 'query',
              required: false,
              schema: { type: 'string', format: 'uuid' },
              description:
                'Required for client-credentials tokens. Omitted for user-consented tokens, which already name their subject.',
            },
          ],
          responses: {
            ...ok('#/components/schemas/ApplicationList'),
            ...errorResponses(400, 401, 403, 429),
          },
        },
        post: {
          tags: ['Applications'],
          summary: 'Create an application for a consenting user',
          parameters: [IDEMPOTENCY_HEADER],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/CreateApplication' },
              },
            },
          },
          responses: {
            ...ok('#/components/schemas/Application', 'Created'),
            ...errorResponses(400, 401, 403, 409, 429),
          },
        },
      },
      '/v1/applications/{id}': {
        get: {
          tags: ['Applications'],
          summary: 'Read one application',
          parameters: [pathId()],
          responses: {
            ...ok('#/components/schemas/Application'),
            ...errorResponses(401, 403, 404, 429),
          },
        },
      },
      '/v1/applications/{id}/documents': {
        get: {
          tags: ['Documents'],
          summary: 'List document metadata',
          description:
            'Metadata and processing status only. Document contents and extracted field values are never returned.',
          parameters: [pathId()],
          responses: {
            ...ok('#/components/schemas/DocumentList'),
            ...errorResponses(401, 403, 404, 429),
          },
        },
      },
      '/v1/consents': {
        get: {
          tags: ['Consents'],
          summary: 'List users who authorized your application',
          parameters: CURSOR_PARAMS,
          responses: {
            ...ok('#/components/schemas/ConsentPage'),
            ...errorResponses(400, 401, 403, 429),
          },
        },
      },
      '/v1/sandbox/personas': {
        get: {
          tags: ['Sandbox'],
          summary: 'List sandbox personas',
          responses: {
            ...ok('#/components/schemas/PersonaList'),
            ...errorResponses(401, 403, 429),
          },
        },
      },
      '/v1/sandbox/reset': {
        post: {
          tags: ['Sandbox'],
          summary: 'Reset sandbox data',
          description:
            'Deletes all sandbox resources and re-seeds the personas.',
          responses: {
            ...ok('#/components/schemas/SandboxReset'),
            ...errorResponses(401, 403, 429),
          },
        },
      },
    },
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          description:
            'An API key (`vak_live_…` / `vak_test_…`) or an OAuth access token (`vat_…`).',
        },
      },
      schemas: {
        Error: {
          type: 'object',
          required: ['error'],
          properties: {
            error: {
              type: 'object',
              required: ['type', 'code', 'message', 'request_id'],
              properties: {
                type: {
                  type: 'string',
                  enum: [
                    'invalid_request',
                    'authentication_error',
                    'permission_error',
                    'not_found',
                    'conflict',
                    'rate_limit_error',
                    'quota_exceeded',
                    'api_error',
                  ],
                },
                code: { type: 'string' },
                message: { type: 'string' },
                request_id: { type: 'string' },
                retry_after: { type: 'integer' },
                param: { type: 'string' },
                doc_url: { type: 'string' },
              },
            },
          },
        },
        OAuthError: {
          type: 'object',
          required: ['error', 'error_description'],
          properties: {
            error: { type: 'string' },
            error_description: { type: 'string' },
          },
        },
        TokenRequest: {
          type: 'object',
          required: ['grant_type', 'client_id'],
          properties: {
            grant_type: {
              type: 'string',
              enum: ['client_credentials', 'authorization_code'],
            },
            client_id: { type: 'string' },
            client_secret: { type: 'string' },
            scope: {
              type: 'string',
              description: `Space-delimited. Known scopes: ${SCOPE_CATALOG.map((s) => s.scope).join(', ')}`,
            },
            code: { type: 'string' },
            redirect_uri: { type: 'string' },
            code_verifier: { type: 'string' },
          },
        },
        TokenResponse: {
          type: 'object',
          required: ['access_token', 'token_type', 'expires_in', 'scope'],
          properties: {
            access_token: { type: 'string' },
            token_type: { type: 'string', enum: ['Bearer'] },
            expires_in: { type: 'integer' },
            scope: { type: 'string' },
          },
        },
        Identity: {
          type: 'object',
          properties: {
            client_id: { type: 'string' },
            application_id: { type: 'string', format: 'uuid' },
            environment: { type: 'string', enum: ['sandbox', 'live'] },
            scopes: { type: 'array', items: { type: 'string' } },
            credential_kind: {
              type: 'string',
              enum: ['api_key', 'oauth_token'],
            },
            subject_user_id: { type: ['string', 'null'], format: 'uuid' },
            api_version: { type: 'string' },
          },
        },
        ApiProduct: {
          type: 'object',
          properties: {
            key: { type: 'string' },
            name: { type: 'string' },
            description: { type: 'string' },
            required_scopes: { type: 'array', items: { type: 'string' } },
            data_classification: {
              type: 'string',
              enum: ['public', 'internal', 'personal', 'sensitive_personal'],
            },
            environments: { type: 'array', items: { type: 'string' } },
            status: {
              type: 'string',
              enum: ['ga', 'beta', 'planned', 'deprecated'],
            },
            requires_user_consent: { type: 'boolean' },
            requires_approval: { type: 'boolean' },
            slo: {
              type: ['object', 'null'],
              properties: {
                availability: { type: 'string' },
                p95_latency_ms: { type: 'integer' },
              },
            },
            docs_url: { type: 'string' },
          },
        },
        Catalog: {
          type: 'object',
          properties: {
            available: {
              type: 'array',
              items: { $ref: '#/components/schemas/ApiProduct' },
            },
            all: {
              type: 'array',
              items: { $ref: '#/components/schemas/ApiProduct' },
            },
          },
        },
        Usage: {
          type: 'object',
          properties: {
            environment: { type: 'string', enum: ['sandbox', 'live'] },
            rate_limit: { $ref: '#/components/schemas/Window' },
            quota_day: { $ref: '#/components/schemas/QuotaWindow' },
            quota_month: { $ref: '#/components/schemas/QuotaWindow' },
          },
        },
        Window: {
          type: 'object',
          properties: {
            limit: { type: 'integer', description: '0 means unlimited.' },
            remaining: { type: 'integer' },
            reset_at: { type: 'string', format: 'date-time' },
          },
        },
        QuotaWindow: {
          type: 'object',
          properties: {
            limit: { type: 'integer', description: '0 means unlimited.' },
            used: { type: 'integer' },
            remaining: { type: 'integer' },
            reset_at: { type: 'string', format: 'date-time' },
          },
        },
        EventTypeList: {
          type: 'object',
          properties: {
            data: {
              type: 'array',
              items: { type: 'string', enum: [...SUBSCRIBABLE_EVENTS] },
            },
          },
        },
        Endpoint: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            url: { type: 'string' },
            description: { type: ['string', 'null'] },
            events: { type: 'array', items: { type: 'string' } },
            status: {
              type: 'string',
              enum: ['pending_verification', 'active', 'disabled'],
            },
            consecutive_failures: { type: 'integer' },
            disabled_reason: { type: ['string', 'null'] },
            created_at: { type: 'string', format: 'date-time' },
          },
        },
        EndpointList: {
          type: 'array',
          items: { $ref: '#/components/schemas/Endpoint' },
        },
        CreateEndpoint: {
          type: 'object',
          required: ['url', 'events'],
          properties: {
            url: {
              type: 'string',
              description:
                'Absolute https URL. Private, loopback and link-local destinations are rejected.',
            },
            events: { type: 'array', items: { type: 'string' }, minItems: 1 },
            description: { type: 'string' },
          },
        },
        CreatedEndpoint: {
          type: 'object',
          properties: {
            endpoint: { $ref: '#/components/schemas/Endpoint' },
            secret: {
              type: 'string',
              description:
                'Signing secret. Shown once and never retrievable again.',
            },
          },
        },
        RotatedSecret: {
          type: 'object',
          properties: {
            secret: { type: 'string' },
            previousValidUntil: { type: 'string', format: 'date-time' },
          },
        },
        Delivery: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            event_id: { type: 'string', format: 'uuid' },
            event_type: { type: 'string' },
            status: {
              type: 'string',
              enum: ['pending', 'delivering', 'delivered', 'failed', 'dead'],
            },
            attempt_count: { type: 'integer' },
            next_attempt_at: { type: 'string', format: 'date-time' },
            last_status_code: { type: ['integer', 'null'] },
            last_error: { type: ['string', 'null'] },
            delivered_at: { type: ['string', 'null'], format: 'date-time' },
            created_at: { type: 'string', format: 'date-time' },
          },
        },
        DeliveryPage: {
          type: 'object',
          properties: {
            data: {
              type: 'array',
              items: { $ref: '#/components/schemas/Delivery' },
            },
            has_more: { type: 'boolean' },
            next_cursor: { type: ['string', 'null'] },
          },
        },
        Application: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            user_id: { type: 'string', format: 'uuid' },
            status: {
              type: 'string',
              enum: ['draft', 'ready', 'submitted', 'decided'],
            },
            framework_id: { type: ['string', 'null'], format: 'uuid' },
            readiness_score: {
              type: ['integer', 'null'],
              minimum: 0,
              maximum: 100,
            },
            submitted_at: { type: ['string', 'null'], format: 'date-time' },
            decided_at: { type: ['string', 'null'], format: 'date-time' },
            created_at: { type: 'string', format: 'date-time' },
          },
        },
        ApplicationList: {
          type: 'array',
          items: { $ref: '#/components/schemas/Application' },
        },
        CreateApplication: {
          type: 'object',
          properties: {
            user_id: { type: 'string', format: 'uuid' },
            country: { type: 'string', minLength: 2, maxLength: 2 },
            visa_type: { type: 'string' },
            framework_id: { type: 'string', format: 'uuid' },
          },
        },
        Document: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            application_id: { type: 'string', format: 'uuid' },
            file_name: { type: 'string' },
            mime_type: { type: 'string' },
            upload_status: {
              type: 'string',
              enum: ['pending', 'complete', 'failed'],
            },
            processing_status: {
              type: 'string',
              enum: ['pending', 'complete', 'failed'],
            },
            created_at: { type: 'string', format: 'date-time' },
          },
        },
        DocumentList: {
          type: 'array',
          items: { $ref: '#/components/schemas/Document' },
        },
        ConsentPage: {
          type: 'object',
          properties: {
            data: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  user_id: { type: 'string', format: 'uuid' },
                  scopes: { type: 'array', items: { type: 'string' } },
                  granted_at: { type: 'string', format: 'date-time' },
                },
              },
            },
            has_more: { type: 'boolean' },
            next_cursor: { type: ['string', 'null'] },
          },
        },
        PersonaList: {
          type: 'object',
          properties: {
            data: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  key: { type: 'string' },
                  name: { type: 'string' },
                  email: { type: 'string' },
                  description: { type: 'string' },
                  country: { type: 'string' },
                  visa_type: { type: 'string' },
                  expected_outcome: { type: 'string' },
                },
              },
            },
          },
        },
        SandboxReset: {
          type: 'object',
          properties: { deleted: { type: 'integer' } },
        },
        WebhookPayload: {
          type: 'object',
          description:
            'The signed body delivered to your endpoint. Verify `V-Signature` before trusting it.',
          properties: {
            id: { type: 'string', format: 'uuid' },
            type: { type: 'string', enum: [...SUBSCRIBABLE_EVENTS] },
            created_at: { type: 'string', format: 'date-time' },
            environment: { type: 'string', enum: ['sandbox', 'live'] },
            sequence: { type: 'integer' },
            data: { type: 'object', additionalProperties: true },
          },
        },
      },
    },
    'x-scopes': SCOPE_CATALOG.map((s) => ({
      scope: s.scope,
      description: s.description,
      requires_user_consent: s.requiresUserConsent,
      data_classification: s.dataClassification,
    })),
    'x-products': API_PRODUCTS.map((p) => ({ key: p.key, status: p.status })),
  };
}

function pathId(name = 'id'): Record<string, unknown> {
  return {
    name,
    in: 'path',
    required: true,
    schema: { type: 'string', format: 'uuid' },
  };
}
