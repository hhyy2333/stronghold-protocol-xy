// 用 CDP 驱动 headless Edge：打开页面 → 关掉「更新公告」→ 等动画结束 → 截图。
// node shot.mjs <url> <out.png> <w> <h> [evalFile]
import { spawn } from 'node:child_process';
import fs from 'node:fs';

const [, , url, out, w = '1920', h = '1080', evalFile] = process.argv;
const PORT = 9223;
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const profile = 'C:/Users/hhyyl/AppData/Local/Temp/edge-cdp-profile';

const proc = spawn(EDGE, [
  '--headless=new', '--disable-gpu', '--hide-scrollbars', `--window-size=${w},${h}`, '--no-first-run', '--no-default-browser-check',
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, 'about:blank',
], { stdio: 'ignore' });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitDevtools() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      if (r.ok) return await r.json();
    } catch {}
    await sleep(250);
  }
  throw new Error('devtools 未就绪');
}

const v = await waitDevtools();
const ws = new WebSocket(v.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

let id = 0;
const pending = new Map();
ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
};
const send = (method, params = {}, sessionId) => new Promise((res) => {
  const mid = ++id;
  pending.set(mid, () => res(null));
  const msg = { id: mid, method, params };
  if (sessionId) msg.sessionId = sessionId;
  ws.send(JSON.stringify(msg));
  pending.set(mid, res);
});

const { targetId } = (await send('Target.createTarget', { url: 'about:blank' })).result;
const { sessionId } = (await send('Target.attachToTarget', { targetId, flatten: true })).result;
const S = (m, p) => send(m, p, sessionId);

await S('Page.enable');
await S('Runtime.enable');
await S('Emulation.setDeviceMetricsOverride', { width: +w, height: +h, deviceScaleFactor: 1, mobile: false });
// SP_COARSE=1：模拟触屏（pointer: coarse），devices.css 里那些 px 下限才会生效
if (process.env.SP_COARSE) {
  await S('Emulation.setEmulatedMedia', { features: [{ name: 'pointer', value: 'coarse' }, { name: 'any-pointer', value: 'coarse' }] });
  await S('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
}
await S('Page.navigate', { url });
await sleep(4500);

// 关掉可能挡住的弹窗 / 提示，再等动画走完
const dismiss = `(() => {
  const texts = ['知道了', '关闭', '确定', '好'];
  let n = 0;
  document.querySelectorAll('.modal button, .dialog button, button').forEach((b) => {
    const t = (b.textContent || '').trim();
    if (texts.includes(t) && b.offsetParent !== null) { b.click(); n++; }
  });
  return n;
})()`;
await S('Runtime.evaluate', { expression: dismiss, returnByValue: true });
await sleep(600);
// SP_TYPE=xxx：真实键盘输入（受控输入框只认真实事件）
if (process.env.SP_TYPE) {
  await S('Runtime.evaluate', { expression: `document.querySelector('.title-login input')?.focus()` });
  await S('Input.insertText', { text: process.env.SP_TYPE });
  await sleep(300);
  await S('Runtime.evaluate', { expression: `document.querySelector('.title-login input')?.blur()` });
}
await sleep(1000);
if (evalFile) {
  const src = fs.readFileSync(evalFile, 'utf8');
  const r = await S('Runtime.evaluate', { expression: src, returnByValue: true, awaitPromise: true });
  console.log(JSON.stringify(r.result?.result?.value ?? r.result, null, 1));
}
const shot = await S('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
fs.writeFileSync(out, Buffer.from(shot.result.data, 'base64'));
console.log('saved', out);
ws.close();
proc.kill();
process.exit(0);
