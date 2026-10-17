// Explicit title-screen predownload. Reuse the game's HTTP cache and exact manifest URLs;
// never decode every model/image/audio file into RAM or persist an unverified "complete" flag.
// Two kinds of file are already on disk and never requested again: what a local import stored (assetPack.js) and what
// the browser's own HTTP cache already holds from an earlier match — the latter found with `only-if-cached`, a cache
// lookup that sends no request, so the bar starts at what is really here instead of at 0.
import { mediaUrl } from './media.js';
import { listImportedPaths } from './assetCache.js';

const AUDIO_RE = /\.(?:mp3|ogg|wav|m4a)$/i;

/** 这个素材是不是音频（语音包）。mediaUrl() 会把音频改写成无扩展名的 /media/…，所以前缀也算。 */
export function isAudioUrl(url) {
  return url.startsWith('/media/') || AUDIO_RE.test(url);
}

/**
 * Collect only same-origin art files, including all Spine pages and optional local scenes.
 * The served 0.3.0 views are walked as they are: hashed `/assets/~…` and `/fonts/~…` URLs, the extra dub banks
 * (`voiceEn` / `voiceKr` / `voiceNative`), statistics-page art, and local groups such as the 射击台 mesh. A cosmetic
 * plugin's own files are `/p/<id>/<hash8>/…` and are not in these manifests, so they are not queued here. The official
 * battle effects (DESIGN §35) come in their own manifest, /data/local-fx.json, read the same way when the host has them.
 */
export function collectAssetUrls(...manifests) {
  const urls = new Set();
  const visit = (value) => {
    if (typeof value === 'string') {
      if (/^\/(?:assets|fonts)\/[^/]/.test(value) && !/[?#\\]/.test(value)) urls.add(mediaUrl(value));
    } else if (value && typeof value === 'object') {
      for (const child of Object.values(value)) visit(child);
    }
  };
  manifests.forEach(visit);
  // Fetch models/images before audio, so an interrupted download still improves battle visuals.
  return [...urls].sort((a, b) => Number(a.startsWith('/media/')) - Number(b.startsWith('/media/')) || a.localeCompare(b));
}

/** A bounded, pausable download queue. A file counts only after its entire body arrives. */
export function createAssetDownload({ fetch: doFetch = (...args) => globalThis.fetch(...args),
  concurrency = 4, timeoutMs = 60000, retries = 2, lookupImported = listImportedPaths } = {}) {
  let state = {
    phase: 'idle', scope: 'visual', total: 0, done: 0, bytes: 0, failures: [], localMissing: false, cached: 0,
    reused: 0, counts: { visual: 0, all: 0 },
  };
  let urls = null, running = null, controller = null, paused = false, lastNotice = 0;
  /** 不用下载就算就绪的文件数：本地导入的 + 浏览器 HTTP 缓存里已有的。 */
  let reused = 0;
  const complete = new Set(), failures = new Map(), listeners = new Set();
  const emit = (force = false) => {
    if (!force && Date.now() - lastNotice < 100) return;
    lastNotice = Date.now();
    state = { ...state, done: complete.size, reused, failures: [...failures.values()] };
    for (const listener of listeners) listener(state);
  };

  async function request(url, json = false, optional = false) {
    for (let attempt = 0; ; attempt++) {
      const abort = new AbortController();
      const cancel = () => abort.abort();
      controller.signal.addEventListener('abort', cancel, { once: true });
      if (controller.signal.aborted) cancel();
      const timer = setTimeout(cancel, timeoutMs);
      try {
        const response = await doFetch(url, { signal: abort.signal, cache: json ? 'no-cache' : 'default' });
        if (optional && response.status === 404) { await response.body?.cancel(); return null; }
        if (!response.ok || response.status === 206) {
          await response.body?.cancel();
          throw Object.assign(new Error('Asset request failed'), { status: response.status });
        }
        // Static hosts sometimes send their HTML fallback with status 200 for missing art.
        if (/text\/html/i.test(response.headers.get('content-type') || '')) {
          await response.body?.cancel();
          throw Object.assign(new Error('Unexpected HTML response'), { status: 'html' });
        }
        if (json) return await response.json();
        let size = 0;
        if (response.body?.getReader) {
          const reader = response.body.getReader();
          try {
            for (;;) {
              const { done, value } = await reader.read();
              if (done) break;
              size += value.byteLength;
              state = { ...state, bytes: state.bytes + value.byteLength };
              emit();
            }
          } finally { reader.releaseLock(); }
        } else {
          size = (await response.arrayBuffer()).byteLength;
          state = { ...state, bytes: state.bytes + size };
        }
        if (!size) throw Object.assign(new Error('Empty asset response'), { status: 'empty' });
        return;
      } catch (error) {
        if (paused) throw error;
        const transient = !error.status || error.status >= 500 || [408, 429].includes(error.status);
        if (!transient || attempt >= retries) throw Object.assign(error, { url });
        // Keep retries bounded and avoid hammering a struggling server.
        await new Promise((resolve) => setTimeout(resolve, 300 * (attempt + 1)));
        if (paused) throw error;
      } finally {
        clearTimeout(timer);
        controller.signal.removeEventListener('abort', cancel);
      }
    }
  }

  /**
   * 这个文件是不是已经在浏览器的 HTTP 缓存里：`only-if-cached` 只查缓存、不发网络请求，命中返回响应，未命中在
   * Chrome / Firefox 都以失败的 fetch 收场。素材 URL 带内容哈希且被服务器标成一年不变，命中就是要的那份字节。
   * 不支持的浏览器（或任何意外）一律当作未命中，退回普通请求 —— 最坏情况就是老行为，不会漏文件。
   */
  async function probeCached(url) {
    try {
      const response = await doFetch(url, { cache: 'only-if-cached', mode: 'same-origin', signal: controller.signal });
      await response.body?.cancel();
      return response.ok;
    } catch {
      return false;
    }
  }

  async function run() {
    try {
      if (!urls) {
        state = { ...state, phase: 'preparing', error: null };
        emit(true);
        // Sequential manifest reads keep cancellation simple and never leave a rejected sibling promise.
        const assets = await request('/data/assets.json', true);
        const local = await request('/data/local-assets.json', true, true);
        // the official battle effects' files (DESIGN §35): optional, like the local manifest
        const fx = await request('/data/local-fx.json', true, true);
        if (!assets || typeof assets !== 'object' || Array.isArray(assets)
          || (local !== null && (!local || typeof local !== 'object' || !local.groups))
          || (fx !== null && (!fx || typeof fx !== 'object' || !fx.groups))) throw new Error('Invalid asset manifest');
        const list = collectAssetUrls(assets, local, fx);
        if (!list.length) throw new Error('Empty asset manifest');
        // 画面（模型/贴图/特效）和语音分开：整套语音是 344 MB，不该默认替玩家下载。
        urls = { visual: list.filter((url) => !isAudioUrl(url)), audio: list.filter(isAudioUrl), all: list };
        state = {
          ...state,
          counts: { visual: urls.visual.length, all: list.length },
          localMissing: local === null,
        };
      }
      if (paused) return;
      let imported = null;
      try { imported = await lookupImported(); } catch { imported = null; }
      if (paused) return;
      let cached = 0;
      if (imported && typeof imported.has === 'function') {
        for (const url of (urls[state.scope] || urls.visual)) {
          let path = url;
          try { path = new URL(url, 'http://localhost').pathname; } catch { /* keep the queue string */ }
          if (imported.has(url) || imported.has(path)) {
            cached++;
            reused++;
            complete.add(url);
          }
        }
      }
      state = { ...state, cached };
      if (paused) return;
      const queued = urls[state.scope] || urls.visual;
      state = { ...state, phase: 'downloading', total: queued.length };
      failures.clear();
      emit(true);
      const queue = queued.filter((url) => !complete.has(url));
      let next = 0;
      const worker = async () => {
        while (!paused && next < queue.length) {
          const url = queue[next++];
          try {
            // 先问浏览器缓存（不发请求）。玩过一局之后大部分素材就在里面 —— 命中即完成，进度条不会每次从头爬。
            if (await probeCached(url)) {
              complete.add(url);
              reused++;
              emit();
              continue;
            }
            await request(url);
            complete.add(url);
          } catch (error) {
            if (!paused) failures.set(url, { url, status: error.status || 'network' });
          }
          emit();
        }
      };
      await Promise.all(Array.from({ length: Math.max(1, Math.min(8, concurrency)) }, worker));
      if (!paused) state = { ...state, phase: failures.size ? 'partial' : 'complete' };
    } catch (error) {
      if (!paused) state = { ...state, phase: 'error', error: { url: error.url, status: error.status || 'manifest' } };
    } finally {
      if (paused) state = { ...state, phase: 'paused' };
      emit(true);
    }
  }

  return {
    get: () => state,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    /** scope: 'visual'（默认，不含语音）或 'all'（含语音）。 */
    start(scope = 'visual') {
      if (running) return running;
      paused = false;
      controller = new AbortController();
      // A new check after completion revalidates the manifest and all files through the HTTP cache.
      // Switching scope mid-way restarts the queue for that scope; already-cached files come back fast.
      complete.clear();
      reused = 0;
      state = {
        ...state, scope, total: 0, done: 0, bytes: 0, failures: [], cached: 0, reused: 0,
      };
      if (state.phase === 'complete') urls = null;
      running = run().finally(() => { running = null; });
      return running;
    },
    pause() { if (running) { paused = true; controller.abort(); } },
  };
}

export const assetDownload = createAssetDownload();
