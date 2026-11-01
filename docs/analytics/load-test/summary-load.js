// summary-load.js — k6 staging load test for the analytics serving path.
// Run: k6 run -e API_URL=https://staging-api -e ADMIN_TOKEN=<jwt> summary-load.js
// Staging-only; requires an applied schema (see ../MIGRATIONS-RUNBOOK.md) + admin JWT.
import http from 'k6/http'
import { check } from 'k6'

export const options = {
  stages: [
    { duration: '30s', target: 20 },
    { duration: '1m', target: 50 },
    { duration: '30s', target: 0 },
  ],
  thresholds: {
    http_req_duration: ['p(95)<800'],
    http_req_failed: ['rate<0.01'],
  },
}

const BASE = __ENV.API_URL
const TOKEN = __ENV.ADMIN_TOKEN
const headers = { Authorization: `Bearer ${TOKEN}` }
const range = 'from=2026-07-01&to=2026-07-31&grain=day'

export default function () {
  const summary = http.get(`${BASE}/analytics/summary?${range}`, { headers })
  check(summary, { 'summary 200': (r) => r.status === 200 })
  const mrr = http.get(`${BASE}/analytics/metrics/financial?metric=mrr&${range}`, { headers })
  check(mrr, { 'metric 200': (r) => r.status === 200 })
}
