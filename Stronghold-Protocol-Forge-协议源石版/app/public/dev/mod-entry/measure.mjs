// public/dev/mod-entry/measure.mjs —— 量「展开商店栏之后，两个 mod 的入口按钮多久出现」（业主 2026-11-05）。
//
//   node public/dev/mod-entry/measure.mjs <label>            # 例：before / after
//   CHROME_PATH=… node public/dev/mod-entry/measure.mjs x     # 非默认路径的 Chromium
//
// 真的服务器 + 真的客户端：headless Chromium 打开本仓库的客户端，用 `?playtest=1` 开一局单人模拟，一路点到
// **休整期（PREP）**，然后收起商店栏 → 再展开，用 rAF 轮询 `.fst__tab`（战地商店）/ `.oex__tab`（源石证券交易所）
// 什么时候真的可见，并在几个时刻截图。
//
// 量基线：在本仓库的一个 `git worktree`（同一条命令、同一台机器）里跑同一个脚本，标签换成 `before`。
// 2026-11-05 的实测：修好之后两颗按钮 37–40 ms 内都可见；基线 150 ms 时两颗都还不在，整块面板 1.3–2.6 s 之后
// 才挂上（等的是下一次对局状态变化，不可预期）。
//
// 这个脚本只在开发机上跑（`puppeteer-core` 是 devDependency，Edge / Chrome 要装），不进测试集。
import { pathToFileURL, fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import path from 'node:path';

const LABEL = process.argv[2] || 'run';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = path.resolve(HERE, '../../..');      // …/app
const CHROME = process.env.CHROME_PATH
  || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const { startServer } = await import(pathToFileURL(path.join(APP, 'server/index.js')).href);
const srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true });
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--no-proxy-server'] });
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 720 });

// 服务端帧只用来判断「现在到哪个相位了」：协议源石抽取 / 机变都还不是休整期，面板在那两段本来就该藏着。
const frames = [];
const cdp = await page.createCDPSession();
await cdp.send('Network.enable');
cdp.on('Network.webSocketFrameReceived', ({ response }) => frames.push(response.payloadData));
const phaseNow = () => {
  for (let i = frames.length - 1; i >= 0; i -= 1) {
    const m = /"phase":"([A-Z_]+)"/.exec(frames[i]);
    if (m) return m[1];
  }
  return null;
};

const dismissNotes = () => page.evaluate(() => {
  const b = [...document.querySelectorAll('button')].find((x) => (x.textContent || '').trim() === '知道了');
  if (b) { b.click(); return true; }
  return false;
});
const clickText = (want) => page.evaluate((text) => {
  const b = [...document.querySelectorAll('button')].find((x) => (x.textContent || '').trim().includes(text) && !x.disabled && x.offsetParent !== null);
  if (!b) return false;
  b.click();
  return true;
}, want);
/** 协议源石抽取是两段确认：同一张卡点两下。 */
const clickHexCard = () => page.evaluate(() => {
  const card = [...document.querySelectorAll('.hxcard')].find((c) => !c.disabled && c.offsetParent !== null);
  if (!card) return false;
  card.click();
  return true;
});

// ---- 进到休整期 ----------------------------------------------------------------------------------------------
await page.goto(srv.url, { waitUntil: 'networkidle2' });
await page.evaluate(() => { localStorage.setItem('sp.name', '测试员'); sessionStorage.setItem('sp.entered', '1'); });
await page.goto(`${srv.url}/?playtest=1`, { waitUntil: 'domcontentloaded' });
await sleep(2500);
await dismissNotes();
await page.waitForSelector('.screen.brief', { timeout: 20000 }).catch(() => {});
for (let i = 0; i < 60; i += 1) {
  const bar = await page.evaluate(() => !!document.querySelector('.shopbar'));
  if (bar && phaseNow() === 'PREP') break;
  let acted = false;
  if (await clickHexCard()) { await sleep(250); acted = await clickHexCard(); }
  if (!acted) acted = await clickText('准备就绪') || await clickText('确认') || await clickText('已就绪');
  await sleep(acted ? 400 : 500);
}
await sleep(1200);
await dismissNotes();
await page.waitForSelector('.shopbar', { timeout: 20000 });
await sleep(2000);

const state = () => page.evaluate(() => ({
  mounted: [...document.querySelectorAll('.shopbar__toolrow [data-mod-panel]')].map((e) => e.getAttribute('data-mod-panel')),
  tabs: [...document.querySelectorAll('.fst__tab, .oex__tab')].map((e) => ({ cls: e.parentElement?.className, visible: e.checkVisibility ? e.checkVisibility() : e.offsetParent !== null })),
}));
console.log(`[${LABEL}] phase ${phaseNow()}`, JSON.stringify(await state()));
await page.screenshot({ path: path.join(HERE, `${LABEL}-prep.png`) });

/** 收起再展开一次，量「从点展开到按钮可见」的毫秒数（rAF 采样，8 s 封顶）。 */
async function cycle(n) {
  await page.evaluate(() => document.querySelector('.funds__collapse')?.click());
  await sleep(1500);
  const result = await page.evaluate(() => new Promise((resolve) => {
    const btn = document.querySelector('.shopbar-tab__btn');
    if (!btn) { resolve({ error: 'no expand button' }); return; }
    const t0 = performance.now();
    btn.click();
    const samples = [];
    const visible = (selector) => {
      const el = document.querySelector(selector);
      return el ? (el.checkVisibility ? el.checkVisibility() : el.offsetParent !== null) : false;
    };
    const tick = () => {
      const now = performance.now() - t0;
      const panels = document.querySelectorAll('.shopbar__toolrow [data-mod-panel]').length;
      const fst = visible('.fst__tab');
      const oex = visible('.oex__tab');
      samples.push({ ms: Math.round(now), panels, fst, oex });
      if ((fst && oex) || now > 8000) {
        resolve({
          ms: Math.round(now),
          both: fst && oex,
          firstPanelMounted: samples.find((s) => s.panels > 0)?.ms ?? null,
          firstFstVisible: samples.find((s) => s.fst)?.ms ?? null,
          firstOexVisible: samples.find((s) => s.oex)?.ms ?? null,
          marks: samples.filter((s, i) => i < 5 || s.ms % 500 === 0).slice(0, 40),
        });
        return;
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }));
  console.log(`[${LABEL}] cycle ${n}`, JSON.stringify(result));
  return result;
}

const first = await cycle(1);
await sleep(1200);
await page.screenshot({ path: path.join(HERE, `${LABEL}-expanded-settled.png`) });

// 第二次：收起 → 展开后 ~150 ms 立刻截图（「玩家刚点开商店」的那一瞬），再量一次。
await page.evaluate(() => document.querySelector('.funds__collapse')?.click());
await sleep(1500);
await page.evaluate(() => document.querySelector('.shopbar-tab__btn')?.click());
await sleep(150);
await page.screenshot({ path: path.join(HERE, `${LABEL}-expanded-150ms.png`) });
const at150 = await state();
const second = await cycle(2);
console.log(`[${LABEL}] at +150 ms`, JSON.stringify(at150));
console.log(`[${LABEL}] summary`, JSON.stringify({ first: first.ms, second: second.ms, firstFst: first.firstFstVisible, firstOex: first.firstOexVisible }));
await browser.close();
await srv.close();
