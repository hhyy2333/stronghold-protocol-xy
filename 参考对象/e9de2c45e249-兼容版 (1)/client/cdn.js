// cdn-source/client/cdn.js — CDN 源排名面板（只读展示 + 现场测速 + 存偏好）。
//
// 为什么是"展示 + 偏好"而不是"改素材源"：管理器 0.13.0 的客户端表面只有 client.panels /
// theme / requires（docs/MOD-SURFACE.md 第 74-81 行），面板拿到的是**只读**数据快照，没有
// 「改素材清单 / 拦截网络」的钩子——所以本包改不了游戏从哪个源取素材。要真正生效需要引擎侧
// 一个 sources(ctx) 提供者表面（与 0.13.0 刚加的 appearance 提供者同形）；README 里写了提案。
//
// 本包做三件在表面内可做的事：读发布排名、现场测速（浏览器内 Resource Timing）、把玩家选的源
// 存成偏好（ctx.session.setPref），供将来引擎接上该表面时直接消费。
// 引擎的 vendor 在包外（`../../../vendor/...` 只在引擎树里存在）→ 动态 import，这样本文件在
// node 里也能被 import（测试跑得起来），而面板挂载时照旧拿到引擎的 hooks。

export const RANK_URL = 'https://speedcdn.jiangjiangze.icu/cdn/v1/rank.json';
export const PREF_KEY = 'source';

/** 排名的候选源（去掉被排除/不可用的），带发布时的内地实测延迟。 */
export function usableRank(doc) {
  const rows = Array.isArray(doc?.rank) ? doc.rank : [];
  return rows.filter((r) => r && r.id && r.excluded !== true && r.usable !== false)
    .map((r) => ({ id: r.id, host: r.host || '', coverage: r.coverage, measured: r.measured === true, ttfbMs: r.ttfbMs || null }));
}

/** 现场测速：HEAD 一个 1KB 探针，用 Resource Timing 取首字节（失败返回 null）。 */
export async function probeHost(host, { fetchImpl = globalThis.fetch, timeoutMs = 4000 } = {}) {
  if (!host || typeof fetchImpl !== 'function') return null;
  const url = `https://${host}/probe/cdn-probe.bin?sp_probe=${Date.now()}`;
  const t0 = performance.now();
  try {
    await fetchImpl(url, { cache: 'no-store', signal: AbortSignal.timeout(timeoutMs) });
    const entry = (performance.getEntriesByName(url) || []).pop();
    const ttfb = entry ? entry.responseStart - entry.requestStart : performance.now() - t0;
    return Number.isFinite(ttfb) && ttfb > 0 ? Math.round(ttfb) : null;
  } catch { return null; }
}

export async function mount(ctx) {
  const { html } = await import('../../../vendor/hooks.module.js');
  const host = ctx?.host || null;
  const el = html`<${Panel} ctx=${ctx} />`;
  return el && host ? host.append(el) : el;
}

async function Panel({ ctx }) {
  const { html, useState, useEffect } = await import('../../../vendor/hooks.module.js');
  const [doc, setDoc] = useState(null);
  const [live, setLive] = useState({});
  const [err, setErr] = useState('');
  const [open, setOpen] = useState(false);
  useEffect(() => {
    let alive = true;
    fetch(RANK_URL, { cache: 'force-cache' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d) => { if (alive) setDoc(d); })
      .catch((e) => { if (alive) setErr(String(e?.message || e).slice(0, 80)); });
    return () => { alive = false; };
  }, []);
  const rows = usableRank(doc);
  const pick = (id) => { try { ctx?.session?.setPref?.(PREF_KEY, id); } catch { /* 表面受限 */ } };
  const measure = async () => {
    const out = {};
    for (const r of rows) out[r.id] = await probeHost(r.host);
    setLive(out);
  };
  return html`
    <div class="cdn-source" data-testid="cdn-source">
      <button type="button" onClick=${() => setOpen((v) => !v)}>CDN 源 ${rows.length ? `(${rows[0]?.id || ''})` : ''}</button>
      ${open && html`<div class="cdn-source__panel">
        ${err && html`<p class="cdn-source__err">排名取不到：${err}</p>`}
        <ul>
          ${rows.map((r, i) => html`<li key=${r.id}>
            <span class="n">${i + 1}</span> <b>${r.id}</b>
            ${r.ttfbMs ? html`<span class="pub">发布实测 ${Object.values(r.ttfbMs).join('/')} ms</span>` : html`<span class="pub">无内地实测</span>`}
            ${live[r.id] ? html`<span class="live">现场 ${live[r.id]} ms</span>` : null}
            <button type="button" onClick=${() => pick(r.id)}>选它</button>
          </li>`)}
        </ul>
        <button type="button" onClick=${measure}>现场测速</button>
        <p class="cdn-source__note">偏好只存本机（ctx.session.setPref）。要让素材真的走这个源，需要引擎侧 sources 表面（README 提案）。</p>
      </div>`}
    </div>`;
}
