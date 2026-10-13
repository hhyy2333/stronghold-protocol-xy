import test from 'node:test';
import assert from 'node:assert/strict';
import { usableRank, RANK_URL, PREF_KEY } from '../client/cdn.js';
test('usableRank 过滤被排除/不可用的源并保留发布延迟', () => {
  const rows = usableRank({ rank: [
    { id: 'a', host: 'a.example', measured: true, ttfbMs: { 电信: 200 } },
    { id: 'b', host: 'b.example', excluded: true },
    { id: 'c', host: 'c.example', usable: false },
  ] });
  assert.deepEqual(rows.map((r) => r.id), ['a']);
  assert.equal(rows[0].measured, true);
});
test('常量固定（发布契约）', () => {
  assert.match(RANK_URL, /^https:\/\/speedcdn\.jiangjiangze\.icu\/cdn\/v1\/rank\.json$/);
  assert.equal(PREF_KEY, 'source');
});
