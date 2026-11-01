# VisaAI

AI-powered immigration application copilot — helps users prepare, verify, and submit
visa applications through a structured LangGraph agent pipeline. Global platform
(Canada is a launch corridor, not a hardcoded assumption).

> **📚 Full documentation lives in [VISAAIDocs](https://github.com/bbilawal/VISAAIDocs)** —
> architecture, database, API, AI pipeline, deployment runbooks, security audits,
> feature specs, strategy, and historical records. This repo holds **code only**.

## Stack

- **`apps/web`** — Next.js 15 (App Router, React 19, Tailwind v4), Supabase auth
- **`apps/api`** — NestJS 11, LangGraph JS agents, BullMQ + Upstash Redis
- **`apps/extension`** — Chrome extension (Manifest V3), portal auto-fill
- **`apps/sidecar`** — Electron browser-automation host
- **`packages/types`** — shared TypeScript types (`@visaai/types`)
- **`supabase/migrations`** — Postgres schema (RLS), apply with `supabase db push`

## Quick start

```bash
pnpm install
cp .env.example .env          # fill in all values first

pnpm dev                      # run web + api concurrently
# or individually:
pnpm --filter web dev         # http://localhost:3000
pnpm --filter api start:dev   # http://localhost:4000
```

## Development

- Per-app `.env` files (see `.env.example`). `NEXT_PUBLIC_*` are build-time (rebuild web after changing); api env is runtime.
- Tests: `pnpm --filter api test`. Web typecheck: `pnpm --filter web exec tsc --noEmit`.
- Contributor/agent guidance: see [`CLAUDE.md`](CLAUDE.md) (kept in-repo as the concise dev guide).

## Deployment

Self-hosted on a Hostinger VPS (nginx, pm2) — **not** Vercel. `git push` does **not** deploy.
Full runbook: VISAAIDocs **`deployment/DOMAIN_MIGRATION.md`**.

## Documentation

All detailed documentation is in **[VISAAIDocs](https://github.com/bbilawal/VISAAIDocs)**.
Start with its top-level `README.md` for the full documentation map.
