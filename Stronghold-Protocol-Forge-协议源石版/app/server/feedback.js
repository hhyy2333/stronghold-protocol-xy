// server/feedback.js — 玩家反馈的落盘与读取（设置 →「问题反馈」）。
//
// 玩家的「问题反馈」面板（public/js/ui/settings.js）把一段文字说明 + 这份页面的诊断（public/js/diag.js：
// 版本、浏览器、阶段回合、最近 40 条错误、可选的这场战斗数据）POST 到 /api/feedback；这里负责校验、限流、
// 追加写盘，并给 /admin/ 面板提供读取。
//
// 为什么不用 data/ 或安装目录：蓝绿热更新会整个替换 /opt/Stronghold-Protocol-{a,b}，写在安装目录里的东西
// 每次更新都会没。所以默认落到 **进程用户的家目录** `~/sp-feedback/`（可用 SP_FEEDBACK_DIR 覆盖，
// 服务器上建议设成 /var/lib/stronghold/feedback）。一个文件一个月：`feedback-YYYY-MM.jsonl`，
// 每行一条 JSON，旧文件按 RETAIN_DAYS 清理。
//
// 这个接口是**公开的写接口**（玩家没有账号），所以：
//   * 请求体有硬上限，description / report / meta 各自也有上限，超了直接 413/400；
//   * 按客户端地址限流（每 SUBMIT_WINDOW_MS 最多 SUBMIT_MAX 次），超了 429；
//   * 只接受已知字段，别的键一律丢掉（不是把整个 body 存下来）；
//   * 玩家名在客户端就已经被替换成 <me> / <player2>（diag.js），token 也被替换掉；房间号按业主要求**保留**。
//
// 存储是"只追加"，读是"读尾部"：面板每次轮询只解析最近 LIST_MAX_BYTES 字节，不会把几个月的文件全读进内存。

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

/** 请求体上限（字节）。诊断文本最大也就几十 KB。 */
export const BODY_MAX = 64 * 1024;
/** 玩家自己写的说明的字符上限。 */
export const DESCRIPTION_MAX = 500;
/** 诊断文本的字符上限（含可选的战斗 JSON）。 */
export const REPORT_MAX = 48 * 1024;
/** meta 里每个字段的长度上限。 */
export const META_VALUE_MAX = 200;
/** 限流：每个客户端地址在 SUBMIT_WINDOW_MS 内最多 SUBMIT_MAX 次。 */
export const SUBMIT_MAX = 5;
export const SUBMIT_WINDOW_MS = 10 * 60 * 1000;
/** 超过这个天数的事件文件会被清理。 */
export const RETAIN_DAYS = 90;
/** 面板一次最多返回多少条。 */
export const LIST_MAX = 200;
/** 面板读取时最多解析多少字节的尾部。 */
export const LIST_MAX_BYTES = 2 * 1024 * 1024;
/**
 * 删除一条时要整份重写的文件上限（字节）。
 *
 * 删除必须重写整个月文件（jsonl 不能就地挖洞），所以这里挡一道：正常一个月远小于此（面板读取本身只解析尾部
 * 2 MB）。超过就拒绝并让运维自己去处理，而不是把一个几百 MB 的文件读进内存再写一遍。
 */
export const REWRITE_MAX_BYTES = 64 * 1024 * 1024;

/**
 * meta 里允许出现的键（客户端只说这几件事，其余一律丢弃）。
 * 导出是给 test/diag.test.js 用的：客户端的 diagnosticsPayload 与这里是一份契约，两边一起测。
 */
export const META_KEYS = ['version', 'build', 'phase', 'round', 'mode', 'difficulty', 'room', 'uiLang', 'battleKind'];

/** 默认目录：家目录下的 sp-feedback（不在安装目录里，热更新不会清掉）。 */
export function defaultFeedbackDir() {
  const env = process.env.SP_FEEDBACK_DIR;
  return env && env.trim() ? env.trim() : path.join(os.homedir(), 'sp-feedback');
}

/** `feedback-YYYY-MM.jsonl` of an epoch ms. @param {number} at */
function fileNameFor(at) {
  const d = new Date(at);
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  return `feedback-${d.getUTCFullYear()}-${m}.jsonl`;
}

/** 单个字段：去控制字符、修剪、截断。 @param {any} v @param {number} max */
function clean(v, max) {
  if (typeof v !== 'string') return '';
  // 去掉控制字符（换行保留：诊断文本本来就是多行的），再掐长度。
  const s = v.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '');
  return s.length > max ? s.slice(0, max) : s;
}

/** meta：只留已知键，值必须是字符串/数字/布尔，各自掐长度。 @param {any} raw @returns {Record<string, string>|null} */
function cleanMeta(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const out = {};
  for (const k of META_KEYS) {
    const v = raw[k];
    if (v == null) continue;
    if (typeof v === 'string') out[k] = clean(v, META_VALUE_MAX);
    else if (typeof v === 'number' && Number.isFinite(v)) out[k] = String(v);
    else if (typeof v === 'boolean') out[k] = String(v);
  }
  return Object.keys(out).length ? out : null;
}

/**
 * 读一个文件的尾部：最多 maxBytes 字节，丢掉可能被截断的第一行，返回行数组（旧的在前）。
 * @param {string} file @param {number} maxBytes
 * @returns {string[]}
 */
export function readTailLines(file, maxBytes = LIST_MAX_BYTES) {
  let fd;
  try { fd = fs.openSync(file, 'r'); } catch { return []; }
  try {
    const size = fs.fstatSync(fd).size;
    const start = Math.max(0, size - maxBytes);
    const len = size - start;
    if (len <= 0) return [];
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, start);
    let text = buf.toString('utf8');
    if (start > 0) {
      const nl = text.indexOf('\n');
      text = nl >= 0 ? text.slice(nl + 1) : '';
    }
    return text.split('\n').filter((l) => l.trim());
  } catch {
    return [];
  } finally {
    try { fs.closeSync(fd); } catch { /* ignore */ }
  }
}

/**
 * 玩家反馈的存储。
 * @param {{ dir?: string, log?: object, now?: () => number, maxPerWindow?: number, windowMs?: number,
 *           retainDays?: number }} [opts]
 */
export function createFeedbackStore({
  dir = defaultFeedbackDir(), log = console, now = Date.now,
  maxPerWindow = SUBMIT_MAX, windowMs = SUBMIT_WINDOW_MS, retainDays = RETAIN_DAYS,
} = {}) {
  /** @type {Map<string, number[]>} 客户端地址 → 最近的提交时间戳 */
  const hits = new Map();
  let ready = false;
  let writeWarned = false;

  function ensureDir() {
    if (ready) return true;
    try {
      fs.mkdirSync(dir, { recursive: true });
      ready = true;
      prune();
      return true;
    } catch (e) {
      if (!writeWarned) {
        writeWarned = true;
        log.warn(`[feedback] 目录不可写，反馈将无法保存：${dir}（${e?.code || e?.message}）`);
      }
      return false;
    }
  }

  /** 删掉超过 retainDays 的月文件（只在启动时跑一次，失败无声）。 */
  function prune() {
    if (!Number.isFinite(retainDays) || retainDays <= 0) return;
    const cutoff = now() - retainDays * 24 * 3600 * 1000;
    let names;
    try { names = fs.readdirSync(dir); } catch { return; }
    for (const n of names) {
      const m = /^feedback-(\d{4})-(\d{2})\.jsonl$/.exec(n);
      if (!m) continue;
      const at = Date.UTC(Number(m[1]), Number(m[2]), 1);   // 该月 1 号
      if (at < cutoff) {
        try { fs.unlinkSync(path.join(dir, n)); log.info?.(`[feedback] 清理过期文件 ${n}`); } catch { /* ignore */ }
      }
    }
  }

  /**
   * 限流检查（滑动窗口）。
   * @param {string} ip
   * @returns {boolean} true = 放行
   */
  function allow(ip) {
    const t = now();
    const from = t - windowMs;
    let list = hits.get(ip);
    if (!list) { list = []; hits.set(ip, list); }
    while (list.length && list[0] <= from) list.shift();
    if (list.length >= maxPerWindow) return false;
    list.push(t);
    // 地址很多时清一遍已经空掉的桶，避免无限增长。
    if (hits.size > 1024) for (const [k, v] of hits) if (!v.length || v[v.length - 1] <= from) hits.delete(k);
    return true;
  }

  return {
    dir,

    /**
     * 存一条反馈。
     * @param {any} body 已经解析过的请求体
     * @param {{ ip?: string, ua?: string|null }} [ctx] ua = User-Agent（服务器自己记的，不信 body）
     * @returns {{ ok: true, id: string, at: number } | { ok: false, reason: 'empty'|'rate'|'unwritable' }}
     */
    submit(body, { ip = '?', ua = null } = {}) {
      const description = clean(body?.description, DESCRIPTION_MAX).trim();
      const report = clean(body?.report, REPORT_MAX);
      const meta = cleanMeta(body?.meta);
      // 说明和诊断至少要有一个：两个都空 = 没什么可看的，拒绝（也挡住空请求刷盘）。
      if (!description && !report.trim()) return { ok: false, reason: 'empty' };
      if (!allow(ip)) return { ok: false, reason: 'rate' };
      if (!ensureDir()) return { ok: false, reason: 'unwritable' };

      const at = now();
      const entry = {
        id: `${at.toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
        at,
        ip,
        ua: ua ? clean(ua, META_VALUE_MAX) : null,
        description,
        report,
        meta,
      };
      try {
        fs.appendFileSync(path.join(dir, fileNameFor(at)), JSON.stringify(entry) + '\n', 'utf8');
      } catch (e) {
        log.warn(`[feedback] 写入失败：${e?.code || e?.message}`);
        return { ok: false, reason: 'unwritable' };
      }
      log.info?.(`[feedback] 收到一条玩家反馈（${description ? '带说明' : '仅诊断'}，${report.length} 字符诊断）`);
      return { ok: true, id: entry.id, at };
    },

    /**
     * 最近的反馈，新的在前。跨月时把上一个月也读进来（够 LIST_MAX 就停）。
     * @param {{ limit?: number }} [opts]
     * @returns {object[]}
     */
    list({ limit = 50 } = {}) {
      const cap = Math.min(Math.max(1, Number(limit) || 50), LIST_MAX);
      const out = [];
      const t = now();
      for (let back = 0; back < 3 && out.length < cap; back++) {
        const d = new Date(t);
        d.setUTCMonth(d.getUTCMonth() - back, 1);
        const file = path.join(dir, fileNameFor(d.getTime()));
        const lines = readTailLines(file);
        for (let i = lines.length - 1; i >= 0 && out.length < cap; i--) {
          try {
            const o = JSON.parse(lines[i]);
            if (o && typeof o === 'object') out.push(o);
          } catch { /* 半行/坏行：跳过 */ }
        }
      }
      return out;
    },

    /** 文件里现有的条数（够面板显示"共 N 条"）；只数行，不解析。 */
    count() {
      let n = 0;
      let names;
      try { names = fs.readdirSync(dir).filter((f) => /^feedback-\d{4}-\d{2}\.jsonl$/.test(f)); } catch { return 0; }
      for (const f of names) {
        try {
          const text = fs.readFileSync(path.join(dir, f), 'utf8');
          n += text.split('\n').filter((l) => l.trim()).length;
        } catch { /* ignore */ }
      }
      return n;
    },

    /**
     * 按 id 永久删除一条反馈（面板的「删除」按钮）。
     *
     * WHY it rewrites the whole file: the store is an APPEND-ONLY jsonl (a crash mid-write can lose at most the last
     * line). A hole cannot be punched in place, so the one way to remove a line is to read the month file, drop that
     * line and write the rest back. Three things keep that safe:
     *
     *   * every OTHER line is copied through **verbatim** (the raw text, not a re-serialization): a hand-edited or
     *     older-format line survives a delete untouched, and only the target line disappears;
     *   * the write goes to a `.tmp` file in the same directory and is then renamed over the original, so an
     *     interrupted delete leaves either the old file or the new one — never a half-written month;
     *   * the id is matched by parsing each line, because that is the only stable handle the panel has (a line whose
     *     JSON is broken cannot be identified and is therefore never removed by a mismatched id).
     *
     * The month is derived from `id` — the id starts with the entry's epoch ms in base 36 (`<at36>-<rand>`) — and
     * falls back to searching the three months `list()` reads, so an id from an older format still resolves.
     *
     * @param {unknown} id
     * @returns {{ ok: true, removed: true, at: number } | { ok: false, reason: 'bad-id'|'not-found'|'too-large'|'unwritable' }}
     */
    remove(id) {
      const key = typeof id === 'string' ? id.trim() : '';
      if (!key) return { ok: false, reason: 'bad-id' };
      // A month file of the entry's own month first (its id carries the epoch ms), then the ones list() reads.
      const wanted = [];
      const at36 = key.split('-')[0];
      const at = Number.parseInt(at36, 36);
      if (Number.isSafeInteger(at) && at > 0) wanted.push(path.join(dir, fileNameFor(at)));
      for (let back = 0; back < 3; back++) {
        const d = new Date(now());
        d.setUTCMonth(d.getUTCMonth() - back, 1);
        const f = path.join(dir, fileNameFor(d.getTime()));
        if (!wanted.includes(f)) wanted.push(f);
      }
      for (const file of wanted) {
        let text;
        try {
          const stat = fs.statSync(file);
          if (stat.size > REWRITE_MAX_BYTES) return { ok: false, reason: 'too-large' };
          text = fs.readFileSync(file, 'utf8');
        } catch { continue; }   // 没有这个文件（或读不动）：换下一个月
        const lines = text.split('\n');
        let hitAt = 0;
        let found = false;
        const kept = [];
        for (const line of lines) {
          if (!line.trim()) { kept.push(line); continue; }   // 空行原样留着
          if (!found) {
            try {
              const o = JSON.parse(line);
              if (o && typeof o === 'object' && o.id === key) { found = true; hitAt = Number(o.at) || 0; continue; }
            } catch { /* 坏行不可能是目标，且原样保留 */ }
          }
          kept.push(line);
        }
        if (!found) continue;   // 这个月里没有：保留下一个候选
        const tmp = `${file}.tmp`;
        try {
          fs.writeFileSync(tmp, kept.join('\n'), 'utf8');
          fs.renameSync(tmp, file);
        } catch (e) {
          log.warn(`[feedback] 删除失败：${e?.code || e?.message}`);
          try { fs.unlinkSync(tmp); } catch { /* ignore */ }
          return { ok: false, reason: 'unwritable' };
        }
        log.info?.(`[feedback] 面板删除了一条反馈（${key}）`);
        return { ok: true, removed: true, at: hitAt };
      }
      return { ok: false, reason: 'not-found' };
    },
  };
}
