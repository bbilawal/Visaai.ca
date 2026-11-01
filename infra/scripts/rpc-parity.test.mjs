// node --test infra/scripts/rpc-parity.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  exposedRpcs,
  missingRpcs,
  referencedRpcs,
  rpcNamesIn,
} from './rpc-parity.mjs';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

test('finds an RPC name that sits on the line after .rpc(', () => {
  const src = `await this.supabase.admin.rpc(\n      'claim_payment_webhook_event',\n      { p: 1 })`;
  assert.deepEqual([...rpcNamesIn(src)], ['claim_payment_webhook_event']);
});

test('finds typed and single-line calls', () => {
  const src = `db.rpc<Row[]>("claim_outbox_batch", {}); db.rpc('redeem_coupon')`;
  assert.deepEqual([...rpcNamesIn(src)].sort(), ['claim_outbox_batch', 'redeem_coupon']);
});

test('the real API source references the payment-ledger RPCs', () => {
  const refs = referencedRpcs(join(repoRoot, 'apps', 'api', 'src'));
  for (const n of [
    'claim_payment_webhook_event',
    'complete_payment_webhook_event',
    'fail_payment_webhook_event',
  ]) {
    assert.ok(refs.includes(n), `${n} not found in apps/api/src`);
  }
});

test('reports exactly the RPCs absent from the OpenAPI document', () => {
  const openapi = {
    paths: { '/': {}, '/payments': {}, '/rpc/redeem_coupon': {}, '/rpc/claim_outbox_batch': {} },
  };
  const exposed = exposedRpcs(openapi);
  assert.deepEqual(
    missingRpcs(['claim_outbox_batch', 'claim_payment_webhook_event', 'redeem_coupon'], exposed),
    ['claim_payment_webhook_event'],
  );
});

test('a table path is not mistaken for an RPC', () => {
  assert.equal(exposedRpcs({ paths: { '/claim_payment_webhook_event': {} } }).size, 0);
});
