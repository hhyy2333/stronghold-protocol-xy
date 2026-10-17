// test/custom-art.test.js — 自画美术 (self-made art) for an ORIGINAL operator: the drop-in folder
// public/assets/local/char/<charId>/ turned into the `*Local` OVERLAY of data/assets.json's `chars[<charId>]` entry by
// tools/custom-spine.mjs, plus the guarantee that it survives a manifest rebuild (tools/fetch-assets.mjs) instead of
// being replaced by the alias.
//
// The overlay is metadata, never a URL: public/assets/** is git-ignored while data/assets.json is COMMITTED, so a
// '/assets/local/…' URL there would be a per-machine path in a shared file (test/assets.test.js: 'never a local-client
// path'; tools/setup.mjs would try to download it). The real URL lives in the git-ignored data/local-assets.json, the
// same channel as the extracted enemy/token models (test/local-token-models.test.js), and the client resolves it
// (public/js/assets.js localSpineEntry, public/js/ui/assetUrls.js localArtUrl).
//
// The suite builds a TEMP art folder from a real shipped model (a stand-in), so it needs no art of its own and no network:
// the skeleton is parsed by the same parser the client ships (@pixi-spine/runtime-3.8, tools/assets/skel.mjs).
// Run: node --test test/custom-art.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, copyFileSync, rmSync, writeFileSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import {
  CUSTOM_CHAR_ART_DIR, CUSTOM_CHAR_ART_URL, REQUIRED_PICTURES, OPTIONAL_PICTURES, CUSTOM_SPINE_SIDES, PICTURE_FIELDS,
  customCharArtGroup, findCustomCharArt, customCharArtEntry, customCharArt, applyCustomCharArt,
  hasCustomCharArt, isSelfMade, revertToAlias, revertRemovedArt, mergeLocalGroups,
} from '../tools/custom-spine.mjs';
import { addCustomArtEntries, applyAllCustomArt, ART_ALIAS_IDS } from '../tools/custom-assets.mjs';
import { CUSTOM_OP_IDS, FIXED_OP_IDS, customArt, fixedArt } from '../tools/custom-ops.mjs';
import { localAssetUrl } from '../public/js/assets.js';
import { chessAvatarUrl, chessPortraitUrl, localArtUrl } from '../public/js/ui/assetUrls.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const REAL_ASSETS = join(ROOT, 'public', 'assets');
const ALL_IDS = [...CUSTOM_OP_IDS, ...FIXED_OP_IDS];
/** The operator this suite gives self-made art to (a 固定 operator; its art is an alias in the shipped build). */
const NIYA = FIXED_OP_IDS[0];
/** A shipped operator model used as the stand-in (its files exist after `npm run assets`). */
const STANDIN = 'char_113_cqbw';
const STANDIN_FRONT = join(REAL_ASSETS, 'spine', 'op', STANDIN, 'front');
const HAS_MODEL = existsSync(join(STANDIN_FRONT, `${STANDIN}.skel`));

/**
 * A temp public/assets tree holding one art folder for NIYA, built from the stand-in model.
 * @param {{avatar?: boolean, portrait?: boolean, spine?: string[]|string|null, breakPage?: boolean, extraFolder?: string}} [o]
 */
function tempAssets(o = {}) {
  const { avatar = true, portrait = true, spine = 'front', breakPage = false, extraFolder = null } = o;
  const root = mkdtempSync(join(tmpdir(), 'sp-custom-art-'));
  const dir = join(root, CUSTOM_CHAR_ART_DIR, NIYA);
  mkdirSync(dir, { recursive: true });
  if (avatar) copyFileSync(join(REAL_ASSETS, 'char', 'avatar', `${STANDIN}.png`), join(dir, 'avatar.png'));
  if (portrait) copyFileSync(join(REAL_ASSETS, 'char', 'portrait', `${STANDIN}_1.png`), join(dir, 'portrait_1.png'));
  for (const side of spine ? [].concat(spine) : []) {
    const dst = join(dir, 'spine', side);
    mkdirSync(dst, { recursive: true });
    copyFileSync(join(STANDIN_FRONT, `${STANDIN}.skel`), join(dst, `${NIYA}.skel`));
    const atlas = readFileSync(join(STANDIN_FRONT, `${STANDIN}.atlas`), 'utf8');
    const lines = atlas.split('\n');
    const page = (lines[0] || '').trim();
    if (breakPage) {
      // the atlas still names its page, but the PNG was renamed: the mismatch must be reported
      writeFileSync(join(dst, `${NIYA}.atlas`), atlas);
      copyFileSync(join(STANDIN_FRONT, page), join(dst, 'renamed.png'));
    } else {
      writeFileSync(join(dst, `${NIYA}.atlas`), atlas);
      if (page) copyFileSync(join(STANDIN_FRONT, page), join(dst, page));
    }
  }
  if (extraFolder) {
    const stray = join(root, CUSTOM_CHAR_ART_DIR, extraFolder);
    mkdirSync(stray, { recursive: true });
    writeFileSync(join(stray, 'avatar.png'), 'not a real png');
  }
  return root;
}
const withTemp = async (o, fn) => { const root = tempAssets(o); try { return await fn(root); } finally { rmSync(root, { recursive: true, force: true }); } };
/** The operator whose shipped art an original operator borrows (`CUSTOM_ART` / `FIXED_ART`). */
const aliasSourceOf = (id) => (customArt(id) ?? fixedArt(id))?.chars;

test('the drop-in constants match the documented layout', () => {
  assert.equal(CUSTOM_CHAR_ART_DIR, 'local/char/');
  assert.equal(CUSTOM_CHAR_ART_URL, '/assets/local/char/');
  assert.deepEqual([...REQUIRED_PICTURES], ['avatar.png', 'portrait_1.png']);
  assert.deepEqual([...OPTIONAL_PICTURES], ['avatar_2.png', 'portrait_2.png']);
  assert.deepEqual([...CUSTOM_SPINE_SIDES], ['front', 'back']);
  assert.equal(customCharArtGroup('char_9002_yana'), 'char/char_9002_yana');
  assert.deepEqual(PICTURE_FIELDS, {
    'avatar.png': 'avatarLocal', 'avatar_2.png': 'avatarE2Local',
    'portrait_1.png': 'portraitLocal', 'portrait_2.png': 'portraitE2Local',
  });
});

test('the overlay is METADATA: no self-made field is ever a URL (it would be a per-machine path in a committed file)', async () => {
  await withTemp({}, async (root) => {
    const { entries } = await customCharArt(root, ALL_IDS);
    const urls = [];
    const walk = (n, path) => {
      if (typeof n === 'string') { if (n.includes('/assets/local/')) urls.push(`${path}=${n}`); }
      else if (n && typeof n === 'object') for (const [k, v] of Object.entries(n)) walk(v, `${path}.${k}`);
    };
    walk(entries, 'entry');
    assert.deepEqual(urls, [], 'the committed manifest carries file names, never the local URL');
    assert.deepEqual(entries[NIYA].avatarLocal, { group: `char/${NIYA}`, name: 'avatar.png' });
    assert.deepEqual(entries[NIYA].portraitLocal, { group: `char/${NIYA}`, name: 'portrait_1.png' });
  });
});

test('findCustomCharArt: a DECLARED operator is found; an unknown id\'s folder is ignored', async () => {
  await withTemp({ extraFolder: 'char_9999_nobody' }, async (root) => {
    const found = await findCustomCharArt(root, (id) => ALL_IDS.includes(id));
    assert.deepEqual(Object.keys(found), [NIYA]);
    assert.deepEqual(found[NIYA].has.sort(), ['avatar.png', 'portrait_1.png']);
    assert.deepEqual(Object.keys(found[NIYA].spine), ['front']);
    // the stray folder exists on disk but is not taken (a stale folder never leaks into the manifest)
    assert.ok(existsSync(join(root, CUSTOM_CHAR_ART_DIR, 'char_9999_nobody')));
    assert.deepEqual(await findCustomCharArt(root, (id) => ALL_IDS.includes(id)).then((f) => Object.keys(f)), [NIYA]);
  });
});

test('customCharArtEntry: avatar + portrait + a real Spine model become a complete overlay', { skip: !HAS_MODEL && 'no shipped model (run npm run assets)' }, async () => {
  await withTemp({}, async (root) => {
    const found = await findCustomCharArt(root, () => true);
    const { entry, problems, notes } = await customCharArtEntry(root, NIYA, found[NIYA]);
    assert.deepEqual(problems, []);
    assert.deepEqual(entry.avatarLocal, { group: `char/${NIYA}`, name: 'avatar.png' });
    assert.deepEqual(entry.portraitLocal, { group: `char/${NIYA}`, name: 'portrait_1.png' });
    // no E2 art given: the field stays absent, so the alias's avatarE2 survives the merge (a partial folder)
    assert.equal(entry.avatarE2Local, undefined);
    assert.equal(entry.portraitE2Local, undefined);
    assert.ok(notes.some((n) => /no avatar_2\.png/.test(n)), notes.join(' | '));
    const sp = entry.spineLocal.front;
    assert.equal(sp.group, `char/${NIYA}`);
    assert.equal(sp.skel, `spine/front/${NIYA}.skel`);
    assert.equal(sp.atlas, `spine/front/${NIYA}.atlas`);
    assert.ok(sp.textures.length >= 1 && sp.textures.every((t) => t.startsWith('spine/front/')), 'file names, not URLs');
    assert.equal(sp.pma, false, 'operators are not PMA');
    // the roles came from the real skeleton, so the model can be drawn
    assert.equal(typeof sp.anims.idle, 'string');
    assert.equal(typeof sp.anims.attack.loop, 'string');
    assert.ok(Object.keys(sp.animations).length > 0, 'animation durations');
    assert.ok(sp.bounds && sp.bounds.width > 0, 'skeleton bounds');
  });
});

test('a missing required picture is named', async () => {
  for (const [opts, want] of [[{ avatar: false }, 'avatar.png'], [{ portrait: false }, 'portrait_1.png']]) {
    await withTemp(opts, async (root) => {
      const found = await findCustomCharArt(root, () => true);
      const { problems } = await customCharArtEntry(root, NIYA, found[NIYA]);
      assert.ok(problems.some((p) => p.includes(want)), `${want} reported (${problems.join(' | ')})`);
    });
  }
});

test('a required picture that is not a real PNG is refused', async () => {
  await withTemp({}, async (root) => {
    writeFileSync(join(root, CUSTOM_CHAR_ART_DIR, NIYA, 'avatar.png'), 'this is not a png');
    const found = await findCustomCharArt(root, () => true);
    const { problems } = await customCharArtEntry(root, NIYA, found[NIYA]);
    assert.ok(problems.some((p) => /avatar\.png is not a readable PNG/.test(p)), problems.join(' | '));
  });
});

test('an atlas whose page image is missing is reported, and no model is emitted', { skip: !HAS_MODEL && 'no shipped model' }, async () => {
  await withTemp({ breakPage: true }, async (root) => {
    const found = await findCustomCharArt(root, () => true);
    const { entry, problems } = await customCharArtEntry(root, NIYA, found[NIYA]);
    assert.equal(entry.spineLocal, undefined, 'no model emitted');
    assert.ok(problems.some((p) => /atlas page .* is missing or not a PNG/.test(p)), problems.join(' | '));
  });
});

test('a folder without spine/ is fine: the battle model keeps the alias (a note, not a problem)', async () => {
  await withTemp({ spine: null }, async (root) => {
    const found = await findCustomCharArt(root, () => true);
    const { entry, problems, notes } = await customCharArtEntry(root, NIYA, found[NIYA]);
    assert.deepEqual(problems, []);
    assert.equal(entry.spineLocal, undefined);
    assert.deepEqual(entry.avatarLocal, { group: `char/${NIYA}`, name: 'avatar.png' });
    assert.ok(notes.some((n) => /no spine\/ folder .* keeps the alias/.test(n)), notes.join(' | '));
  });
});

test('a model with no Idle / Attack clip is reported (the renderer could not use it)', { skip: !HAS_MODEL && 'no shipped model' }, async () => {
  // the stand-in has both, so this asserts the check exists and stays quiet on a good model
  await withTemp({}, async (root) => {
    const found = await findCustomCharArt(root, () => true);
    const { problems, notes } = await customCharArtEntry(root, NIYA, found[NIYA]);
    assert.deepEqual(problems, []);
    assert.ok(notes.some((n) => /clips \(idle .+, attack .+/.test(n)), notes.join(' | '));
  });
});

test('applyCustomCharArt: the overlay is ADDED beside the alias, and an omitted field keeps the alias', { skip: !HAS_MODEL && 'no shipped model' }, async () => {
  await withTemp({}, async (root) => {
    const manifest = { chars: { [NIYA]: { avatar: '/alias/a.png', avatarE2: '/alias/a2.png', portrait: '/alias/p.png', portraitE2: '/alias/p2.png', spine: { front: { skel: '/alias/f.skel' } } } } };
    const { entries } = await customCharArt(root, ALL_IDS);
    const res = applyCustomCharArt(manifest, entries);
    assert.deepEqual(res.replaced, [NIYA]);
    assert.deepEqual(res.added, []);
    const got = manifest.chars[NIYA];
    // the alias stays underneath as the fallback: an install without data/local-assets.json draws exactly this
    assert.equal(got.avatar, '/alias/a.png', 'the alias avatar is NOT replaced');
    assert.equal(got.portrait, '/alias/p.png');
    assert.equal(got.spine.front.skel, '/alias/f.skel');
    assert.equal(got.avatarE2, '/alias/a2.png');
    // ...and the overlay names the local art on top of it
    assert.deepEqual(got.avatarLocal, { group: `char/${NIYA}`, name: 'avatar.png' });
    assert.deepEqual(got.portraitLocal, { group: `char/${NIYA}`, name: 'portrait_1.png' });
    assert.ok(got.spineLocal.front.skel.startsWith('spine/front/'));
    assert.equal(got.avatarE2Local, undefined, 'an omitted E2 field has no overlay (the alias E2 is used)');
  });
});

test('applyCustomCharArt: an overlay the author DELETED goes back to the alias instead of lingering', { skip: !HAS_MODEL && 'no shipped model' }, async () => {
  await withTemp({}, async () => {
    const alias = { avatar: '/alias/a.png', portrait: '/alias/p.png' };
    const manifest = { chars: { [NIYA]: { ...alias, avatarLocal: { group: `char/${NIYA}`, name: 'avatar.png' }, portraitLocal: { group: `char/${NIYA}`, name: 'portrait_1.png' } } } };
    // the author deletes the whole folder: no entries → the overlay fields must be dropped, not kept
    const res = applyCustomCharArt(manifest, {});
    assert.deepEqual(res.replaced, []);
    assert.deepEqual(manifest.chars[NIYA], { ...alias, avatarLocal: { group: `char/${NIYA}`, name: 'avatar.png' }, portraitLocal: { group: `char/${NIYA}`, name: 'portrait_1.png' } }, 'no entries → nothing touched');
    // with the folder gone, revertRemovedArt is what cleans it (below); an entry that exists is re-applied
    const gone = revertRemovedArt(manifest, ALL_IDS, {}, { [NIYA]: alias });
    assert.deepEqual(gone, [NIYA]);
    assert.equal(manifest.chars[NIYA].avatarLocal, undefined, 'the overlay is gone');
    assert.equal(manifest.chars[NIYA].avatar, '/alias/a.png', 'the alias is back');
  });
});

test('customCharArt: an operator with no folder is absent from the result (its alias stays)', async () => {
  await withTemp({}, async (root) => {
    const { entries, problems } = await customCharArt(root, ALL_IDS);
    assert.deepEqual(problems, []);
    assert.deepEqual(Object.keys(entries), [NIYA]);
    for (const id of ALL_IDS) if (id !== NIYA) assert.ok(!(id in entries), `${id}: no self-made art`);
  });
});

test('a manifest rebuild re-applies the self-made overlay instead of the alias (the guarantee of docs/CUSTOM-ART.md)', { skip: !HAS_MODEL && 'no shipped model' }, async () => {
  await withTemp({}, async (root) => {
    // What tools/fetch-assets.mjs produces: a body built FRESH from the plan. The plan knows the stand-in (it is a shipped
    // operator) but NOT the original one — a 固定 operator is a PRESET chess with no backups unit — so `chars[<niya>]` is
    // absent and only the alias creates it.
    const real = JSON.parse(readFileSync(join(ROOT, 'data', 'assets.json'), 'utf8'));
    // the stand-in of every declared operator (the alias sources the plan does carry), but NOT the original operators
    const sources = Object.fromEntries(ALL_IDS.map((id) => [aliasSourceOf(id), real.chars[aliasSourceOf(id)]]).filter(([, v]) => v));
    const body = { chars: sources, skills: {}, skillsById: {} };
    for (const [iconId, url] of Object.entries(real.skills)) if (/^skchr_/.test(iconId)) body.skills[iconId] = url;
    const alias = addCustomArtEntries(body, ART_ALIAS_IDS);
    assert.ok(alias.added.chars.includes(NIYA), 'the alias is applied first');
    assert.ok(body.chars[NIYA].avatar.includes(STANDIN), 'the alias points at the stand-in');
    // ...then the self-made folder overlays it
    const { entries } = await customCharArt(root, ART_ALIAS_IDS);
    const applied = applyCustomCharArt(body, entries);
    assert.deepEqual(applied.replaced, [NIYA]);
    assert.deepEqual(body.chars[NIYA].avatarLocal, { group: `char/${NIYA}`, name: 'avatar.png' }, 'the overlay survives the rebuild');
    assert.ok(body.chars[NIYA].spineLocal.front.skel.startsWith('spine/front/'), 'the model overlay survives');
    assert.ok(body.chars[NIYA].avatar.includes(STANDIN), 'and the alias stays underneath as the fallback');
  });
});

test('applyAllCustomArt: aliases + the overlay in one step, with hash/stats recomputed and the local manifest written', { skip: !HAS_MODEL && 'no shipped model' }, async () => {
  await withTemp({}, async (root) => {
    const manifest = JSON.parse(readFileSync(join(ROOT, 'data', 'assets.json'), 'utf8'));
    const localFile = join(root, 'local-assets.json');
    const res = await applyAllCustomArt(manifest, root, ART_ALIAS_IDS, { localManifest: localFile });
    assert.deepEqual(res.aliases.missing, []);
    assert.deepEqual(res.problems, []);
    assert.deepEqual(res.self.replaced, [NIYA]);
    assert.deepEqual(res.localGroups, [`char/${NIYA}`]);
    assert.deepEqual(manifest.chars[NIYA].avatarLocal, { group: `char/${NIYA}`, name: 'avatar.png' });
    assert.match(manifest.hash, /^[0-9a-f]{12}$/, 'hash recomputed');
    assert.equal(manifest.stats.chars, Object.keys(manifest.chars).length, 'stats recomputed');
    // the art is only visible when data/local-assets.json lists it: the URL is in that file, never in the manifest
    const local = JSON.parse(readFileSync(localFile, 'utf8'));
    assert.equal(local.groups[`char/${NIYA}`]['avatar.png'].path, `${CUSTOM_CHAR_ART_URL}${NIYA}/avatar.png`);
    assert.equal(local.count, Object.values(local.groups).reduce((n, g) => n + Object.keys(g).length, 0), 'count recomputed');
    assert.ok(!JSON.stringify(manifest).includes('/assets/local/'), 'never a local-client path in the committed manifest');
  });
});

test('mergeLocalGroups / writeLocalGroups: the other groups of data/local-assets.json are preserved', async () => {
  const doc = mergeLocalGroups({ version: 1, source: 'local-client', groups: { module: { 'mar-x': { path: '/assets/local/module/mar-x.png' } } } }, { 'char/c1': { 'avatar.png': { path: '/assets/local/char/c1/avatar.png' } } });
  assert.deepEqual(Object.keys(doc.groups).sort(), ['char/c1', 'module'], 'the extraction groups stay');
  assert.equal(doc.count, 2, 'count recomputed over every group');
  assert.equal(doc.source, 'local-client', 'an existing source is kept');
  assert.equal(mergeLocalGroups(null, {}, {}).source, 'self-made', 'a new document is marked self-made');
});

test('hasCustomCharArt: tells the CLI whether a folder exists', async () => {
  await withTemp({}, async (root) => {
    assert.equal(await hasCustomCharArt(root, NIYA), true);
    assert.equal(await hasCustomCharArt(root, 'char_9999_nobody'), false);
  });
});

test('a REMOVED art folder reverts to the alias instead of pointing at an overlay nothing resolves', { skip: !HAS_MODEL && 'no shipped model' }, async () => {
  await withTemp({}, async (root) => {
    const alias = { avatar: `/assets/char/avatar/${STANDIN}.png`, portrait: `/assets/char/portrait/${STANDIN}_1.png`, spine: { front: { skel: `/assets/spine/op/${STANDIN}/front/${STANDIN}.skel` } } };
    const manifest = { chars: { [NIYA]: { ...alias } } };
    // 1. with the folder: the overlay is applied
    const withFolder = await customCharArt(root, ALL_IDS);
    applyCustomCharArt(manifest, withFolder.entries);
    assert.ok(manifest.chars[NIYA].avatarLocal, 'the overlay is applied');
    assert.equal(isSelfMade(manifest.chars[NIYA]), true);
    // 2. the author deletes the folder: the manifest must go back to the alias, not keep a dead overlay
    rmSync(join(root, CUSTOM_CHAR_ART_DIR, NIYA), { recursive: true, force: true });
    const gone = await customCharArt(root, ALL_IDS);
    assert.deepEqual(Object.keys(gone.entries), [], 'no self-made art any more');
    const reverted = revertRemovedArt(manifest, ALL_IDS, gone.entries, { [NIYA]: alias });
    assert.deepEqual(reverted, [NIYA]);
    assert.equal(manifest.chars[NIYA].avatar, alias.avatar, 'avatar is the alias again');
    assert.equal(manifest.chars[NIYA].avatarLocal, undefined, 'the overlay is gone');
    assert.equal(manifest.chars[NIYA].spine.front.skel, alias.spine.front.skel, 'model is the alias again');
    assert.equal(isSelfMade(manifest.chars[NIYA]), false);
    // 3. an operator that never had self-made art is left alone
    assert.deepEqual(revertRemovedArt(manifest, ALL_IDS, {}, { [NIYA]: alias }), []);
  });
});

test('isSelfMade / revertToAlias: the entry helpers behave (overlay shape AND the pre-overlay URL shape)', () => {
  assert.equal(isSelfMade({ avatarLocal: { group: 'char/x', name: 'avatar.png' } }), true);
  assert.equal(isSelfMade({ spineLocal: { front: { skel: 'spine/front/x.skel' } } }), true);
  assert.equal(isSelfMade({ avatar: `${CUSTOM_CHAR_ART_URL}x/avatar.png` }), true, 'the pre-overlay shape is recognised (migration)');
  assert.equal(isSelfMade({ spine: { front: { skel: `${CUSTOM_CHAR_ART_URL}x/f.skel` } } }), true);
  assert.equal(isSelfMade({ avatar: '/assets/char/avatar/char_113_cqbw.png' }), false);
  assert.equal(isSelfMade({ avatarLocal: { group: 'char/x' } }), false, 'no name → not a resolvable overlay');
  assert.equal(isSelfMade(null), false);
  // revert drops the overlay AND a pre-overlay local URL, restoring the alias fields and keeping unrelated ones
  const back = revertToAlias(
    { avatar: `${CUSTOM_CHAR_ART_URL}x/avatar.png`, portraitLocal: { group: 'char/x', name: 'p.png' }, spine: { front: { skel: `${CUSTOM_CHAR_ART_URL}x/f.skel` } }, extra: 1 },
    { avatar: '/alias/a.png', portraitE2: '/alias/p2.png', spine: { front: { skel: '/alias/f.skel' }, back: { skel: '/alias/b.skel' } } });
  assert.deepEqual(back, { avatar: '/alias/a.png', portraitE2: '/alias/p2.png', spine: { front: { skel: '/alias/f.skel' }, back: { skel: '/alias/b.skel' } }, extra: 1 });
  // no alias at all: nothing to fall back to
  assert.equal(revertToAlias({ avatar: `${CUSTOM_CHAR_ART_URL}x/avatar.png` }, null), null);
  assert.equal(revertToAlias({ avatarLocal: { group: 'char/x', name: 'avatar.png' } }, null), null);
});

test('the shipped build: every declared operator has a chars entry, a resolvable overlay and no local URL', async () => {
  const manifest = JSON.parse(readFileSync(join(ROOT, 'data', 'assets.json'), 'utf8'));
  for (const id of ALL_IDS) assert.ok(manifest.chars[id], `${id}: has a chars entry (an alias, or an overlay on one)`);
  // the committed manifest never carries a '/assets/local/…' URL (test/assets.test.js states the rule for the whole file)
  assert.ok(!JSON.stringify(manifest).includes(CUSTOM_CHAR_ART_URL), 'never a local-client path');
  const localFile = join(ROOT, 'data', 'local-assets.json');
  const local = existsSync(localFile) ? JSON.parse(readFileSync(localFile, 'utf8')) : null;
  const { entries } = await customCharArt(REAL_ASSETS, ALL_IDS);
  for (const [id, entry] of Object.entries(entries)) {
    // every overlay field the manifest carries must resolve to a real file when the local manifest is there
    for (const f of Object.keys(entry)) assert.ok(manifest.chars[id][f], `${id}: manifest has ${f}`);
    for (const [field, art] of Object.entries(entry)) {
      if (field === 'spineLocal') continue;
      assert.equal(localArtUrl(local, art), `${CUSTOM_CHAR_ART_URL}${id}/${art.name}`, `${id}.${field} resolves`);
      assert.ok(existsSync(join(REAL_ASSETS, `${CUSTOM_CHAR_ART_DIR}${id}/${art.name}`)), `${id}: ${art.name} exists on disk`);
    }
    for (const side of CUSTOM_SPINE_SIDES) {
      const sp = entry.spineLocal?.[side];
      if (!sp) continue;
      for (const rel of [sp.skel, sp.atlas, ...sp.textures]) {
        assert.ok(existsSync(join(REAL_ASSETS, `${CUSTOM_CHAR_ART_DIR}${id}/${rel}`)), `${id} ${side}: ${rel} exists`);
        assert.equal(localAssetUrl(local, sp.group, rel), `${CUSTOM_CHAR_ART_URL}${id}/${rel}`, `${id} ${side}: ${rel} resolves`);
      }
    }
  }
  // the client draws the overlay for the operator this build has art for, and the alias when the manifest is absent
  const yana = { charId: NIYA, assets: {} };
  assert.ok(String(chessAvatarUrl(manifest, yana, local)).startsWith(CUSTOM_CHAR_ART_URL), 'the overlay avatar is drawn');
  assert.equal(chessAvatarUrl(manifest, yana, null), manifest.chars[NIYA].avatar, 'without the local manifest: the alias');
});

test('the overlay never disturbs an OFFICIAL operator (the local manifest is irrelevant to it)', () => {
  const manifest = JSON.parse(readFileSync(join(ROOT, 'data', 'assets.json'), 'utf8'));
  const localFile = join(ROOT, 'data', 'local-assets.json');
  const local = existsSync(localFile) ? JSON.parse(readFileSync(localFile, 'utf8')) : null;
  const chess = JSON.parse(readFileSync(join(ROOT, 'data', 'chess.json'), 'utf8'));
  const official = Object.values(chess).find((c) => c.visible && manifest.chars[c.charId] && !Object.keys(manifest.chars[c.charId]).some((k) => k.endsWith('Local')));
  assert.ok(official, 'the build has official operators');
  assert.equal(chessAvatarUrl(manifest, official, local), chessAvatarUrl(manifest, official, null), 'same avatar with or without the local art');
  assert.equal(chessPortraitUrl(manifest, official, local), chessPortraitUrl(manifest, official, null), 'same portrait');
});

test('the shipped data/local-assets.json lists every self-made file (the client resolves the overlay through it)', async () => {
  const localFile = join(ROOT, 'data', 'local-assets.json');
  const { entries } = await customCharArt(REAL_ASSETS, ALL_IDS);
  const local = JSON.parse(readFileSync(localFile, 'utf8'));
  for (const id of Object.keys(entries)) {
    const g = local.groups[customCharArtGroup(id)];
    assert.ok(g, `char/${id}: the group is in data/local-assets.json`);
    for (const [name, e] of Object.entries(g)) {
      assert.ok(e.path.startsWith(`${CUSTOM_CHAR_ART_URL}${id}/`), `${name}: a URL of that operator`);
      assert.ok(existsSync(join(REAL_ASSETS, e.path.slice('/assets/'.length))), `${name}: on disk`);
    }
  }
});

test('the drop-in folder of the shipped build is only read, never written (the author owns the files)', async () => {
  const dir = join(REAL_ASSETS, CUSTOM_CHAR_ART_DIR);
  if (!existsSync(dir)) return;   // nothing dropped in: nothing to protect
  const before = readdirSync(dir).sort();
  const manifest = JSON.parse(readFileSync(join(ROOT, 'data', 'assets.json'), 'utf8'));
  await customCharArt(REAL_ASSETS, ALL_IDS);
  applyCustomCharArt(manifest, (await customCharArt(REAL_ASSETS, ALL_IDS)).entries);
  assert.deepEqual(readdirSync(dir).sort(), before, 'the folder is unchanged');
});

// --- end to end over HTTP: a real server serves the self-made files, and they are loadable ------------------------

test('end to end: the running server serves every self-made URL, and the model parses as Spine 3.8', { skip: !HAS_MODEL && 'no shipped model' }, async () => {
  const manifest = JSON.parse(readFileSync(join(ROOT, 'data', 'assets.json'), 'utf8'));
  const localFile = join(ROOT, 'data', 'local-assets.json');
  if (!existsSync(localFile)) return;      // no local art on this machine: nothing to serve
  const local = JSON.parse(readFileSync(localFile, 'utf8'));
  // only run when this build actually has self-made art for the operator (the drop-in folder is git-ignored)
  if (!manifest.chars[NIYA]?.avatarLocal) return;

  const { avatarUrl, portraitUrl, spineEntry, validSpine } = await import('../public/js/assets.js');
  const { startServer } = await import('../server/index.js');
  const { parseSkel } = await import('../tools/assets/skel.mjs');
  const { atlasInfo } = await import('../tools/assets/atlas.mjs');

  const av = avatarUrl(manifest, NIYA, { local });
  const po = portraitUrl(manifest, NIYA, { local });
  assert.ok(String(av).startsWith(CUSTOM_CHAR_ART_URL), 'the self-made avatar resolves through the local manifest');
  const sp = spineEntry(manifest, NIYA, { local });
  const urls = [av, po, ...(sp ? [sp.skel, sp.atlas, ...sp.textures] : [])];
  // the pictures must be the author's own files, and they must be served (the overlay names files under public/assets/local)
  for (const u of [av, po]) {
    assert.ok(existsSync(join(REAL_ASSETS, u.slice('/assets/'.length))), `${u} exists on disk`);
  }

  const quiet = { info() {}, debug() {}, warn() {}, error() {} };
  const srv = await startServer({ port: 0, host: '127.0.0.1', log: quiet });
  const base = `http://127.0.0.1:${srv.port}`;
  try {
    for (const u of urls) {
      const r = await fetch(base + u);
      assert.ok(r.ok, `GET ${u} -> ${r.status}`);
      const buf = Buffer.from(await r.arrayBuffer());
      assert.ok(buf.length > 0, `${u}: non-empty`);
    }
    // the pictures are real PNGs
    for (const u of [av, po]) {
      const buf = Buffer.from(await (await fetch(base + u)).arrayBuffer());
      assert.ok(buf[0] === 0x89 && buf.toString('latin1', 1, 4) === 'PNG', `${u}: a PNG`);
    }
    if (sp) {
      assert.ok(validSpine(sp), 'the client resolver accepts the entry');
      const skel = Buffer.from(await (await fetch(base + sp.skel)).arrayBuffer());
      const atlas = await (await fetch(base + sp.atlas)).text();
      const info = parseSkel(skel, atlasInfo(atlas).regions);
      assert.ok(info.version.startsWith('3.8'), `Spine ${info.version} (the client runtime is 3.8)`);
      assert.ok(info.animations.length > 0, 'the model has animations');
      assert.deepEqual(info.missingRegions, [], 'every attachment is in the atlas');
    }
  } finally {
    await srv.close?.();
  }
});

// --- the regression this suite exists to prevent: a per-machine path in the COMMITTED manifest -------------------

test('data/assets.json carries no /assets/local/ URL — an install without the art must never request one', () => {
  const manifest = JSON.parse(readFileSync(join(ROOT, 'data', 'assets.json'), 'utf8'));
  const bad = [];
  const walk = (n, path) => {
    if (typeof n === 'string') { if (n.includes(CUSTOM_CHAR_ART_URL)) bad.push(`${path}=${n}`); }
    else if (Array.isArray(n)) n.forEach((x, i) => walk(x, `${path}[${i}]`));
    else if (n && typeof n === 'object') for (const [k, v] of Object.entries(n)) walk(v, `${path}.${k}`);
  };
  walk(manifest, 'assets.json');
  assert.deepEqual(bad, [], 'setup / doctor / package count every /assets/ URL as a file this install must have');
  // and the overlay of the operator this build has art for resolves to exactly the local files
  const localFile = join(ROOT, 'data', 'local-assets.json');
  if (!existsSync(localFile)) return;
  const local = JSON.parse(readFileSync(localFile, 'utf8'));
  for (const [id, rec] of Object.entries(manifest.chars)) {
    for (const [field, art] of Object.entries(rec)) {
      if (!field.endsWith('Local') || field === 'spineLocal') continue;
      assert.equal(localArtUrl(local, art), `${CUSTOM_CHAR_ART_URL}${id}/${art.name}`, `${id}.${field}`);
    }
  }
});
