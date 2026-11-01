/**
 * ============================================================================
 * EXAMPLE — REVIEW BEFORE USE. NOT a drop-in file.
 * ============================================================================
 * VisaAI pm2 process manifest for the Hostinger VPS (srv1584195.hstgr.cloud).
 *
 * This file is a documentation artifact under docs/production/. It is NOT wired
 * into a deploy hook. To adopt it, copy to the repo root as `ecosystem.config.js`
 * (or keep it here and reference the path explicitly), review every value, then:
 *
 *   pm2 start docs/production/vps-hardening/ecosystem.config.js
 *   pm2 save                      # persist across reboots
 *   pm2 startup                   # print the systemd unit command; run it once
 *
 * ---------------------------------------------------------------------------
 * PREREQUISITE CODE CHANGE for the api/worker split (see README §2).
 * ---------------------------------------------------------------------------
 * Today ALL BullMQ workers run IN-PROCESS with the HTTP API (every @Processor
 * class is registered in AppModule and starts a BullMQ Worker the moment Nest
 * boots). There is no APP_ROLE flag yet, so:
 *
 *   - Running two copies of `dist/main.js` gives you 2× HTTP servers AND
 *     2× worker sets. That is NOT what the split below intends.
 *
 * Before enabling the separate `visaai-worker` process you MUST add role gating
 * in the app (example in README §2): `APP_ROLE=api` skips processor registration
 * and serves HTTP; `APP_ROLE=worker` registers processors and does NOT call
 * app.listen(). Until that lands, use the "Phase 0 (combined)" block below and
 * keep the api/worker blocks commented out.
 * ============================================================================
 */

// Absolute app root on the VPS. Adjust to your checkout path.
const APP_DIR = '/var/www/visaai';

// Shared log-rotation is handled by the pm2-logrotate module (see README §6),
// not per-app here. These paths just keep streams separate and greppable.
const logBase = `${APP_DIR}/logs`;

module.exports = {
  apps: [
    // ------------------------------------------------------------------
    // PHASE 0 (TODAY — no code change): ONE combined process.
    // This mirrors current behaviour: HTTP API + all in-process BullMQ
    // workers in a single Node process. Safe to run as-is. Delete this
    // block once the APP_ROLE split (below) is wired and validated.
    // ------------------------------------------------------------------
    {
      name: 'visaai-api',
      cwd: `${APP_DIR}/apps/api`,
      script: 'dist/main.js',
      // fork + 1 instance is MANDATORY until horizontal-scaling blockers are
      // fixed (README §7). socket.io has no Redis adapter and progress dedup is
      // process-local, so a 2nd instance = missed WS events + duplicate
      // analytics. Do NOT switch to cluster / instances>1 yet.
      exec_mode: 'fork',
      instances: 1,
      // Runtime env is read from apps/api/.env by the app itself (dotenv in
      // main.ts). Keep secrets OUT of this file. Only non-secret process knobs here.
      env: {
        NODE_ENV: 'production',
        // APP_ROLE: 'all',  // <- once role gating exists, 'all' = api + workers
      },
      max_memory_restart: '900M',
      // Give in-flight OCR / WS a moment to drain on reload (pairs with the
      // graceful-shutdown code change in README §7 / k8s doc).
      kill_timeout: 10000,
      wait_ready: false, // set true once the app calls process.send('ready')
      out_file: `${logBase}/api-out.log`,
      error_file: `${logBase}/api-err.log`,
      merge_logs: true,
      time: true,
    },

    // ------------------------------------------------------------------
    // TARGET SPLIT (requires APP_ROLE gating — see README §2). Uncomment the
    // three blocks below and DELETE the combined block above once the code
    // change is merged and deployed.
    // ------------------------------------------------------------------

    // {
    //   name: 'visaai-api',
    //   cwd: `${APP_DIR}/apps/api`,
    //   script: 'dist/main.js',
    //   exec_mode: 'fork',           // NOT cluster — see README §7
    //   instances: 1,
    //   env: { NODE_ENV: 'production', APP_ROLE: 'api' },
    //   max_memory_restart: '700M',
    //   kill_timeout: 10000,
    //   out_file: `${logBase}/api-out.log`,
    //   error_file: `${logBase}/api-err.log`,
    //   merge_logs: true,
    //   time: true,
    // },
    // {
    //   name: 'visaai-worker',
    //   cwd: `${APP_DIR}/apps/api`,
    //   script: 'dist/main.js',
    //   exec_mode: 'fork',
    //   // BullMQ distributes jobs across workers via Redis, so worker instances
    //   // >1 IS safe for throughput — every processor here must already be
    //   // idempotent (they read/write Supabase + Upstash, not process memory).
    //   // Start at 1, raise only after queue-depth monitoring shows backlog.
    //   instances: 1,
    //   env: { NODE_ENV: 'production', APP_ROLE: 'worker' },
    //   max_memory_restart: '900M',
    //   // Workers need a LONGER drain window than the API: a long-running OCR
    //   // job should finish (or be re-queued by BullMQ) before SIGKILL.
    //   kill_timeout: 30000,
    //   out_file: `${logBase}/worker-out.log`,
    //   error_file: `${logBase}/worker-err.log`,
    //   merge_logs: true,
    //   time: true,
    // },

    // ------------------------------------------------------------------
    // WEB (Next.js). Stateless — CAN run cluster mode safely. On a single
    // small VPS, fork/1 is fine; bump `instances` if the box has spare cores.
    // `next build` bakes NEXT_PUBLIC_* at build time, so a rebuild (not just a
    // reload) is required whenever those change (see README §3 build step).
    // ------------------------------------------------------------------
    {
      name: 'visaai-web',
      cwd: `${APP_DIR}/apps/web`,
      // Use the workspace next binary directly so PATH doesn't matter under pm2.
      script: `${APP_DIR}/node_modules/next/dist/bin/next`,
      args: 'start -p 3000',
      exec_mode: 'fork',      // change to 'cluster' + instances:'max' if desired
      instances: 1,
      env: {
        NODE_ENV: 'production',
        PORT: '3000',
      },
      max_memory_restart: '700M',
      kill_timeout: 8000,
      out_file: `${logBase}/web-out.log`,
      error_file: `${logBase}/web-err.log`,
      merge_logs: true,
      time: true,
    },
  ],
};
