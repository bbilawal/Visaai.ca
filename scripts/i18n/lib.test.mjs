import { test } from 'node:test';
import assert from 'node:assert/strict';
import { flattenMessages, toCsv, buildManifest } from './lib.mjs';

const data = {
  en: { a: { x: 'Hello, "world" — hi', y: 'VRI {score}' } },
  fr: { a: { x: 'Bonjour', y: 'VRI {score}' } },
};
const locales = ['en', 'fr'];

test('flatten: ordered rows with perLocale + identical flag', () => {
  const rows = flattenMessages(data, locales);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].ns, 'a');
  assert.equal(rows[0].key, 'x');
  assert.equal(rows[0].en, 'Hello, "world" — hi');
  assert.equal(rows[0].perLocale.fr, 'Bonjour');
  assert.equal(rows[0].identical, false);
  assert.equal(rows[1].identical, true); // 'VRI {score}' identical in fr
});

test('flatten: missing translation falls back to empty string', () => {
  const rows = flattenMessages({ en: { a: { x: 'Hi' } }, de: { a: {} } }, ['en', 'de']);
  assert.equal(rows[0].perLocale.de, '');
});

test('toCsv: RFC4180 escaping + locale-named header + pending status', () => {
  const rows = flattenMessages(data, locales);
  const csv = toCsv(rows, 'fr');
  const lines = csv.trim().split('\n');
  assert.equal(lines[0], '"namespace","key","en","fr","status"');
  assert.ok(lines[1].includes('"Hello, ""world"" — hi"'));
  assert.ok(lines[1].endsWith('"pending"'));
});

test('buildManifest: counts, locales list, mt vs english_held status', () => {
  const rows = flattenMessages(data, locales);
  const m = buildManifest(rows, locales, '2026-06-12');
  assert.equal(m.totalKeys, 2);
  assert.deepEqual(m.locales, ['fr']);
  assert.equal(m.counts.fr.pending, 2);
  assert.equal(m.counts.fr.approved, 0);
  assert.equal(m.keys['a.x'].status, 'mt');
  assert.equal(m.keys['a.y'].status, 'english_held_candidate');
  assert.equal(m.keys['a.x'].perLocale.fr, 'pending');
});
