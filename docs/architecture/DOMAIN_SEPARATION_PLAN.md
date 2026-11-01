# `visaai.co` / `visaai.ca` separation plan

## Decision

Keep one monorepo and one shared API/database. Deploy the web package twice:

| Host | Build mode | Public scope | Canonical site URL |
|---|---|---|---|
| `visaai.co` | `global` | All published countries | `https://visaai.co` |
| `visaai.ca` | `canada` | Canada (`CA`) only | `https://visaai.ca` |

This gives Canada its own acquisition/SEO surface without copying the product,
forking migrations, or creating two incompatible user/application stores.

The scope is enforced in the web build at the public registry boundary. The
Canada build filters country discovery, public visa registry pages, sitemap
entries, and the new-application country picker to `CA`. It does not pretend
that a browser-controlled build is an authorization boundary; the API remains
the source of truth for supported destinations and user access.

## Repository changes

- `apps/web/lib/site-config.ts` defines `NEXT_PUBLIC_SITE_MODE` and the country
  scope.
- `apps/web/lib/visa-registry.ts` applies the scope before public pages and
  sitemaps render data.
- `apps/web/lib/use-supported-countries.ts` applies the same scope to the
  client-side application picker.
- `apps/web/app/[locale]/layout.tsx` changes Canada metadata and Open Graph
  identity.
- `apps/api/src/config/web-origins.ts` allows one API to serve both web origins
  via `WEB_URL` plus optional comma-separated `WEB_URLS`.
- `deploy/nginx/visaai.co.conf` routes both apex/www domains to the web proxy.

## Claude agent work breakdown

The installed Claude agent definitions under `~/.claude/agents` map to these
bounded workstreams. Run them sequentially where they touch the same files:

1. **Codebase Onboarding Engineer** — trace the Next.js proxy, public visa
   routes, registry, API origin, and deployment scripts; produce the file map
   before edits.
2. **Immigration Platform Architect** — confirm that Canada is a web/site
   scope over the existing country strategy registry, not a second database or
   hardcoded replacement for global country logic.
3. **Frontend Developer** — implement `site-config`, Canada public filtering,
   metadata, and unit coverage. Own only `apps/web`.
4. **DevOps Automator** — prepare the nginx, PM2, TLS, DNS, and two-build
   rollout. Own only `deploy/` and deployment documentation.
5. **Security Engineer** — review CORS, redirect allow-lists, certificate
   coverage, host confusion, and accidental cross-site data exposure.
6. **Code Reviewer** — review the final diff for correctness, API compatibility,
   regression coverage, and rollback safety.

The agent definitions are advisory role instructions; production actions still
require an operator with DNS/VPS/provider access.

## Deployment sequence

1. DNS: point `visaai.ca` and `www.visaai.ca` A records at the same VPS as
   `visaai.co`. Do not point `api.visaai.ca` at the web process unless a second
   API origin is intentionally being created.
2. TLS: issue a certificate covering `visaai.ca` and `www.visaai.ca` (and keep
   the existing `.co` names). Run `nginx -t` before reload.
3. Create a second web release directory or worktree on the VPS. It must have
   its own `.next` output and process; two modes cannot safely share one build.
4. Build the Canadian release with:

   ```bash
   NEXT_PUBLIC_SITE_MODE=canada \
   NEXT_PUBLIC_SITE_URL=https://visaai.ca \
   NEXT_PUBLIC_API_URL=https://api.visaai.co \
   pnpm --filter web build
   ```

5. Run that build on a second loopback port, for example `127.0.0.1:3001`,
   under a separate PM2 process such as `visaai-web-ca`.
6. Add an nginx server block for `visaai.ca` that proxies to `127.0.0.1:3001`.
   Keep `visaai.co` on the existing process/port until Canadian smoke tests
   pass.
7. Set the shared API environment to:

   ```dotenv
   WEB_URL=https://visaai.co
   WEB_URLS=https://visaai.ca
   ```

   Restart the API after changing runtime environment. No API rebuild is
   required for this setting.
8. Add `https://visaai.ca/callback` and the required wildcard callback URL to
   the Supabase Auth redirect allow-list. Add both domains to any OAuth provider
   allow-lists and configure a verified sender such as `no-reply@visaai.ca` if
   Canada mail should be branded separately.

## Verification gates

Run before cutover:

```bash
pnpm --filter web test:unit
NEXT_PUBLIC_SITE_MODE=canada NEXT_PUBLIC_SITE_URL=https://visaai.ca pnpm --filter web build
NEXT_PUBLIC_SITE_MODE=global NEXT_PUBLIC_SITE_URL=https://visaai.co pnpm --filter web build
pnpm --filter api build
```

Then verify both deployments:

- `visaai.co/visas` contains the global destination set.
- `visaai.ca/visas` contains Canada and no non-Canada country links.
- `visaai.ca/sitemap.xml` contains only Canadian visa URLs and uses
  `https://visaai.ca` as its origin.
- `visaai.ca/robots.txt` points to the Canadian sitemap.
- `visaai.ca/applications/new` offers Canada only.
- Login, callback, intake WebSocket, document upload, and API requests work
  from both origins.
- `curl -sI` for both apex/www hosts shows HTTPS, no redirect loop, and the
  expected canonical host.

## Rollback

DNS remains unchanged during the first deploy. If any Canadian gate fails,
remove only the `.ca` nginx block/reload nginx and stop `visaai-web-ca`; the
existing `.co` process and data remain untouched. Do not roll back database
migrations because this change adds none.

## Not included in this code change

DNS registrar changes, certificate issuance, VPS process creation, Supabase
redirect configuration, OAuth allow-lists, email-domain verification, and
production deployment require operator credentials and must be completed on
the host/provider using the sequence above.
