// Site policy (DESIGN §34.11). Hash only import maps, never arbitrary inline script. Worker/UI policies are independent.
// worker-src 'self' is the asset service worker at /sw.js. blob: stays for workers the page already creates
// (the simulation worker). Do not add a remote worker origin. SIM_WORKER_CSP is that worker's own policy and
// must not gain the asset worker.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

// SES evaluates confined code. This relaxation belongs only to the simulation Worker, never its parent document.
export const SIM_WORKER_CSP = "default-src 'none'; script-src 'self' 'unsafe-eval'; connect-src 'none'";

/**
 * Asset origins a deployment serves from a separate CDN (2026-10-17: a 302 in nginx rewrote
 * /assets and /fonts to https://speedcdn.jiangjiangze.icu). The CSP has to name that origin,
 * otherwise the browser blocks every redirected byte - the first 0.19 deploy shipped with the
 * old 'self'-only policy and the CDN-hosted art, fonts and voice never loaded. `SP_ASSET_CDN`
 * is the same variable the deployment already keeps in /etc/stronghold.env; comma-separated,
 * scheme+host are kept, paths are dropped.
 * @returns {string[]} origins, e.g. ['https://speedcdn.example.com']
 */
export function assetCdnOrigins(env = process.env) {
  const raw = String(env.SP_ASSET_CDN ?? '').trim();
  if (!raw) return [];
  const out = [];
  for (const part of raw.split(',')) {
    const s = part.trim();
    if (!s) continue;
    try {
      const u = new URL(s);
      if ((u.protocol === 'https:' || u.protocol === 'http:') && !out.includes(u.origin)) out.push(u.origin);
    } catch { /* not a URL: ignore, a bad env value must not take the site down */ }
  }
  return out;
}

// Deliberately no remote script origin: only the import-map hashes run inline, and every script is same-origin.
export function siteCsp(publicDir, env = process.env) {
  const hashes = new Set();
  for (const rel of ['index.html', 'studio/index.html', 'dev/game-mock.html', 'dev/render-demo.html', 'dev/battle-perf.html', 'dev/uikit.html']) {
    let html;
    try { html = fs.readFileSync(path.join(publicDir, rel), 'utf8'); } catch { continue; }
    for (const m of html.matchAll(/<script\s+type=["']importmap["']\s*>([\s\S]*?)<\/script>/g)) {
      hashes.add(`'sha256-${createHash('sha256').update(m[1]).digest('base64')}'`);
    }
  }
  const cdn = assetCdnOrigins(env);
  const extra = cdn.length ? ` ${cdn.join(' ')}` : '';
  return `default-src 'self'; script-src 'self'${hashes.size ? ' ' + [...hashes].join(' ') : ''}; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com${extra}; font-src 'self' https://fonts.gstatic.com${extra}; img-src 'self' data: blob:${extra}; media-src 'self'${extra}; connect-src 'self'${extra}; worker-src 'self' blob:; frame-src 'self'; object-src 'none'; base-uri 'none'`;
}
