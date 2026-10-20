// test/ui/hextechDraft.test.js — the 协议源石 (Protocol Originium) client pieces (DESIGN §29): the m.public.hex
// normalisation the overlay renders, and the pure views (no DOM needed — ui/hexOverlay.js keeps the hooks in HexOverlay
// and the card, the enemy row and the art lookups plain functions). A card's face is the rarity's 阶位 art
// (`hextech/tier/<tier>`, the owner's supplied dot-matrix 1 / 2 / 3) when the local manifest has it, else the mod's
// rarity frame (`hxcard__head`: frame plate + name + tier chip, the effect under both); the enemy's accumulated cards
// are the labeled `hxstrip` the top bar, the 敌方情报 tab and the draft's footer show.

import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeHex, normalizeEnemyHexes } from '../../public/js/ui/gameLogic.js';
import { HexCard, EnemyHexRow, EnemyHexStrip, EnemyHexList, keepsArmed, rarityName, rarityTierArt, refreshIconUrl, hexSfxUrl } from '../../public/js/ui/hexOverlay.js';
import { Tooltip } from '../../public/js/ui/components.js';

const HEX_VIEW = {
  offers: {
    p_0: [{ idx: 0, id: 'hex_stipend', name: '战备津贴', desc: '获得时立即得到 8 资金。', rarity: 'silver', icon: 'piggyBankRune' },
      { idx: 1, id: 'hex_armor', name: '反击装甲', desc: '防御 +15%。', rarity: 'gold', icon: 'adamantRune' },
      { idx: 2, id: 'hex_immortal', name: '不灭壁垒', desc: '生命上限 +12%。', rarity: 'prismatic', icon: 'undyingUpgradeRune' }],
    p_1: [{ idx: 0, id: 'hex_echo', name: '盟约回响', desc: '随机盟约 +1 层。', rarity: 'silver', icon: 'echoRune' }],
  },
  picks: { p_1: 0 },
  rerollsLeft: { p_0: 1, p_1: 0 },
  untimed: false,
  turnDeadline: 1234,
  timerSec: 30,
};

test('normalizeHex: the local player\'s own offer, their pick and their rerolls', () => {
  const hex = normalizeHex(HEX_VIEW, 'p_0', []);
  assert.equal(hex.myOffer.length, 3);
  assert.deepEqual(hex.myOffer.map((c) => c.idx), [0, 1, 2]);
  assert.equal(hex.myPick, null);
  assert.equal(hex.myRerolls, 1);
  assert.equal(hex.untimed, false);
  assert.equal(hex.timerSec, 30);
  assert.equal(hex.turnDeadline, 1234);
  assert.equal(hex.decided, false, 'p_0 has not picked');
  assert.equal(hex.offers.get('p_1')[0].id, 'hex_echo');
  // the other player's pick is visible (the enemy draw reads the rarities picked this round)
  assert.equal(hex.picks.get('p_1'), 0);
  assert.equal(hex.rerollsLeft.get('p_1'), 0);
});

test('normalizeHex: after the pick, and tolerant of missing / malformed frames', () => {
  const picked = normalizeHex({ ...HEX_VIEW, picks: { p_0: 2, p_1: 0 } }, 'p_0', []);
  assert.equal(picked.myPick, 2);
  assert.equal(picked.decided, true);
  assert.equal(normalizeHex(null, 'p_0'), null);
  assert.equal(normalizeHex({}, 'p_0').myOffer.length, 0);
  assert.equal(normalizeHex({ offers: { p_0: 'nope' } }, 'p_0').myOffer.length, 0);
  // an unknown viewer (spectator) gets no offer but still the frame
  const spectator = normalizeHex(HEX_VIEW, 'spec_1', []);
  assert.equal(spectator.myOffer.length, 0);
  assert.equal(spectator.myRerolls, 0);
});

test('单张刷新是每张卡各一次（业主 2026-10-20「单个刷新应该3个都能刷一次」）', () => {
  // the server publishes slotRerollsLeft per viewer; the client falls back to 1 per card when the key is absent (an
  // older server) so the buttons never all go dark on a mixed deployment
  const withBudget = normalizeHex({ ...HEX_VIEW, slotRerollsLeft: { p_0: [1, 0, 1], p_1: [0, 0, 0] } }, 'p_0', []);
  assert.deepEqual(withBudget.mySlotRerolls, [1, 0, 1]);
  const oldServer = normalizeHex(HEX_VIEW, 'p_0', []);
  assert.deepEqual(oldServer.mySlotRerolls, [1, 1, 1], 'no key from the server -> every card still has its own one');
  const spectator = normalizeHex(HEX_VIEW, 'spec_1', []);
  assert.deepEqual(spectator.mySlotRerolls, [], 'a viewer with no offer has no cards to reroll');
  // the two budgets are independent: the whole-batch counter and the per-card ones
  assert.equal(withBudget.myRerolls, 1, 'the batch reroll is its own number');
});

test('rarityName resolves the tier label and keeps a fallback', () => {
  assert.equal(typeof rarityName('silver'), 'string');
  assert.equal(rarityName('prismatic').length > 0, true);
  assert.equal(rarityName('nope'), '');
});

/** How many vnodes of `type` a htm tree holds (the component functions cannot be counted through JSON). */
function countVnodes(node, type) {
  if (Array.isArray(node)) return node.reduce((s, x) => s + countVnodes(x, type), 0);
  if (!node || typeof node !== 'object') return 0;
  let n = node.type === type ? 1 : 0;
  const kids = node.props?.children;
  if (kids !== undefined) n += countVnodes(kids, type);
  return n;
}

test('HexCard renders a card (and a compact one for the enemy row)', () => {
  const full = HexCard({ hex: HEX_VIEW.offers.p_0[1], armed: true, onClick: () => {} });
  assert.ok(full && typeof full === 'object', 'a vnode comes back');
  const compact = HexCard({ hex: HEX_VIEW.offers.p_0[0], compact: true });
  assert.ok(compact && typeof compact === 'object');
  // the class carries the rarity and the states the CSS keys on
  const cls = String(full.props?.class ?? '');
  assert.ok(cls.includes('hxcard--gold'), cls);
  assert.ok(cls.includes('is-armed'), cls);
  assert.ok(String(compact.props?.class ?? '').includes('hxcard--compact'));
  // the official layout: the head holds the rune plate and the title (name + rarity chip), the effect text follows, and
  // an armed card carries the 确认选择 · 再次点击 strip
  const markup = JSON.stringify(full);
  for (const part of ['hxcard__head', 'hxcard__plate', 'hxcard__title', 'hxcard__name', 'hxcard__rarity', 'hxcard__desc', 'hxcard__confirm']) {
    assert.ok(markup.includes(part), `the card renders ${part}`);
  }
  assert.ok(!cls.includes('has-frame'), 'the framed fallback is gone with the third-party frames (2026-10-12)');
  assert.ok(markup.includes('hxcard__glyph'), 'the drawn plate carries the name\'s first character');
  // a display-only card (no handler) is a span without the pick strips
  assert.ok(!JSON.stringify(compact).includes('hxcard__confirm'));
});

test('分别刷新 (业主 2026-10-20): each card can carry its own reroll control, as a SIBLING of the card button', () => {
  const rerolled = [];
  const card = HexCard({ hex: HEX_VIEW.offers.p_0[1], onClick: () => {}, onReroll: () => rerolled.push('r'), rerollTitle: '只刷新这一张（剩余 1 次）' });
  // the slot wraps the card and the control: a <button> inside a <button> is invalid HTML, and the inner click would
  // also arm / pick the card
  const markup = JSON.stringify(card);
  assert.ok(markup.includes('hxcard-slot'), 'the card is wrapped in its slot');
  assert.ok(markup.includes('hxcard__reroll'), 'the card carries its own reroll control');
  assert.ok(markup.includes('data-testid":"hex-reroll-1') || markup.includes('hex-reroll-1'), 'keyed by the slot index');
  assert.ok(markup.includes('只刷新这一张'), 'its tooltip names the single-card reroll');
  // the control is NOT a child of the card button: the card itself is still the pick target
  assert.equal(countVnodes(card, 'button') > 1, true, 'card button + reroll button are two siblings');
  // without a handler the control is not rendered at all (a picked / finished draft shows no reroll)
  assert.ok(!JSON.stringify(HexCard({ hex: HEX_VIEW.offers.p_0[1], onClick: () => {} })).includes('hxcard__reroll'));
  assert.ok(!JSON.stringify(HexCard({ hex: HEX_VIEW.offers.p_0[1] })).includes('hxcard__reroll'), 'a display-only card has none');
});

test('the art lookups fall back to null without the local-client manifest (the drawn plate / glyph then draw)', () => {
  assert.equal(rarityTierArt('gold'), null);
  assert.equal(refreshIconUrl(), null);
  assert.equal(hexSfxUrl('selectGold'), null);
  // every rarity of data/hextech.json resolves to a display name without throwing
  for (const r of ['silver', 'gold', 'prismatic']) assert.ok(rarityName(r));
});

test('keepsArmed: the confirm button (and the cards, and the reroll button) never disarm the selection', () => {
  /** An element stand-in: `closest` answers whether one of the selector's parts matches its class list. */
  const el = (...classes) => ({ closest: (sel) => (sel.split(', ').some((s) => classes.includes(s.slice(1))) ? {} : null) });
  assert.equal(keepsArmed(el('hxcard')), true, 'the card of the double tap');
  assert.equal(keepsArmed(el('hxcard', 'is-armed')), true);
  assert.equal(keepsArmed(el('toolbtn', 'toolbtn--amber', 'hxov__reroll')), true, 'the reroll button');
  assert.equal(keepsArmed(el('btn', 'spov__confirm')), true, 'the 确认选择 button — its own pointerdown must not disarm it');
  assert.equal(keepsArmed(el('spov__veil')), false, 'a press elsewhere drops the selection');
  assert.equal(keepsArmed(el('hxcard__glyph')), false, 'a nested node with no matching ancestor');
  assert.equal(keepsArmed(null), false);
  assert.equal(keepsArmed({}), false);
});

/** The single vnode of `type` in a tree (the first one), or null. */
function findVnode(node, type) {
  if (Array.isArray(node)) { for (const x of node) { const r = findVnode(x, type); if (r) return r; } return null; }
  if (!node || typeof node !== 'object') return null;
  if (node.type === type) return node;
  return findVnode(node.props?.children, type);
}

test('the enemy row is the labeled strip (nothing without hexes); the 敌方情报 tab and the top bar share it', () => {
  assert.equal(EnemyHexRow({ list: [] }), null);
  assert.equal(EnemyHexRow({ list: null }), null);
  assert.equal(EnemyHexStrip({ list: undefined }), null);
  const list = [{ id: 'ehex_fury', name: '狂攻', desc: '攻击 +15%。', rarity: 'gold', drawRound: 6 }];
  // the row is wrapped in the app Tooltip (a native `title` never shows on a touch screen: the user report 2026-10-11)
  const bare = EnemyHexRow({ list });
  assert.ok(bare && typeof bare === 'object');
  const bareStrip = findVnode(bare, 'span');
  assert.ok(String(bareStrip?.props?.class ?? '').includes('hxstrip'), String(bareStrip?.props?.class));
  assert.equal(countVnodes(bare, HexCard), 1, 'one compact chip per enemy hex');
  assert.ok(!JSON.stringify(bare).includes('hxstrip__label'), 'no label without one');
  const strip = EnemyHexStrip({ list, class: 'edrawer__hex' });
  const cls = String(findVnode(strip, 'span')?.props?.class ?? '');
  assert.ok(cls.includes('hxstrip--labeled') && cls.includes('edrawer__hex'), cls);
  assert.ok(JSON.stringify(strip).includes('hxstrip__label'), 'the labeled strip names the row');
  assert.equal(countVnodes(strip, HexCard), 1);
  // the row tolerates the raw m.public shape and drops junk, like normalizeEnemyHexes
  assert.equal(EnemyHexRow({ list: [null, { name: 'no id' }] }), null);
});

test('the enemy row and its chips reach a phone: a TAP opens the app Tooltip, never a native `title`', () => {
  const list = [
    { id: 'ehex_fury', name: '狂攻', desc: '攻击 +15%。', rarity: 'gold', drawRound: 1 },
    { id: 'ehex_swarm', name: '虫群', desc: '敌人数量增加，但最大生命值 −8%。', rarity: 'silver', drawRound: 6 },
  ];
  const row = EnemyHexRow({ list });
  // The row's text lives in a Tooltip (tap on touch, hover on desktop)…
  const tip = findVnode(row, Tooltip);
  assert.ok(tip, 'the row is wrapped in the app Tooltip');
  assert.equal(tip.props.text, '狂攻 · 攻击 +15%。\n虫群 · 敌人数量增加，但最大生命值 −8%。');
  // …and it asks for TAP activation: a phone player's first instinct is a tap, and the chips have no tap action of
  // their own (user request 2026-10-11: 「把长按换成点击就能触发」).
  assert.equal(tip.props.tapShow, true, 'a tap opens it (not only a long press)');
  // …and the chips carry NO native title: on a touch screen that attribute is dead, which is exactly the reported bug.
  const chips = [];
  (function walk(n) { if (Array.isArray(n)) return n.forEach(walk); if (!n || typeof n !== 'object') return; if (n.type === HexCard) chips.push(n); walk(n.props?.children); })(row);
  assert.equal(chips.length, 2);
  for (const c of chips) {
    assert.equal(HexCard({ ...c.props }).props?.title ?? null, null, 'a compact chip prints no native title');
  }
  // the strip is reachable for keyboard / assistive tech too, and names every card
  const strip = findVnode(row, 'span');
  assert.equal(strip.props.role, 'button');
  assert.equal(strip.props.tabindex, '0');
  assert.ok(String(strip.props['aria-label']).includes('狂攻') && String(strip.props['aria-label']).includes('虫群'), strip.props['aria-label']);
  // a FULL card still keeps its own text on the card (and its native title for the desktop hover)
  const full = HexCard({ hex: list[0] });
  assert.ok(String(full.props?.title ?? '').includes('狂攻'), 'a full card keeps its title');
});

test('the 敌方情报 readable list prints every card in words (the phone answer to the chip tooltip)', () => {
  assert.equal(EnemyHexList({ list: [] }), null);
  assert.equal(EnemyHexList({ list: null }), null);
  assert.equal(EnemyHexList({ list: [null, { name: 'no id' }] }), null);
  const list = [
    { id: 'ehex_fury', name: '狂攻', desc: '攻击 +15%。', rarity: 'gold', drawRound: 1 },
    { id: 'ehex_swarm', name: '虫群', desc: '敌人数量增加，但最大生命值 −8%。', rarity: 'silver', drawRound: 6 },
  ];
  const el = EnemyHexList({ list, label: '敌方协议源石' });
  assert.ok(el && typeof el === 'object');
  const markup = JSON.stringify(el);
  // the words are ON SCREEN — no tooltip, no title, no hover needed
  for (const s of ['狂攻', '攻击 +15%。', '虫群', '敌人数量增加，但最大生命值 −8%。', '敌方协议源石']) {
    assert.ok(markup.includes(s), `the list prints ${s}`);
  }
  assert.equal(countVnodes(el, HexCard), 2, 'each row still shows its 阶位 chip');
  assert.ok(!markup.includes('"title"'), 'nothing here depends on a native title');
  assert.ok(markup.includes('hxlist__tier'), 'the tier is printed too');
  assert.equal(countVnodes(el, Tooltip), 0, 'the list itself needs no tooltip');
});

test('normalizeEnemyHexes keeps the accumulated enemy list and drops junk', () => {
  const list = normalizeEnemyHexes([{ id: 'ehex_fury', name: '狂攻', desc: '攻击 +15%。', rarity: 'gold', drawRound: 6 }, null, { name: 'no id' }]);
  assert.equal(list.length, 1);
  assert.equal(list[0].id, 'ehex_fury');
  assert.deepEqual(normalizeEnemyHexes(null), []);
});
