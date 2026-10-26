// test/ui/unite-music.test.js — 设置「联防音乐」(业主 2026-10-26「做一个联防时播放这个音乐，然后在设置界面增加开关是否播放」):
// 联防 has its own manifest track (`bgm.unite` = m_bat_corrosion), and a player's own file may take its place —
// 《雨爱》DJ 版, public/js/uniteMusic.js — with a switch in 设置, on by default. Covered here: the setting's
// normalisation, the dialog row and its hint in every language pack, the audio manager (the custom track plays for
// 联防, off returns to the manifest's track, a missing file falls back to it), and the diagnostics line. The file
// itself is NOT in the repository (public/assets is git-ignored) — a checkout without it hears the official track.
// Run: node --test test/ui/unite-music.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sanitizeSettings, DEFAULT_SETTINGS } from '../../public/js/ui/gameLogic.js';
import { UNITE_TRACK_URL, uniteTrackFor } from '../../public/js/uniteMusic.js';
import { AudioManager } from '../../public/js/audio.js';
import { buildDiagnostics } from '../../public/js/diag.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => readFileSync(path.join(ROOT, p), 'utf8');
const manifest = JSON.parse(read('data/assets.json'));
const LABEL = '联防音乐';
const HINT = '联防阶段改播《雨爱》DJ 版；关掉后播放官方的联防音乐。没有这个音乐文件时仍播放官方音乐。';

test('uniteMusic is stored with the other settings: on by default (the owner asked for the track), a boolean kept, junk on', () => {
  assert.equal(DEFAULT_SETTINGS.uniteMusic, true);
  assert.equal(sanitizeSettings(null).uniteMusic, true);
  assert.equal(sanitizeSettings({ bgm: 0.4, ammoCount: true }).uniteMusic, true, 'a profile saved before this option');
  assert.equal(sanitizeSettings({ uniteMusic: false }).uniteMusic, false);
  assert.equal(sanitizeSettings({ uniteMusic: true }).uniteMusic, true);
  for (const bad of ['false', 0, 1, null, {}, []]) assert.equal(sanitizeSettings({ uniteMusic: bad }).uniteMusic, true, JSON.stringify(bad));
  // independent of the other settings
  assert.deepEqual(sanitizeSettings({ uniteMusic: false, bgm: 0.2 }), { ...sanitizeSettings({ bgm: 0.2 }), uniteMusic: false });
});

test('uniteTrackFor: the player’s own track only while 联防音乐 is on, else the manifest’s bgm.unite', () => {
  assert.equal(uniteTrackFor({ uniteMusic: true }), UNITE_TRACK_URL);
  assert.equal(uniteTrackFor({ uniteMusic: false }), null);
  assert.equal(uniteTrackFor(null), null, 'no settings yet ⇒ the manifest’s track');
  assert.equal(UNITE_TRACK_URL, '/assets/audio/bgm/unite_rainlove_dj.m4a', 'the path the docs name');
  assert.notEqual(UNITE_TRACK_URL, manifest.audio.bgm.unite.loop, 'it replaces a real manifest track');
});

test('the settings dialog has the toggle and its hint, wired to the audio manager, in every language pack', () => {
  const src = read('public/js/ui/settings.js');
  assert.match(src, /<\$\{Toggle\} label=\$\{t\('联防音乐'\)\} micro="UNITE MUSIC" value=\$\{s\.uniteMusic\} onChange=\$\{\(v\) => updateSettings\(\{ uniteMusic: v \}\)\} \/>/);
  assert.ok(src.includes(`t('${HINT}')`), 'the hint under it');
  assert.ok(src.indexOf("t('背景音乐')") < src.indexOf(`t('${LABEL}')`), 'right under the BGM volume');
  // the store is the only writer of the audio manager's custom track: on every change, and once before the first render
  assert.match(src, /audio\.setCustomBgm\('unite', uniteTrackFor\(s\)\)/);
  assert.match(src, /audio\.setCustomBgm\('unite', uniteTrackFor\(settingsStore\.get\(\)\)\)/);
  for (const lang of ['en', 'ja', 'ko', 'zh-TW']) {
    const pack = JSON.parse(read(`public/i18n/${lang}.json`));
    for (const id of [LABEL, HINT]) assert.ok(typeof pack[id] === 'string' && pack[id].length > 0, `${lang}: ${id}`);
  }
});

// ---- the audio manager ----------------------------------------------------------------------------------

/** The settings store is the only writer: at boot (before the first render) and on every change. */
test('the settings store drives the audio manager’s custom 联防 track', async () => {
  const { settingsStore, updateSettings } = await import('../../public/js/ui/settings.js');
  const { audio } = await import('../../public/js/audio.js');
  const before = settingsStore.get().uniteMusic;
  try {
    assert.equal(audio.customBgm.unite, UNITE_TRACK_URL, 'the boot path set it before the first render');
    updateSettings({ uniteMusic: false });
    assert.equal(audio.customBgm.unite, undefined, 'off ⇒ the manifest’s bgm.unite');
    updateSettings({ uniteMusic: true });
    assert.equal(audio.customBgm.unite, UNITE_TRACK_URL, 'on again ⇒ the player’s track');
  } finally {
    updateSettings({ uniteMusic: before });
  }
});

/** A Web Audio stub: enough for the BGM path (sources start, gains connect). */
function fakeWindow() {
  const listeners = new Map();
  class Param { constructor() { this.value = 1; } setValueAtTime(v) { this.value = v; } linearRampToValueAtTime(v) { this.value = v; } setTargetAtTime(v) { this.value = v; } cancelScheduledValues() {} }
  class Node { connect() {} disconnect() {} }
  class Gain extends Node { constructor() { super(); this.gain = new Param(); } }
  class Src extends Node { constructor() { super(); this.playbackRate = new Param(); } start() {} stop() {} }
  class Ctx {
    constructor() { this.currentTime = 0; this.state = 'running'; this.destination = new Node(); }
    createGain() { return new Gain(); }
    createBufferSource() { return new Src(); }
    decodeAudioData(ab, ok) { ok({ duration: 1.5 }); }
    resume() { return Promise.resolve(); }
    suspend() { return Promise.resolve(); }
  }
  return {
    win: {
      AudioContext: Ctx,
      document: { hidden: false, addEventListener() {} },
      addEventListener(t, fn) { listeners.set(t, fn); },
      removeEventListener(t) { listeners.delete(t); },
    },
    fire(t) { listeners.get(t)?.(); },
  };
}

const tick = () => new Promise((r) => setTimeout(r, 10));
/** Wait until `cond` holds (a fetch + decode + start chain takes a few turns of the event loop). */
async function waitFor(cond, what) {
  for (let i = 0; i < 50; i++) { if (cond()) return; await tick(); }
  assert.fail(`timed out waiting for ${what}`);
}

/** An unlocked manager whose fetch answers every audio URL (except the ones `missing` names) with an 8-byte body. */
async function managerWithFetch(t, missing = new Set()) {
  const fw = fakeWindow();
  const origFetch = globalThis.fetch;
  const urls = [];
  globalThis.fetch = async (u) => {
    urls.push(String(u));
    if ([...missing].some((m) => String(u).includes(m))) return { ok: false, status: 404, headers: { get: () => 'text/html' } };
    return { ok: true, headers: { get: () => 'audio/mpeg' }, arrayBuffer: async () => new ArrayBuffer(8) };
  };
  t.after(() => { globalThis.fetch = origFetch; });
  const a = new AudioManager({ win: fw.win, getManifest: () => manifest });
  a.install();
  fw.fire('pointerdown');
  await tick();
  assert.equal(a.unlocked, true, 'the context is up');
  return { a, urls };
}

test('联防 plays the player’s own track while the switch is on, and the manifest’s track again once it is off', async (t) => {
  const { a, urls } = await managerWithFetch(t);
  const official = manifest.audio.bgm.unite.loop;
  a.setCustomBgm('unite', UNITE_TRACK_URL);
  a.playBgm('unite');
  await waitFor(() => a.bgm?.loopUrl === UNITE_TRACK_URL, 'the custom track');
  // through the extension-less /media/ route, like every other audio file (public/js/media.js)
  assert.ok(urls.includes('/media/bgm/unite_rainlove_dj'), `asked for the file through /media/: ${urls.join(', ')}`);
  // the switch off, while it plays: the official track takes over without waiting for a phase change
  a.setCustomBgm('unite', null);
  await waitFor(() => a.bgm?.loopUrl === official, 'the official track');
  assert.equal(a.bgm?.key, 'unite', 'still 联防, a different track');
});

test('a checkout without the file still hears 联防’s official track (the manifest fallback)', async (t) => {
  const { a } = await managerWithFetch(t, new Set(['unite_rainlove_dj']));
  const official = manifest.audio.bgm.unite.loop;
  a.setCustomBgm('unite', UNITE_TRACK_URL);
  a.playBgm('unite');
  await waitFor(() => a.bgm?.loopUrl === official, 'the manifest track after the custom one 404s');
});

test('the custom track is 联防 only: every other phase keeps the manifest’s track', async (t) => {
  const { a } = await managerWithFetch(t);
  a.setCustomBgm('unite', UNITE_TRACK_URL);
  a.playBgm('prep');
  await waitFor(() => a.bgm?.loopUrl === manifest.audio.bgm.prep.loop, 'the prep track');
  assert.notEqual(a.bgm?.loopUrl, UNITE_TRACK_URL);
});

test('the diagnostics name the option when it is off (on is the default, so silence means the custom track)', () => {
  const state = { me: {}, room: null, match: { public: null, battle: null }, connection: { status: 'online' } };
  const line = (settings) => buildDiagnostics({ state, env: {}, settings }).split('\n').find((l) => l.startsWith('settings:'));
  assert.equal(line({ quality: 'high', uniteMusic: false }), 'settings: quality high | unite music off');
  assert.equal(line({ quality: 'high', uniteMusic: true }), 'settings: quality high');
});
