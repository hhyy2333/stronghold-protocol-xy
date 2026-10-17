// The end-to-end proof of the "只弹一次" rule in a REAL browser against the REAL server:
//   SP_E2E=1 node test/ui/updateNotes.e2e.test.js        (SP_E2E=1 CHROME_PATH=<chrome> to pick a browser)
//
// What it proves that the unit suite cannot: the panel actually renders in a live page, the digest really reaches
// localStorage through the app's own store, a real RELOAD does not bring it back, the manual entry does not change
// the record, and an unseen revision re-pops it. Opt-in like the other e2e suites (they need a browser), so a
// default `node --test` run never depends on one.

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const CHROME = process.env.CHROME_PATH
  || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const ENABLED = process.env.SP_E2E === '1' && existsSync(CHROME);
const PORT = Number(process.env.SP_NOTES_E2E_PORT || 3981);

describe('更新公告: a real browser, a real reload', { skip: !ENABLED && 'set SP_E2E=1 and have Edge/Chrome' }, () => {
  let browser, server;

  before(async () => {
    server = spawn(process.execPath, ['server/index.js'], {
      cwd: ROOT,
      env: { ...process.env, PORT: String(PORT) },
      stdio: 'ignore',
    });
    let up = false;
    for (let i = 0; i < 80 && !up; i++) {
      try { up = (await fetch(`http://127.0.0.1:${PORT}/healthz`)).ok; } catch { /* not up yet */ }
      if (!up) await new Promise((r) => setTimeout(r, 250));
    }
    assert.ok(up, `the server answered on :${PORT}`);
    const puppeteer = (await import('puppeteer-core')).default;
    browser = await puppeteer.launch({
      executablePath: CHROME, headless: true, args: ['--no-sandbox', '--no-proxy-server'],
    });
  });

  after(async () => {
    await browser?.close();
    server?.kill();
  });

  test('it pops on a fresh browser, a reload does not bring it back, an unseen revision does', async () => {
    const page = await browser.newPage();
    const url = `http://127.0.0.1:${PORT}/`;
    await page.goto(url, { waitUntil: 'networkidle2' });

    // 1. Fresh browser: the panel is on screen, with the release's items listed.
    await page.waitForSelector('.unotes', { timeout: 15000 });
    const title = await page.$eval('.unotes .modal__title', (el) => el.textContent.trim());
    assert.ok(title.length > 0, `the panel has a title (${title})`);
    const items = await page.$$eval('.unotes__item', (els) => els.length);
    assert.ok(items >= 5, `it lists the changes (${items} items listed)`);

    // 2. Closing records THIS revision's digest.
    await page.click('.unotes__close');
    await page.waitForFunction(() => !document.querySelector('.unotes'), { timeout: 5000 });
    const stored = await page.evaluate(() => localStorage.getItem('sp.pref.updateNotes'));
    assert.ok(stored, 'the digest reached localStorage through the app store');
    assert.match(JSON.parse(stored).seen, /^[0-9a-f]{64}$/, 'a sha256 digest');

    // 3. A REAL reload keeps it closed — the requirement the whole feature is built around.
    await page.reload({ waitUntil: 'networkidle2' });
    await new Promise((r) => setTimeout(r, 1500));
    assert.equal(await page.$('.unotes'), null, 'no panel after a reload');

    // 4. The manual entry opens it again without touching the record.
    const before = await page.evaluate(() => localStorage.getItem('sp.pref.updateNotes'));
    await page.click('.lobby-notes, .title-notes');
    await page.waitForSelector('.unotes', { timeout: 5000 });
    assert.ok(title.length > 0, 're-read shows the notes');
    await page.click('.unotes__close');
    await page.waitForFunction(() => !document.querySelector('.unotes'), { timeout: 5000 });
    const after = await page.evaluate(() => localStorage.getItem('sp.pref.updateNotes'));
    assert.equal(JSON.parse(after).seen, JSON.parse(before).seen, 'reading again does not change the record');

    // 5. A revision this browser has not seen (the next release) pops it again.
    await page.evaluate(() => localStorage.setItem('sp.pref.updateNotes',
      JSON.stringify({ seen: 'f'.repeat(64), at: Date.now() })));
    await page.reload({ waitUntil: 'networkidle2' });
    await page.waitForSelector('.unotes', { timeout: 15000 });
    assert.ok(await page.$('.unotes'), 'an unseen digest pops the panel again');
  });
});
