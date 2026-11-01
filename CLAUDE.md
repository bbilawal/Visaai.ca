# VisaAI — Developer Guide

AI-powered immigration application copilot. Helps users prepare, verify, and submit visa applications through a structured LangGraph agent pipeline.

## Monorepo Layout

```
apps/
  web/          Next.js 15 frontend (Hostinger VPS, behind nginx → visaai.co)
  api/          NestJS backend (Hostinger VPS, behind nginx → api.visaai.co)
  extension/    Chrome extension (Manifest V3) — portal auto-fill + submission
  mobile/       Expo / React Native — iOS + Android (code-complete, not shipped)
packages/
  types/        Shared TypeScript types used by both web and api
  partner-sdk/  Published SDK for the Partner API
supabase/
  migrations/   SQL migration files — apply with `supabase db push`
```

> The Electron `sidecar/` app was **removed** in `369607e` (2026-06-02). The Chrome
> extension now handles the full submission flow against the user's own portal tab.
> Do not reintroduce references to it.

> The `supabase` CLI is not on PATH here — use `npx supabase@latest …`
> (e.g. `npx supabase@latest start` for a local stack). See OPS-002.

> **Documentation lives in a separate repo: [VISAAIDocs](https://github.com/bbilawal/VISAAIDocs)** — architecture, design system, deployment runbooks, feature specs, strategy, and historical plans/specs. This repo keeps only code + the minimal dev guidance below.

## Quick Start

```bash
pnpm install

# Run both web and api concurrently
pnpm dev

# Or individually
pnpm --filter web dev       # http://localhost:3000
pnpm --filter api start:dev # http://localhost:4000
```

Copy `.env.example` to `.env` and fill in all values before running.

## Architecture

### Frontend (`apps/web`)
- **Next.js 15** with App Router, React 19, TypeScript strict mode
- **Tailwind CSS v4** with design tokens in `globals.css`
- **Supabase** for auth (client-side) and direct DB queries (server components)
- Pages under `app/(dashboard)/` are auth-guarded via the layout
- Per-application pages: `intake → documents → narrative → readiness → submission → tracking`
- UI components live in `components/ui/` (Button, Card, Input, Badge, Skeleton)
- Layout components in `components/layout/` (Sidebar, StageNav)
- Toast notifications via `components/providers/toast-provider.tsx`

### Backend (`apps/api`)
- **NestJS 11** modular architecture
- Each feature is a self-contained module in `src/modules/` — **51 of them**, 54,538 LOC. The largest are `partner` (8,964), `consultant` (3,517), `notifications` (3,227), `documents` (2,759), `voice` (2,693), `messaging` (2,647). Full table: `VISAAIDocs/audit/COMPLETE_MODULE_INVENTORY.md`
- There is **no `monitor` module** — this line used to claim one (see step 8 below)
- Auth: Supabase JWT validation via `JwtGuard`; plan enforcement via `PlanGuard`
- AI agents: **LangGraph JS** state machines compiled in `modules/<feature>/graphs/`
- Job queue: **BullMQ** + Upstash Redis for async document OCR processing
- WebSockets: `IntakeGateway` (real-time chat) and `AutomationGateway` (browser fill)

### Database (`supabase/`)
- **Supabase PostgreSQL** with Row-Level Security on all user-owned tables
- All migrations are in `supabase/migrations/` — run `supabase db push` to apply
- Core tables: `users`, `applications`, `application_profiles`, `checklist_items`, `documents`, `vri_scores`, `generated_documents`, `post_submission_events`, `payments`

## Application Flow (User Journey)

1. **Signup / Login** → Supabase auth
2. **New Application** → select visa type → creates `application` row + starts `intake` LangGraph session
3. **Intake** → WebSocket chat with AI → builds `application_profiles` + `checklist_items`
4. **Documents** → upload files → BullMQ OCR job → `document_verifications` + `cross_verifications`
5. **Generate** → AI drafts LOE, itinerary, cover letter → user reviews/approves
6. **Readiness** → calculate VRI score across 6 dimensions → ranked recommendations
7. **Submit** → generate session token → Chrome extension auto-fills government portal
8. **Track** — ⚠️ **NOT IMPLEMENTED.** This step used to read "enable email
   monitoring → Postmark webhook ingests → AI classifies + creates action items".
   None of it exists: there is no `monitor` module, no inbound-email webhook
   route, and `postmark` is an unused dependency (0 source references — email
   actually sends over SMTP via `shared/email/email.service.ts`).
   `INBOUND_WEBHOOK_SECRET` is declared with a placeholder default and read
   nowhere. Tracked as ARCH-002.

## Design System

**Monad** system. Tokens defined in `apps/web/app/globals.css` (`@theme`, source of truth) and documented in the VISAAIDocs repo (`assets/DESIGN-2.md`).

| Token | Value |
|-------|-------|
| `paper-canvas` | `#f6f3f1` — page background, card surface |
| `ink` | `#000000` — primary text, headings, buttons, focus ring |
| `off-black` | `#242424` — hover-darken, secondary emphasis |
| `pale-stone` | `#4e4d4d` — secondary/muted text |
| `atmosphere-wash` | `#cfdaf5` — accent fill (hover/active, focus glow) |
| `hairline-2` | `rgba(0,0,0,.15)` — borders |
| `rose` | `#b53030` — errors |
| `emerald` | `#1a6b40` — success |

Legacy DESIGN-2 token names (`canvas-white`, `rich-black`, `midtone-gray`, …) survive as aliases in `@theme` mapped onto Monad values — older components still render. Prefer Monad tokens for new work.

Typography (loaded via `next/font/google` in `app/layout.tsx`): Noto Serif (display/headings), IBM Plex Mono (default UI/body), Inter (long-form copy). Sizes/weights spec'd in VISAAIDocs `assets/DESIGN-2.md`.

## Global Platform Architecture

VisaAI is a **global** immigration platform; Canada is a launch corridor, not a hardcoded assumption. See VISAAIDocs `architecture/global-platform.md`.

- **Country/visa logic** lives in `apps/api/src/strategies/` (country + visa-program strategies + registry). Adding a country/program = a strategy + one registration line; no core pipeline changes. Resolve via `strategyRegistry.resolve(country, program)`.
- **OCR is vendor-agnostic + region-aware:** `modules/documents/ocr/` (`OcrProvider` + factory: mock/openai/azure-di/aws-textract/google-docai). Business code depends on the interface only.
- **Data residency:** `DATA_RESIDENCY_MODE` = `regional | global | jurisdiction-specific`. Production refuses to boot with `global` or a non-regional OCR provider.
- **RLS:** request paths use the per-request scoped client (`SupabaseService.forUser`); `admin` (service-role) is for background/webhook/system paths only.
- **Compliance:** region-aware regimes in `strategies/compliance/`. Approval-neutral platform-wide (no guarantees, no legal advice, no auto-submission; user review required).

## Key Conventions

- **Server components** fetch from Supabase directly using `createClient()` from `lib/supabase/server`
- **Client components** call the NestJS API with `Authorization: Bearer <session.access_token>`
- All API calls require the Supabase JWT; the API validates it via `JwtGuard`
- LangGraph checkpoints are persisted to Upstash Redis via `CheckpointService` (`shared/langgraph/checkpoint.service.ts`, key `intake:checkpoint:<threadId>`, 7-day TTL)
- Shared types live in `packages/types/src/index.ts` — import as `@visaai/types`

## Environment Variables

See `.env.example` at the repo root for all required variables with descriptions.

## Deployment

**Self-hosted on a Hostinger VPS** (`2.24.196.5`, Node 20), **nginx 1.24.0** reverse proxy, **per-app `.env` files**. NOT Vercel/Railway.

**Live origins** (verified 2026-08-09): web `https://visaai.co`, api `https://api.visaai.co`.

> ⚠️ The bare hostname `srv1584195.hstgr.cloud` is **shared** — `:3000` there
> now serves a *different product* (GoQA). `api.visaai.app` has no DNS record.
> Probe `visaai.co` / `api.visaai.co`, not the hostname or the raw ports.
> The API origin port `:4000` is also reachable over plain HTTP, bypassing
> nginx and TLS — that is DEPLOY-002, not a supported entry point.

⚠️ **A push to `main` DEPLOYS.** The GitHub push webhook on the VPS runs
`/var/www/webhook/deploy-visaai.sh` (source: `scripts/webhook-deploy-visaai.sh`),
which launches `scripts/deploy-on-vps.sh --api`. `scripts/deploy-web.sh [--api]`
runs the same script by hand. Both take `/var/lock/visaai-deploy.lock`, so deploys
queue instead of racing. Builds go to `dist-staging` / `.next-staging` and are
swapped in with one restart; an unhealthy web build is rolled back to
`.next-prev` automatically. Never build in place on the VPS — that is what
crash-looped prod on every deploy until 2026-10-15. Log: `/var/log/visaai-deploy.log`.

| Service | Platform | How it deploys |
|---------|----------|----------------|
| `apps/web` | Hostinger VPS (nginx → `visaai.co`) | push to `main` → webhook → `scripts/deploy-on-vps.sh` (bakes `NEXT_PUBLIC_*`) |
| `apps/api` | Hostinger VPS (nginx → `api.visaai.co`) | same path. Env is runtime — edit `apps/api/.env` + `pm2 restart visaai-api`, no rebuild |
| Database | Self-hosted Supabase on the VPS | Manual: pipe the migration into `docker exec -i selfhosted_db psql -U supabase_admin -d postgres -1` |

Env vars live in the per-app `.env` files **on the VPS** (`<APP_DIR>/apps/api/.env`, `<APP_DIR>/apps/web/.env`), not in a cloud dashboard. `NEXT_PUBLIC_*` are build-time (rebuild web after changing); api env is runtime (restart only). See VISAAIDocs `deployment/DOMAIN_MIGRATION.md` §3+§5.
