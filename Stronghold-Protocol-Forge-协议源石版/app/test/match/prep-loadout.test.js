// test/match/prep-loadout.test.js — 休整期自由更换技能 / 模组 (the owner's request of 2026-10-12; the reference mod
// 休整期切换技能模组mod): the in-match `g.loadout` intent re-equips ONE operator between rounds, and — the whole point of
// the reference mod, which upstream only ever allowed for ordinary chess — it covers 自选编队 pieces too.
//
// What is pinned here:
//   * the wire: `g.loadout { entries }` is a per-operator increment (1…8 operators), structural checks only.
//   * the phase gate: PREP only, and only while that player has not pressed 准备; every other phase / 已准备 / a bot /
//     a stranger is refused and changes NOTHING.
//   * the merge: one operator's increment never clears another operator's 配发 (setLoadout is a whole-map replacement,
//     so the merge is the feature).
//   * 自选编队 (the fix): an increment naming a slot the player filled updates that slot's pick and RECOMPOSES the record
//     — the new skill / module is what the next battle fields (PlayerBattleInput `diy`) and what m.private.diy reports.
//     A prototype 自选 piece carries a fixed selection and is refused. A slot the player did NOT fill is not a swap.
//   * the client seam: the detail card's swap buttons call `g.loadout`, and the action exists.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { C2S, validateC2S, MODULE_NONE, loadoutOptions, resolveLoadout } from '../../shared/protocol.js';
import { diyRecord } from '../../shared/diy.js';
import { PHASE, ERR } from '../../shared/constants.js';
import { hasGeneratedData } from '../../server/sim/simdata.js';
import { DATA, makeMatch } from './harness.js';

const REAL = { skip: !hasGeneratedData() };
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const T5A = 'chess_char_5_diy1_a';
const T5B = 'chess_char_5_diy2_a';
const T6A = 'chess_char_6_diy1_a';
const SIEGE = 'char_112_siege'; // 推进之王: an owned 6★ with a kit, S1–S3 and a module
const SIEGE_MOD = 'uniequip_002_siege';
const SHARP = 'char_609_acguad'; // Sharp: a 6★ prototype (its locked S3 + SOL-X)
/**
 * Plain (non-自选) operators the 干员调配 roster may name, with three skills: the `_a` records only (a `_b` golden id is not
 * a loadout target — shared/protocol.js checkLoadout refuses it). Three skills matter: setLoadout DROPS an entry equal
 * to the default, so a swap test has to move between two NON-default indexes (else the entry simply disappears).
 */
const PLAIN_OPS = Object.values(DATA.chess)
  .filter((c) => c && !c.isDiy && !c.isGolden && typeof c.chessId === 'string' && Array.isArray(c.skills) && c.skills.length >= 3 && c.goldenId)
  .map((c) => c.chessId)
  .sort();
/** The two non-default skill indexes of `id` (its default is the third one). */
function nonDefaultSkills(id) {
  const c = DATA.chess[id];
  const def = c.skills.find((s) => s.isDefault)?.index;
  return c.skills.map((s) => s.index).filter((i) => i !== def);
}
/** A plain chess with several skills (not 自选): the ordinary half of the feature. */
const PLAIN = PLAIN_OPS[0];

// ---------------------------------------------------------------------------------------------------
// the wire
// ---------------------------------------------------------------------------------------------------

test('wire: g.loadout carries a per-operator increment; only structural limits are checked here', () => {
  assert.ok(C2S['g.loadout'], 'the intent exists');
  assert.equal(validateC2S({ t: 'g.loadout', entries: { [SIEGE]: { skill: 1 } } }), null);
  assert.equal(validateC2S({ t: 'g.loadout', entries: { [SIEGE]: { module: SIEGE_MOD } } }), null);
  assert.equal(validateC2S({ t: 'g.loadout', entries: { [SIEGE]: { skill: 2, module: MODULE_NONE } } }), null);
  assert.equal(validateC2S({ t: 'g.loadout', entries: {} }), null, 'an empty increment is legal (a no-op server-side)');
  // malformed: not an object / a bad id / an unknown field / a skill index out of range
  for (const bad of [null, [], 'x', { [SIEGE]: {} }, { [SIEGE]: { nope: 1 } }, { [SIEGE]: { skill: 99 } }, { 'a b': { skill: 0 } }]) {
    assert.match(validateC2S({ t: 'g.loadout', entries: bad }) || '', /bad field entries/, JSON.stringify(bad));
  }
  // the semantic checks (a known chess, a legal skill / module for it) are the server's, not the wire's
  assert.equal(validateC2S({ t: 'g.loadout', entries: { not_a_chess: { skill: 0 } } }), null);
});

// ---------------------------------------------------------------------------------------------------
// the phase gate
// ---------------------------------------------------------------------------------------------------

/** A co-op match whose p_0 slots 推进之王 (S3 + its module) in T5A and Sharp (a prototype) in T5B. */
function swapMatch(extra = {}) {
  const seats = [
    { seat: 0, playerId: 'p_0', name: 'P0', isBot: false, connected: true, diy: { [T5A]: { charId: SIEGE, skillIndex: 2, uniEquipId: SIEGE_MOD }, [T5B]: { charId: SHARP } } },
    { seat: 1, playerId: 'p_1', name: 'P1', isBot: false, connected: true },
    { seat: 2, playerId: 'ai_0', name: 'AI0', isBot: true, connected: true },
  ];
  return makeMatch({ mode: 'coop', seats, seed: 11, ...extra });
}

test('gate: the swap is PREP-only and refused once that player is 准备; a refusal changes nothing', REAL, () => {
  const h = swapMatch().start();
  const m = h.m;
  const p0 = h.ps('p_0');
  const before = p0.diy[T5A];
  assert.equal(before.skillIndex, 2);

  // not PREP yet (INFO_CHECK / BAND_DRAFT …): refused, and the pick is untouched
  assert.ok(m.phase !== PHASE.PREP);
  assert.deepEqual(m.setPrepLoadout('p_0', { [T5A]: { skill: 0 } }), { error: ERR.WRONG_PHASE, detail: 'loadout swap is a prep action' });
  assert.equal(p0.diy[T5A].skillIndex, 2, 'nothing changed');

  h.runToPhase(PHASE.PREP);
  assert.deepEqual(m.setPrepLoadout('p_0', { [T5A]: { skill: 0 } }), { ok: true });
  assert.equal(p0.diy[T5A].skillIndex, 0, 'applied in PREP');

  // 已准备 locks it (the reference mod's rule: 已「准备」…按钮不出现，服务端同样拒绝)
  p0.setReady(true);
  assert.deepEqual(m.setPrepLoadout('p_0', { [T5A]: { skill: 2 } }), { error: ERR.WRONG_PHASE, detail: 'loadout locked once ready' });
  assert.equal(p0.diy[T5A].skillIndex, 0, 'still the swapped skill');
  p0.setReady(false);

  // a bot, a stranger and a spectator are never served
  assert.equal(m.setPrepLoadout('ai_0', { [T5A]: { skill: 2 } }).error, ERR.NOT_IN_ROOM);
  assert.equal(m.setPrepLoadout('nobody', { [T5A]: { skill: 2 } }).error, ERR.NOT_IN_ROOM);
});

// ---------------------------------------------------------------------------------------------------
// the ordinary half: a per-operator merge
// ---------------------------------------------------------------------------------------------------

test('merge: one operator\'s increment never clears another operator\'s 配发 (setLoadout would)', REAL, () => {
  const h = swapMatch().start();
  const m = h.m;
  const p0 = h.ps('p_0');
  // two ordinary operators with a loadout (the roster's own, set the way the briefing does). Both are put on a
  // NON-default skill: setLoadout drops an entry equal to the default, so that is what makes them persist.
  const [a, b] = PLAIN_OPS;
  assert.ok(a && b, 'the data has two plain operators with three skills');
  const [a0, a1] = nonDefaultSkills(a);
  const [b0] = nonDefaultSkills(b);
  assert.equal(p0.setLoadout({ [a]: { skill: a0 }, [b]: { skill: b0 } }), true);
  h.runToPhase(PHASE.PREP);
  // swap only `a`
  assert.deepEqual(m.setPrepLoadout('p_0', { [a]: { skill: a1 } }), { ok: true });
  assert.equal(p0.loadout[a].skill, a1, 'a changed');
  assert.equal(p0.loadout[b].skill, b0, 'b kept its 配发 — the merge is the whole point');
  // a bad increment is refused and leaves both alone
  assert.equal(m.setPrepLoadout('p_0', { [a]: { skill: 99 } }).error, ERR.BAD_TARGET);
  assert.equal(p0.loadout[a].skill, a1, 'still the good value');
  assert.equal(p0.loadout[b].skill, b0);
  // and the swap really took the DEFAULT off: back to the default drops the entry, exactly like the 干员调配 screen
  const def = DATA.chess[a].skills.find((s) => s.isDefault).index;
  assert.deepEqual(m.setPrepLoadout('p_0', { [a]: { skill: def } }), { ok: true });
  assert.equal(p0.loadout[a], undefined, 'a default choice is stored as "no entry", not as an entry');
  assert.equal(p0.loadout[b].skill, b0, 'and b is STILL untouched');
});

test('merge: an increment names ONE field — the other keeps its value (the 模组 no longer resets with the 技能)', REAL, () => {
  const h = swapMatch().start();
  const m = h.m;
  const p0 = h.ps('p_0');
  const [a] = PLAIN_OPS;
  assert.ok(a, 'the data has a plain operator with three skills');
  const [s0, s1] = nonDefaultSkills(a);
  const base = DATA.chess[a];
  const golden = DATA.chess[base.goldenId];
  const opt = loadoutOptions(base, golden);
  // a module that is NOT this operator's default: exactly the choice a default-filled increment silently discards
  const mod = opt.modules.find((id) => id !== opt.defaultModule);
  const other = opt.modules.find((id) => id !== mod && id !== opt.defaultModule) ?? opt.modules.find((id) => id !== mod);
  assert.ok(mod && other, `${a} offers two modules to move between`);
  assert.equal(p0.setLoadout({ [a]: { skill: s0, module: mod } }), true);
  h.runToPhase(PHASE.PREP);

  // a 技能-only increment: the 干员调配 screen's own `{ [id]: { skill } }` payload
  assert.deepEqual(m.setPrepLoadout('p_0', { [a]: { skill: s1 } }), { ok: true });
  assert.equal(p0.loadout[a].skill, s1);
  assert.equal(p0.loadout[a].module, mod, 'the skill swap kept the chosen module');
  // and a 模组-only increment keeps the skill (the same rule, the other way round)
  assert.deepEqual(m.setPrepLoadout('p_0', { [a]: { module: other } }), { ok: true });
  assert.equal(p0.loadout[a].module, other);
  assert.equal(p0.loadout[a].skill, s1, 'the module swap kept the chosen skill');
  // what the next battle fields: the same resolver both sides use (shared/protocol.js resolveLoadout)
  assert.deepEqual(resolveLoadout(p0.loadout, golden, (id) => DATA.chess[id]), { skillIndex: s1, moduleId: other });
  // an omitted field of an operator with NO current entry still falls back to its default (the entry is not "sticky")
  const [b] = PLAIN_OPS.filter((x) => x !== a);
  assert.deepEqual(m.setPrepLoadout('p_0', { [b]: { skill: nonDefaultSkills(b)[0] } }), { ok: true });
  assert.equal(p0.loadout[b].skill, nonDefaultSkills(b)[0]);
  assert.equal(p0.loadout[b].module, loadoutOptions(DATA.chess[b], DATA.chess[DATA.chess[b].goldenId]).defaultModule);
});

// ---------------------------------------------------------------------------------------------------
// the fix: 自选编队 pieces
// ---------------------------------------------------------------------------------------------------

test('自选编队 (the fix): an increment naming a filled slot updates that slot\'s pick and recomposes its records', REAL, () => {
  const h = swapMatch().start();
  const m = h.m;
  const p0 = h.ps('p_0');
  h.runToPhase(PHASE.PREP);

  // the slot is recognised by hasDiySlot, under its base AND its elite id (the card may show either form)
  assert.equal(p0.hasDiySlot(T5A), true);
  assert.equal(p0.hasDiySlot('chess_char_5_diy1_b'), true, 'the elite id resolves to the same slot');
  assert.equal(p0.hasDiySlot(T6A), false, 'a slot this player did not fill is not a 自选 swap');
  assert.equal(p0.hasDiySlot(SIEGE), false, 'a plain operator is not a 自选 slot');

  // the record the client shows and the sim fields, before and after
  const beforeRec = p0.gd.chess(T5A);
  assert.equal(beforeRec.skill.index, 2);
  const beforeBattle = p0.diyPickOf(T5A);
  assert.deepEqual(beforeBattle, { charId: SIEGE, skillIndex: 2, uniEquipId: SIEGE_MOD });

  assert.deepEqual(m.setPrepLoadout('p_0', { [T5A]: { skill: 0 } }), { ok: true });

  // the pick moved, and the composed records were rebuilt (not just the pick object)
  assert.equal(p0.diy[T5A].skillIndex, 0);
  assert.equal(p0.diy[T5A].uniEquipId, SIEGE_MOD, 'an omitted field keeps its value');
  const afterRec = p0.gd.chess(T5A);
  assert.equal(afterRec.skill.index, 0, 'the recomposed record fights with the new skill');
  assert.deepEqual(p0.diyPickOf(T5A), { charId: SIEGE, skillIndex: 0, uniEquipId: SIEGE_MOD });
  // the elite form too — the slot has two records and both are rebuilt
  assert.equal(p0.gd.chess('chess_char_5_diy1_b').skill.index, 0);

  // the module: an explicit 'none' unequips, another module equips
  assert.deepEqual(m.setPrepLoadout('p_0', { [T5A]: { module: MODULE_NONE } }), { ok: true });
  assert.equal(p0.diy[T5A].uniEquipId, null, '不装备');
  assert.equal(p0.diy[T5A].skillIndex, 0, 'the skill survived a module-only increment');
  assert.deepEqual(m.setPrepLoadout('p_0', { [T5A]: { module: SIEGE_MOD } }), { ok: true });
  assert.equal(p0.diy[T5A].uniEquipId, SIEGE_MOD);

  // both fields at once
  assert.deepEqual(m.setPrepLoadout('p_0', { [T5A]: { skill: 1, module: SIEGE_MOD } }), { ok: true });
  assert.deepEqual(p0.diyPickOf(T5A), { charId: SIEGE, skillIndex: 1, uniEquipId: SIEGE_MOD });
});

test('自选编队: an illegal choice is refused and the slot keeps its old pick (the data decides)', REAL, () => {
  const h = swapMatch().start();
  const m = h.m;
  const p0 = h.ps('p_0');
  h.runToPhase(PHASE.PREP);
  const before = { ...p0.diy[T5A] };
  // a skill index this operator does not have (the data's skills[] is the authority)
  assert.equal(m.setPrepLoadout('p_0', { [T5A]: { skill: 9 } }).error, ERR.BAD_TARGET);
  assert.deepEqual({ ...p0.diy[T5A] }, before);
  // a module this operator does not have
  assert.equal(m.setPrepLoadout('p_0', { [T5A]: { module: 'uniequip_999_nope' } }).error, ERR.BAD_TARGET);
  assert.deepEqual({ ...p0.diy[T5A] }, before);
  // a prototype 自选 piece carries a fixed selection (the reference mod's own rule: 原型干员仍不可换)
  assert.equal(p0.hasDiySlot(T5B), true, 'Sharp\'s slot IS a filled slot');
  assert.equal(m.setPrepLoadout('p_0', { [T5B]: { skill: 0 } }).error, ERR.BAD_TARGET, 'but its locked skill cannot be changed');
  assert.equal(p0.diy[T5B].charId, SHARP);
});

test('自选编队: the swap reaches the BATTLE (PlayerBattleInput `diy`), client-run and server-run alike', REAL, () => {
  const h = swapMatch().start();
  const m = h.m;
  const p0 = h.ps('p_0');
  h.runToPhase(PHASE.PREP);
  // slot the operator, then swap its skill, then read the battle input the field builds
  const before = p0.diy[T5A].skillIndex;
  const other = before === 0 ? 1 : 0;
  assert.deepEqual(m.setPrepLoadout('p_0', { [T5A]: { skill: other } }), { ok: true });
  const units = p0.battleInput().units ?? [];
  // no piece is on the board yet in a fresh PREP, so assert through the record the sim resolves instead
  const rec = p0.gd.chess(T5A);
  assert.equal(rec.skill.index, other, 'the record the sim composes from carries the swapped skill');
  assert.deepEqual(p0.diyPickOf(T5A), { charId: SIEGE, skillIndex: other, uniEquipId: SIEGE_MOD });
  assert.ok(Array.isArray(units), 'battleInput is readable');
  // and the composed record equals what shared/diy.js composes from the new pick (server and client share this)
  const composed = diyRecord(T5A, p0.diy[T5A], { elite: false, data: DATA });
  assert.equal(composed.skill.index, other);
});

// ---------------------------------------------------------------------------------------------------
// the client seam
// ---------------------------------------------------------------------------------------------------

test('client: the detail card offers the swap (and calls g.loadout); a 补位 stand-in and a prototype do not', () => {
  const panel = readFileSync(path.join(ROOT, 'public/js/ui/detailPanel.js'), 'utf8');
  const actionsSrc = readFileSync(path.join(ROOT, 'public/js/ui/gameActions.js'), 'utf8');
  const gameSrc = readFileSync(path.join(ROOT, 'public/js/screens/game.js'), 'utf8');
  assert.match(actionsSrc, /loadout:\s*\(entries\)\s*=>\s*act\('g\.loadout'/, 'the action sends the intent');
  assert.match(panel, /actions\.loadout\(\{ \[swapBaseId\]: fields \}\)/, 'the card sends a per-operator increment');
  // the gate: own piece, editable, not a stand-in, not a prototype 自选 piece (the flag is on the composed record)
  assert.match(panel, /const canSwap = !!!?\(?editable && piece && piece\.kind === 'chess' && !si && !c\.diyProto\)/);
  // both rows exist and are labelled
  assert.match(panel, /class="dswap dswap--skill"/);
  assert.match(panel, /class="dswap dswap--module"/);
  assert.match(panel, /onClick=\$\{\(\) => swap\(\{ skill: i \}\)\}/);
  assert.match(panel, /onClick=\$\{\(\) => swap\(\{ module: id \}\)\}/);
  // THE WIRING THAT MAKES IT VISIBLE: the game screen must hand `editable` to DetailPanel, which forwards it to
  // ChessDetail. Without that prop canSwap is always false and the rows never render in the real game — the component
  // can be perfect and still be unreachable, which is exactly the bug this assertion exists to prevent.
  // PORT NOTE (2026-10-16): this tree wraps the panel in `modComponent('loadout.detail', function DetailPanel(…))`
  // (its 组件级改写 layer), so there is no bare `export function DetailPanel` — the repo's exact pattern could never match
  // here. The intent is unchanged: the panel takes `editable` and forwards it to ChessDetail (the assertion right below).
  assert.match(panel, /function DetailPanel\(\{ detail, editable,/, 'DetailPanel takes editable');
  assert.match(panel, /ChessDetail\}[\s\S]{0,220}?editable=\$\{editable\}/, 'DetailPanel forwards editable to ChessDetail');
  assert.match(gameSrc, /DetailPanel\} detail=\$\{resolved\} editable=\$\{editable\}/, 'the game screen passes editable to DetailPanel');
  // the css is there
  const css = readFileSync(path.join(ROOT, 'public/css/screens/game-panels.css'), 'utf8');
  assert.match(css, /\.dswap \{/);
  assert.match(css, /\.dswap__label \{/);
});

// ---------------------------------------------------------------------------------------------------
// the rendered card: call the component and walk the vnode tree it returns (no browser needed)
// ---------------------------------------------------------------------------------------------------

/** Flatten a preact vnode tree into the class names and text it contains (function components are called). */
function walkVnode(node, out) {
  if (node == null || node === false || node === true) return out;
  if (typeof node === 'string' || typeof node === 'number') { out.text.push(String(node)); return out; }
  if (Array.isArray(node)) { for (const n of node) walkVnode(n, out); return out; }
  if (typeof node === 'object') {
    const props = node.props || {};
    if (typeof props.class === 'string') out.classes.push(props.class);
    if (typeof node.type === 'function') { try { walkVnode(node.type(props), out); } catch { /* a child needing context */ } }
    if (props.children != null) walkVnode(props.children, out);
  }
  return out;
}

test('client: the rendered card really shows the swap rows — and hides them where it must', REAL, async () => {
  // The detail card reads the global data store, so load it the way the page does (a fetch stand-in over data/).
  const files = {};
  for (const n of ['chess', 'backups', 'assets', 'items', 'bonds', 'garrisons', 'config', 'effects']) {
    files[n] = JSON.parse(readFileSync(path.join(ROOT, `data/${n}.json`), 'utf8'));
  }
  const { createDataStore } = await import('../../public/js/data.js');
  const store = createDataStore({
    fetch: async (url) => {
      const name = String(url).replace(/^.*\/data\//, '').replace(/\.json.*$/, '');
      return { ok: !!files[name], json: async () => files[name], text: async () => JSON.stringify(files[name]) };
    },
  });
  await store.loadAll(...Object.keys(files));
  const dataMod = await import('../../public/js/data.js');
  for (const [k, v] of Object.entries(files)) dataMod.data.set?.(k, v);
  const { ChessDetail } = await import('../../public/js/ui/detailPanel.js');
  const { diyRecordOf } = await import('../../shared/diy.js');

  const rows = (chess, extra) => {
    const out = { classes: [], text: [] };
    walkVnode(ChessDetail({ chess, onSell() {}, bonds: [], loadout: {}, ...extra }), out);
    return { skill: out.classes.some((c) => c.includes('dswap--skill')), module: out.classes.some((c) => c.includes('dswap--module')), label: out.text.includes('休整期更换') };
  };
  const piece = { kind: 'chess', uid: 1, items: [] };
  // a plain (non-elite) operator with three skills: the skill row only — modules live on the elite form
  const plain = files.chess['chess_char_3_01_a'];
  assert.deepEqual(rows(plain, { editable: true, piece }), { skill: true, module: false, label: true });
  // an elite record with modules: both rows
  assert.deepEqual(rows(files.chess['chess_char_3_01_b'], { editable: true, piece: { ...piece, golden: true } }), { skill: true, module: true, label: true });
  // NOT editable (locked / a teammate's unit / no own piece): no rows at all
  assert.deepEqual(rows(plain, { editable: false, piece }), { skill: false, module: false, label: false });
  assert.deepEqual(rows(plain, { editable: true, piece: null }), { skill: false, module: false, label: false });
  // 自选编队 (the fix): a composed owned pick DOES get the row; a prototype 自选 piece does NOT
  const diyData = { chess: files.chess, backups: files.backups };
  const ownedPick = { charId: SIEGE, skillIndex: 2, uniEquipId: SIEGE_MOD };
  const owned = diyRecordOf(files.chess[T5A], ownedPick, diyData);
  assert.equal(owned.diyProto, undefined, 'an owned pick is not a prototype');
  assert.deepEqual(rows(owned, { editable: true, piece, diy: ownedPick }), { skill: true, module: false, label: true }, '自选干员可以换 — the reference mod\'s whole point');
  const proto = diyRecordOf(files.chess[T5A], { charId: SHARP, skillIndex: 2, uniEquipId: 'uniequip_002_acguad' }, diyData);
  assert.equal(proto.diyProto, true);
  assert.deepEqual(rows(proto, { editable: true, piece, diy: { charId: SHARP } }), { skill: false, module: false, label: false }, 'a prototype keeps its locked selection');
  // the ELITE 自选 form: both rows (the elite record carries the modules — that is where a module swap lives)
  const elite = diyRecordOf(files.chess['chess_char_5_diy1_b'], ownedPick, diyData);
  assert.equal(elite.isGolden, true);
  assert.ok((elite.modules || []).length >= 2, 'the elite form has modules to choose between');
  assert.deepEqual(rows(elite, { editable: true, piece: { ...piece, golden: true }, diy: ownedPick }), { skill: true, module: true, label: true }, '精锐自选干员 also swaps its module');
});

test('client: the swap strings are translated in every pack (the i18n rule)', () => {
  for (const lang of ['en', 'ja', 'ko', 'zh-TW']) {
    const pack = JSON.parse(readFileSync(path.join(ROOT, `public/i18n/${lang}.json`), 'utf8'));
    for (const key of ['休整期更换', '切换技能', '切换模组', '当前技能', '当前模组', '切换为 {name}']) {
      assert.equal(typeof pack[key], 'string', `${lang}: ${key}`);
      assert.ok(pack[key].length > 0, `${lang}: ${key} is not empty`);
    }
  }
});

// ---------------------------------------------------------------------------------------------------
// a plain (non-自选) operator, end to end through the real intent router
// ---------------------------------------------------------------------------------------------------

test('the intent router: g.loadout reaches setPrepLoadout (a plain operator swaps through _handle)', REAL, () => {
  assert.ok(PLAIN, 'the data has a plain operator with several skills');
  const h = swapMatch().start();
  const m = h.m;
  const p0 = h.ps('p_0');
  const [s0, s1] = nonDefaultSkills(PLAIN);
  assert.equal(p0.setLoadout({ [PLAIN]: { skill: s0 } }), true);
  h.runToPhase(PHASE.PREP);
  const res = m.handle(p0.playerId, { t: 'g.loadout', entries: { [PLAIN]: { skill: s1 } } });
  assert.deepEqual(res, { ok: true }, 'the router dispatched it');
  assert.equal(p0.loadout[PLAIN].skill, s1);
});
