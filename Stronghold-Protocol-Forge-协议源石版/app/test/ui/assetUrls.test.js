// Asset URL helpers (public/js/ui/assetUrls.js) against the real manifest: every visible chess resolves its
// avatar and portrait (normal + golden), bonds / bands / items / enemies / factions / titles resolve, and
// nothing outside the manifest is ever returned. The two-manifest helper is 协议源石: an effect of
// `iconKind: 'hex'` (DESIGN §29) takes its 阶位 art from the optional local-client manifest (data/local-assets.json,
// DESIGN §13) — the card face the draft shows — and its mod rune when only that art is installed; a
// `buffIcon/<iconId>` sprite data/assets.json never carried would have shown the bolt.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  uiUrl, chessAvatarUrl, chessPortraitUrl, skillIconUrl, profIconUrl, subProfIconUrl, bondIconUrl, bandIconUrl, itemIconUrl,
  enemyIconUrl, tokenAvatarUrl, factionIconUrl, titleIconUrl, effectIconUrl, hexTierArtUrl,
} from '../../public/js/ui/assetUrls.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const load = (f) => JSON.parse(readFileSync(path.join(ROOT, 'data', f), 'utf8'));
const m = load('assets.json');
const chess = load('chess.json');
/** data/local-assets.json (optional: only a machine with the local client / the unpacked mod art has one). */
const local = (() => { try { return load('local-assets.json'); } catch { return null; } })();

function manifestUrls(obj, out = new Set()) {
  if (typeof obj === 'string' && obj.startsWith('/assets/')) out.add(obj);
  else if (obj && typeof obj === 'object') for (const v of Object.values(obj)) manifestUrls(v, out);
  return out;
}
const ALL = manifestUrls(m);
const inManifest = (u) => u == null || ALL.has(u);

describe('assetUrls', () => {
  test('every visible chess (normal + golden) has avatar, portrait and skill icon', () => {
    let n = 0;
    for (const c of Object.values(chess)) {
      if (!c.charId || c.isDiy) continue;
      const a = chessAvatarUrl(m, c);
      const p = chessPortraitUrl(m, c);
      assert.ok(a && inManifest(a), `avatar ${c.chessId}`);
      assert.ok(p && inManifest(p), `portrait ${c.chessId}`);
      assert.ok(inManifest(skillIconUrl(m, c)), `skill ${c.chessId}`);
      assert.ok(inManifest(profIconUrl(m, c.profession)));
      assert.ok(inManifest(subProfIconUrl(m, c)));
      n++;
    }
    assert.ok(n >= 200);
    const golden = Object.values(chess).find((c) => c.isGolden && m.chars[c.charId]?.avatarE2);
    assert.equal(chessAvatarUrl(m, golden), m.chars[golden.charId].avatarE2, 'golden uses E2 art');
  });
  test('bonds, bands, items, enemies, tokens, factions, titles, effects', () => {
    for (const id of Object.keys(load('bonds.json'))) assert.ok(bondIconUrl(m, id), id);
    for (const id of Object.keys(load('bands.json'))) assert.ok(bandIconUrl(m, id), id);
    for (const it of Object.values(load('items.json'))) assert.ok(inManifest(itemIconUrl(m, it)), it.id);
    assert.ok(itemIconUrl(m, Object.values(load('items.json'))[0]));
    const enemies = load('enemies.json');
    let found = 0;
    for (const k of Object.keys(enemies)) { const u = enemyIconUrl(m, k); assert.ok(inManifest(u), k); if (u) found++; }
    assert.ok(found > Object.keys(enemies).length * 0.9);
    for (const t of Object.values(load('factions.json').types)) assert.ok(factionIconUrl(m, t.icon), t.type);
    for (const t of load('config.json').titles) assert.ok(titleIconUrl(m, t.picId), t.id);
    assert.ok(tokenAvatarUrl(m, 'token_10028_vigil_wolf'));
    assert.ok(effectIconUrl(m, { iconKind: 'team' }));
    assert.ok(effectIconUrl(m, { iconKind: 'choice' }));
    assert.ok(effectIconUrl(m, { iconKind: 'band', iconId: 'band_bldsk' }));
    assert.ok(effectIconUrl(m, { iconKind: 'garrison' }));
    assert.equal(effectIconUrl(m, { iconKind: 'x' }), null);
    assert.ok(uiUrl(m, 'hudPanel/icon_hp'));
  });
  test('a 协议源石 effect has no official sprite: a rune name resolves to nothing (the caller draws its glyph)', () => {
    // data/assets.json carries no hex rune, and the third-party mod's rune art was removed on 2026-10-12: only a tier
    // resolves to a URL (the next test), never a rune name
    assert.equal(effectIconUrl(m, { iconKind: 'hex', iconId: 'piggyBankRune' }), null, 'no local manifest → null');
    assert.equal(effectIconUrl(m, { iconKind: 'hex', iconId: 'piggyBankRune' }, {}), null);
    assert.equal(effectIconUrl(m, { iconKind: 'hex' }, local), null, 'no iconId → null');
    assert.equal(effectIconUrl(m, { iconKind: 'hex', iconId: 'piggyBankRune' }, local), null, 'a rune name is not art any more');
    // the roster names no art at all any more, so nothing can dangle
    for (const h of [...Object.values(load('hextech.json').playerHexes), ...Object.values(load('hextech.json').enemyHexes)]) {
      assert.equal(h.icon, undefined, `${h.id} names no art`);
      assert.equal(effectIconUrl(m, { iconKind: 'hex', iconId: h.id }, local), null, `${h.id}: no sprite`);
    }
  });
  test('a 协议源石 effect WITH a tier shows the tier art (the card face)', () => {
    if (!local) return;
    const hx = load('hextech.json');
    const tierArt = local.groups['hextech/tier'];
    if (!tierArt) return;                                  // the tier images are the owner's own optional art
    for (const r of hx.rarities) {
      const entry = tierArt[String(r.tier)];
      assert.ok(entry, `hextech/tier/${r.tier} is listed`);
      const url = effectIconUrl(m, { iconKind: 'hex', iconId: 'adamantRune', tier: r.tier }, local);
      assert.equal(url, entry.path, `tier ${r.tier} → its 阶位 image`);
      assert.ok(existsSync(path.join(ROOT, 'public', entry.path.replace(/^\/assets\//, 'assets/'))), `tier ${r.tier}: on disk`);
      assert.equal(hexTierArtUrl(local, r.tier), entry.path);
    }
    // an unknown / absent tier resolves to null, never to a broken URL
    for (const tier of [99, null, undefined, 0, 'x']) {
      assert.equal(effectIconUrl(m, { iconKind: 'hex', iconId: 'adamantRune', tier }, local), null, `tier ${String(tier)}`);
      assert.equal(hexTierArtUrl(local, tier), null, `hexTierArtUrl(${String(tier)})`);
    }
    assert.equal(hexTierArtUrl(null, 2), null);
  });
  test('missing manifest / ids ⇒ null, never throws', () => {
    for (const fn of [chessAvatarUrl, chessPortraitUrl, skillIconUrl, subProfIconUrl, itemIconUrl]) {
      assert.equal(fn(null, null), null);
      assert.equal(fn(m, { assets: {} }) ?? null, fn === skillIconUrl ? uiUrl(m, 'skillIcon/empty') : null);
    }
    assert.equal(bondIconUrl(m, 'nope'), null);
    assert.equal(bandIconUrl(null, 'band_bldsk'), null);
    assert.equal(enemyIconUrl(m, 'enemy_nope'), null);
    assert.equal(profIconUrl(m, 'NOPE'), null);
    assert.equal(uiUrl(undefined, 'x'), null);
    assert.equal(tokenAvatarUrl(m, null), null);
  });
});
