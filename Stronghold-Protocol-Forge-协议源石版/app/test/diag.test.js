// test/diag.test.js — the client's error log and bug-report diagnostics (public/js/diag.js; 设置 → 问题反馈): what an
// entry keeps (message, a short stack without the page's host), repeats counted on one entry, the cap, the report's
// lines, the battle attached as a replayable b.start, and that the player names / token never reach the text while the
// room code deliberately does (the owner reads reports in /admin/ and needs to know which room).
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  recordError, errorLog, errorCount, clearErrorLog, messageOf, stackOf, stripHosts, redact, redactValues, secretsOf, buildDiagnostics,
  diagnosticsPayload, setBattleSource, currentBattle, LOG_MAX, STACK_LINES, recordResourceEntry, trafficSummary, trafficLine, clearTraffic, installTrafficMeter,
  isDomEvent, isResourceEvent, eventLabel,
} from '../public/js/diag.js';
import { META_KEYS } from '../server/feedback.js';
import { APP_VERSION } from '../shared/constants.js';

const v8Error = (msg = 'boom') => {
  const e = new TypeError(msg);
  e.stack = [`TypeError: ${msg}`, ...Array.from({ length: 9 }, (_, i) => `    at f${i} (http://192.168.1.5:3000/js/ui/a.js:${i + 1}:7)`)].join('\n');
  return e;
};

describe('the error log', () => {
  beforeEach(() => clearErrorLog());

  test('an entry keeps the message and the first frames of the stack, without the page\'s scheme and host', () => {
    const e = recordError('error', v8Error('x is undefined'), null, 1000);
    assert.equal(e.message, 'TypeError: x is undefined');
    const frames = e.stack.split('\n');
    assert.equal(frames.length, STACK_LINES);
    assert.equal(frames[0], 'at f0 (/js/ui/a.js:1:7)');
    assert.ok(!e.stack.includes('192.168.1.5'));
    // Firefox / Safari stacks list frames only: the first line is a frame and stays
    assert.equal(stackOf({ stack: 'g@https://sp.example/sim/x.js:3:9\nh@https://sp.example/sim/y.js:1:1' }), 'g@/sim/x.js:3:9\nh@/sim/y.js:1:1');
    assert.equal(stackOf('a string'), null);
  });

  test('messages of a NetError, a {code, msg} push, a string and a plain object', () => {
    assert.equal(messageOf(Object.assign(new Error('请求超时'), { name: 'NetError', code: 'TIMEOUT' })), 'NetError: 请求超时 (TIMEOUT)');
    assert.equal(messageOf({ code: 'ROOM_FULL', msg: '房间已满' }), '房间已满 (ROOM_FULL)');
    assert.equal(messageOf({ code: 'OFFLINE' }), 'OFFLINE');
    assert.equal(messageOf('  plain   text '), 'plain text');
    assert.equal(messageOf({ a: 1 }), '{"a":1}');
    assert.equal(messageOf(null), 'null');
    assert.ok(messageOf('x'.repeat(500)).length <= 300);
    assert.equal(stripHosts('see http://10.0.0.2:3000/x.js and https://a.b/c'), 'see /x.js and /c');
  });

  test('a DOM Event as the reason names the event and its element, not just {"isTrusted":true}', () => {
    // A promise wired straight to an `onerror` handler rejects with the Event itself, and a real Event keeps `type` /
    // `target` on the PROTOTYPE — so `JSON.stringify` saw only `{"isTrusted":true}`. A player's report showed exactly
    // that (2026-10-14) and it named nothing at all. These pin the diagnosis-carrying shape.
    const img = { tagName: 'IMG', currentSrc: 'https://cdn.example.com/assets/char/a.png' };
    const ev = Object.assign(Object.create({ type: 'error', isTrusted: true, target: img }), {});
    const msg = messageOf(ev);
    assert.match(msg, /Event\(/, 'must be recognisable as an Event');
    assert.match(msg, /type=error/, 'the event TYPE is the first thing a report needs');
    assert.match(msg, /img/i, 'and the element it happened to');
    assert.match(msg, /a\.png/, 'and which file, with the host stripped');
    assert.ok(!/isTrusted/.test(msg), '「isTrusted」 alone is noise, not a diagnosis');
    assert.ok(!/https?:\/\//.test(msg), 'a host must never reach the report');
    // An event carrying the real error keeps it.
    assert.match(messageOf({ type: 'error', isTrusted: true, error: new Error('boom') }), /boom/);
    // Newlines/whitespace still collapse, and the message stays bounded.
    assert.ok(messageOf(Object.assign(Object.create({ type: 'error', isTrusted: true }), {})).length <= 300);
  });

  test('isDomEvent / isResourceEvent classify the shape, and an app error never looks like an Event', () => {
    const el = (tag, src) => ({ tagName: tag, currentSrc: src });
    const ev = (type, target) => Object.assign(Object.create({ type, isTrusted: true, target }), {});
    assert.equal(isDomEvent(ev('error', el('IMG'))), true);
    assert.equal(isResourceEvent(ev('error', el('IMG'))), true, 'a failed <img> is a resource, not an app error');
    assert.equal(isResourceEvent(ev('error', el('DIV'))), false, 'the same event on a plain element is NOT swallowed');
    assert.equal(isResourceEvent({ type: 'error', isTrusted: true, srcElement: el('SCRIPT') }), true, 'PIXI forwards srcElement, not target');
    // Real errors must never be mistaken for an Event — this is the guard that keeps a genuine bug visible.
    for (const appErr of [{ code: 'NO_FUNDS' }, new Error('boom'), { code: 'X', type: 'error' }, 'plain', null]) {
      assert.equal(isDomEvent(appErr), false, `${JSON.stringify(appErr)} is not an Event`);
      assert.equal(isResourceEvent(appErr), false);
    }
    // The label both the report and the toast are built from: type first, then the element, host stripped.
    const label = eventLabel(ev('error', el('IMG', 'https://cdn.example.com/a/b.png')));
    assert.match(label, /^type=error/);
    assert.match(label, /target=img/);
    assert.match(label, /\/a\/b\.png/);
    assert.ok(!/https?:/.test(label), 'the host must not survive into a report or a toast');
  });

  test('the toast and the report agree about an Event (three copies of this rule once drifted)', () => {
    // The 2026-10-15 defect: `messageOf` learned the Event shape, `describeError` did not, and the player still saw
    // 「未知错误」. They now share `isDomEvent` — so an Event that the report calls an Event must never be reported to the
    // player as a nameless failure. (toasts.js is imported here so the two cannot silently diverge again.)
    return import('../public/js/ui/toasts.js').then(({ describeError }) => {
      const ev = Object.assign(Object.create({ type: 'error', isTrusted: true, target: { tagName: 'IMG' } }), {});
      assert.ok(isDomEvent(ev));
      const report = messageOf(ev);
      const toast = describeError(ev);
      assert.ok(!/^发生未知错误$/.test(toast), `the toast must not be the bare fallback: ${toast}`);
      assert.match(toast, /type=error/, 'the toast names the same event the report does');
      assert.match(report, /type=error/);
    });
  });

  test('the same error again raises the count of its entry; another source or message is a new entry', () => {
    recordError('sim', '[sim] skill failed', null, 1000);
    recordError('sim', '[sim] skill failed', null, 2000);
    recordError('sim', '[sim] skill failed', null, 3000);
    recordError('runner', '[sim] skill failed', null, 4000);
    recordError('runner', 'other', null, 5000);
    const log = errorLog();
    assert.deepEqual(log.map((e) => [e.source, e.count]), [['sim', 3], ['runner', 1], ['runner', 1]]);
    assert.equal(log[0].lastAt, 3000);
    assert.equal(errorCount(), 5);
  });

  test('the log keeps the newest LOG_MAX entries and the report says how many were dropped', () => {
    for (let i = 0; i < LOG_MAX + 5; i++) recordError('error', `e${i}`, null, i * 1000);
    const log = errorLog();
    assert.equal(log.length, LOG_MAX);
    assert.equal(log[0].message, 'e5');
    const text = buildDiagnostics({ state: {}, now: 100000, pageStart: 0 });
    assert.match(text, /errors: 45 recorded, 5 oldest entries dropped/);
    assert.match(text, /#1 00:00:44 error: e44/, 'newest first');
    clearErrorLog();
    assert.equal(errorCount(), 0);
    assert.equal(errorLog().length, 0);
  });
});

describe('the report', () => {
  beforeEach(() => clearErrorLog());

  const state = {
    connection: { status: 'online', ping: 41.6, attempt: 0, lastError: null },
    me: { playerId: 'p_1', name: '阿米娅', token: 'tok-secret-123' },
    session: { entered: true },
    room: { code: 'K7Q2', mode: 'coop', difficulty: 'HARD', seats: [{ name: '阿米娅' }, { name: 'Kal' }, { name: 'Kaltsit' }, null], spectators: [{ name: 'W' }] },
    match: {
      public: { phase: 'COMBAT', round: 9, players: [{ playerId: 'p_1', name: '阿米娅' }, { playerId: 'p_2', name: 'Kal' }] },
      battle: { kind: 'unite', fieldId: 'u', authoritative: true, done: false, speed: 2 },
    },
  };
  const env = { ua: 'Mozilla/5.0 Test', gpu: 'ANGLE (Test GPU)', viewport: '844x390', dpr: 2, touch: true, cores: 8, lang: 'zh-CN', uiLang: 'zh' };

  test('version, time, browser, device, connection, where the player is, the battle, the settings and the errors', () => {
    recordError('request', { code: 'ROOM_FULL', msg: '房间已满' }, null, Date.UTC(2026, 9, 8, 12, 0, 5));
    recordError('sim', '[sim] onAttack (char_391_rosmon) failed: TypeError: x', null, Date.UTC(2026, 9, 8, 12, 0, 9));
    recordError('sim', '[sim] onAttack (char_391_rosmon) failed: TypeError: x', null, Date.UTC(2026, 9, 8, 12, 0, 12));
    const text = buildDiagnostics({ state, env, settings: { quality: 'low', damageNumbers: true, muted: false },
      now: Date.UTC(2026, 9, 8, 12, 1, 0), pageStart: Date.UTC(2026, 9, 8, 11, 48, 30) });
    const lines = text.split('\n');
    assert.equal(lines[0], '```text');
    assert.equal(lines[1], 'Stronghold-Protocol diagnostics');
    assert.equal(lines[2], `version: ${APP_VERSION}`);
    assert.equal(lines[3], 'time: 2026-10-08T12:01:00.000Z | page open 12m 30s');
    assert.ok(lines.includes('browser: Mozilla/5.0 Test'));
    assert.ok(lines.includes('gpu: ANGLE (Test GPU)'));
    assert.ok(lines.includes('device: 844x390 | @2x | touch | 8 threads | lang zh-CN | ui zh'));
    assert.ok(lines.includes('connection: online | ping 42 ms'));
    assert.ok(lines.includes('where: phase COMBAT | room K7Q2 | round 9 | mode coop | difficulty HARD | players 2'));
    assert.ok(lines.includes('battle: unite | field u | authoritative | running | 2x'));
    assert.ok(lines.includes('settings: quality low | damage numbers'));
    assert.ok(lines.includes('errors: 3 recorded'));
    assert.ok(lines.includes('#1 12:00:09 (x2, last 12:00:12) sim: [sim] onAttack (char_391_rosmon) failed: TypeError: x'));
    assert.ok(lines.includes('#2 12:00:05 request: 房间已满 (ROOM_FULL)'));
    assert.equal(lines.at(-1), '```');
    assert.ok(!text.includes('```json'), 'no battle attached');
  });

  test('player names and the reconnect token never reach the text; the room code is KEPT (the owner asked for it)', () => {
    recordError('request', '阿米娅 left room K7Q2 (token tok-secret-123)', 'Kaltsit and Kal and W');
    const text = buildDiagnostics({ state, env });
    for (const secret of ['阿米娅', 'Kaltsit', 'Kal ', 'tok-secret-123']) assert.ok(!text.includes(secret), secret);
    assert.match(text, /request: <me> left room K7Q2 \(token <token>\)/, 'the room code survives; the token does not');
    assert.ok(text.includes('where: phase COMBAT | room K7Q2 | round 9 | mode coop'), 'the phase leads and the room code still appears');
    // the longer name is replaced first, so 'Kaltsit' does not become '<player2>tsit'; the one-letter 'W' as a word
    assert.ok(text.includes('\n   <player3> and <player2> and <player4>\n'));
    assert.deepEqual(secretsOf(state).map(([, p]) => p), ['<me>', '<player2>', '<player3>', '<player4>', '<token>']);
    assert.equal(redact('ab a cab W-W Windows', [['a', 'X'], ['ab', 'Y'], ['W', 'V'], ['', 'Z']]), 'Y X cab V-V Windows',
      'every value, short or long, is a whole token');
    assert.equal(redact('player and players', [['player', '<p1>'], ['Kaltsit', '<player2>']]), '<p1> and players',
      'a longer word is not cut');
    assert.equal(redact('a.b a+b', [['a.b', 'R']]), 'R a+b', 'regex characters in a value are literal');
    assert.equal(redact('char chess_char_1013_chen2', [['char', '<me>']]), '<me> chess_char_1013_chen2',
      'a name does not eat a chess id');
  });

  test('outside a match the where line names the room by its code, so the owner knows which room a report is about', () => {
    const idle = { ...state, match: null, session: { entered: true } };
    const text = buildDiagnostics({ state: idle, env });
    assert.ok(text.includes('where: room K7Q2 | mode coop | difficulty HARD | seats 3'), text.split('\n').find((l) => l.startsWith('where:')));
    // ...and with no code at all the label degrades to the bare word instead of printing "room undefined"
    const noCode = { ...idle, room: { ...state.room, code: undefined } };
    assert.ok(buildDiagnostics({ state: noCode, env }).includes('where: room | mode coop'));
  });

  test('a name like char replaces a whole token and an exact JSON string, never a longer id', () => {
    const named = {
      ...state,
      me: { ...state.me, name: 'char' },
      room: { ...state.room, seats: [{ name: 'char' }, { name: 'Ship' }], spectators: [] },
      match: { ...state.match, public: { ...state.match.public, players: [{ playerId: 'p_1', name: 'char' }, { playerId: 'p_2', name: 'Ship' }] } },
    };
    recordError('sim', 'char failed on chess_char_1013_chen2', 'yanShip stayed');
    const spec = {
      v: 1,
      units: [{ id: 'chess_char_1013_chen2', key: 'char', note: 'charge the char', ship: 'yanShip' }],
      name: 'char',
      tag: 'Ship',
    };
    const text = buildDiagnostics({
      state: named, env, battle: { battleId: 'k1', fieldId: 'u', kind: 'unite', spec, time: 1 },
    });
    assert.match(text, /sim: <me> failed on chess_char_1013_chen2/);
    assert.ok(text.includes('yanShip stayed'), 'Ship does not match inside yanShip');
    const json = JSON.parse(text.slice(text.indexOf('```json\n') + 8, text.lastIndexOf('\n```')));
    assert.equal(json.spec.units[0].id, 'chess_char_1013_chen2');
    assert.equal(json.spec.units[0].key, '<me>');
    assert.equal(json.spec.units[0].note, 'charge the char');
    assert.equal(json.spec.units[0].ship, 'yanShip');
    assert.equal(json.spec.name, '<me>');
    assert.equal(json.spec.tag, '<player2>');
    assert.equal(JSON.stringify(json).includes('"char"'), false);
    assert.deepEqual(redactValues(
      { id: 'chess_char_1013_chen2', char: 'keep', name: 'char', note: 'charge the char', list: ['char', 'chess_char_1013_chen2'] },
      [['char', '<me>']],
    ), { id: 'chess_char_1013_chen2', '<me>': 'keep', name: '<me>', note: 'charge the char', list: ['<me>', 'chess_char_1013_chen2'] });
  });

  test('the battle on screen is attached as a b.start the dev tools replay (player ids, no names)', () => {
    const spec = { v: 1, battleId: 'k1-1.9.40.u', fieldId: 'u', kind: 'unite', seed: 7, round: 9, players: [{ playerId: 'p_1' }, { playerId: 'p_2' }] };
    const text = buildDiagnostics({ state, env, battle: { battleId: spec.battleId, fieldId: 'u', kind: 'unite', spec, time: 12.4 } });
    assert.ok(text.includes('\n\nbattle k1-1.9.40.u | unite | round 9 | copied at 12.40 s\n```json\n'));
    const json = JSON.parse(text.slice(text.indexOf('```json\n') + 8, text.lastIndexOf('\n```')));
    assert.deepEqual(json, { t: 'b.start', battleId: spec.battleId, fieldId: 'u', kind: 'unite', spec });
  });

  test('an empty page: the title screen, nothing recorded, unknown fields left out', () => {
    const text = buildDiagnostics({ state: {}, now: 0, pageStart: 0 });
    assert.match(text, /\nwhere: title\n/);
    assert.match(text, /\nconnection: unknown\n/);
    assert.match(text, /\ndevice: unknown\n/);
    assert.match(text, /\nerrors: none recorded\n```$/);
    assert.ok(!/browser:|gpu:|battle:|settings:/.test(text));
  });

  test('the battle source: none, a battle, and a source that throws', () => {
    setBattleSource(null);
    assert.equal(currentBattle(), null);
    setBattleSource(() => ({ battleId: 'b', spec: {} }));
    assert.deepEqual(currentBattle(), { battleId: 'b', spec: {} });
    setBattleSource(() => { throw new Error('gone'); });
    assert.equal(currentBattle(), null);
    setBattleSource(null);
  });

  test('the POST /api/feedback body: the description, the report text and only the server\'s known meta keys', () => {
    const payload = diagnosticsPayload({ state, description: '点了开始没反应', attachBattle: false });
    assert.equal(payload.description, '点了开始没反应');
    assert.ok(payload.report.startsWith('```text\nStronghold-Protocol diagnostics'), 'the same text as diagnosticsText');
    assert.equal(payload.report.includes('K7Q2'), true, 'the room code is in the report');
    // uiLang comes from browserEnv(): null under Node, so it is absent here (the store drops absent keys).
    assert.deepEqual(payload.meta, { version: APP_VERSION, phase: 'COMBAT', round: '9', mode: 'coop', difficulty: 'HARD', room: 'K7Q2' },
      'the scalars the panel filters on, and no nulls');
    for (const k of Object.keys(payload.meta)) {
      assert.ok(META_KEYS.includes(k), `${k} is a key server/feedback.js keeps`);
      assert.notEqual(payload.meta[k], null, `${k} is not null`);
    }
    // the title screen: nothing to say about phase/room, and those keys are simply absent
    const bare = diagnosticsPayload({ state: {}, description: '', attachBattle: false });
    assert.deepEqual(bare.meta, { version: APP_VERSION });
    assert.equal(bare.description, '');
    // the description is capped client-side too (the server caps it again)
    assert.equal(diagnosticsPayload({ state, description: 'x'.repeat(900) }).description.length, 500);
  });

  test('the payload never carries the token or a player name, and keeps the room code', () => {
    const payload = diagnosticsPayload({ state, description: 'Kaltsit 卡住了', attachBattle: true });
    const json = JSON.stringify(payload);
    assert.ok(!json.includes('tok-secret-123'), 'the reconnect token never leaves the page');
    assert.ok(!json.includes('阿米娅'), 'a player name never reaches the report or the attached battle');
    assert.ok(json.includes('K7Q2'), 'the room code is kept on purpose (the owner asked for it)');
    // the description is the player's own words: it is theirs to write, whatever it contains
    assert.equal(payload.description, 'Kaltsit 卡住了');
    // attaching a battle must not mutate the state it read
    assert.equal(state.match.public.players[0].name, '阿米娅');
  });
});

describe('the page\'s traffic (host bandwidth layer 0)', () => {
  beforeEach(() => clearTraffic());
  const ORIGIN = 'http://192.168.1.5:3000';

  test('Resource Timing entries sum by category: bytes on the wire, a cache hit counted as cached, other sites apart', () => {
    recordResourceEntry({ name: `${ORIGIN}/assets/~0123456789abcdef/spine/op/x/front/x.skel`, transferSize: 120000, decodedBodySize: 400000 }, ORIGIN);
    recordResourceEntry({ name: `${ORIGIN}/assets/char/avatar/a.png`, transferSize: 0, decodedBodySize: 50000 }, ORIGIN);
    recordResourceEntry({ name: `${ORIGIN}/media/~0123456789abcdef/bgm/m_bat`, transferSize: 2000000, decodedBodySize: 2000000 }, ORIGIN);
    recordResourceEntry({ name: `${ORIGIN}/js/main.js`, transferSize: 9000, decodedBodySize: 30000 }, ORIGIN);
    recordResourceEntry({ name: `${ORIGIN}/data/assets.json`, transferSize: 300, decodedBodySize: 1300000 }, ORIGIN);
    recordResourceEntry({ name: 'https://fonts.gstatic.com/s/x.woff2', transferSize: 50000 }, ORIGIN);
    recordResourceEntry({ name: 'data:image/png;base64,AAAA', transferSize: 0 }, ORIGIN);
    recordResourceEntry({ name: 'blob:http://192.168.1.5:3000/1234', transferSize: 0 }, ORIGIN);
    recordResourceEntry(null, ORIGIN);
    const t = trafficSummary();
    assert.deepEqual(t.assets, { requests: 2, bytes: 120000, cached: 1 });
    assert.deepEqual(t.audio, { requests: 1, bytes: 2000000, cached: 0 });
    assert.deepEqual(t.code, { requests: 1, bytes: 9000, cached: 0 });
    assert.deepEqual(t.data, { requests: 1, bytes: 300, cached: 0 }, 'a 304 costs its headers only');
    assert.deepEqual(t.external, { requests: 1, bytes: 50000, cached: 0 });
    assert.deepEqual(t.total, { requests: 5, bytes: 2129300, cached: 1 }, 'the host total leaves other sites out');
    assert.deepEqual(Object.keys(t), ['assets', 'audio', 'code', 'data', 'external', 'total']);
    assert.equal(trafficLine(t), 'assets 120 KB (2, 1 cached) | audio 2.0 MB (1) | code 9 KB (1) | data 300 B (1) | external 50 KB (1) | host total 2.1 MB (5)');
  });

  test('the report carries the traffic line; nothing recorded → no line', () => {
    recordResourceEntry({ name: `${ORIGIN}/js/main.js`, transferSize: 1500 }, ORIGIN);
    const text = buildDiagnostics({ state: {}, now: 0, pageStart: 0, traffic: trafficSummary() });
    assert.match(text, /\ntraffic: code 2 KB \(1\) \| host total 2 KB \(1\)\n/);
    clearTraffic();
    assert.ok(!/traffic:/.test(buildDiagnostics({ state: {}, now: 0, pageStart: 0, traffic: trafficSummary() })));
    assert.ok(!/traffic:/.test(buildDiagnostics({ state: {}, now: 0, pageStart: 0 })));
  });

  test('installTrafficMeter reads the navigation entry and observes the resources (buffered), once; false without the API', () => {
    let observed = null;
    class PO {
      constructor(fn) { this.fn = fn; }
      observe(o) { observed = o; this.fn({ getEntries: () => [{ name: `${ORIGIN}/vendor/pixi.min.js`, transferSize: 140000 }] }); }
    }
    const win = { PerformanceObserver: PO, location: { origin: ORIGIN }, performance: { getEntriesByType: (t) => (t === 'navigation' ? [{ name: `${ORIGIN}/`, transferSize: 7000 }] : []) } };
    assert.equal(installTrafficMeter({}), false);
    assert.equal(installTrafficMeter(win), true);
    assert.deepEqual(observed, { type: 'resource', buffered: true });
    assert.deepEqual(trafficSummary().code, { requests: 2, bytes: 147000, cached: 0 });
    assert.equal(installTrafficMeter(win), true, 'already installed');
    assert.equal(trafficSummary().code.requests, 2, 'not twice');
  });
});
