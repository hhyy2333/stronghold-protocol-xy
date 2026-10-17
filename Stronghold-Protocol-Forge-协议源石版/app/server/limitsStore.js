// server/limitsStore.js — 服务器上限的落盘与读回（server/admin.js 写，server/index.js 在启动与轮询时读）。
//
// 为什么要有这个文件：和封禁名单（server/banStore.js）逐字同一个理由——上限必须是**状态**而不是一次性命令。
// 运维把上限从 200 调到 400，进程重启、蓝绿热切换、崩一次之后它都该还是 400。只存在内存里的设置会在部署那一刻
// 悄悄回到默认值，而那正是最不希望它变的时刻。
//
// 为什么不用 data/ 或安装目录：蓝绿热更新会整个替换 /opt/Stronghold-Protocol-{a,b}，写在安装目录里的东西每次
// 更新都会没。默认落到 **进程用户的家目录** `~/sp-limits/`（可用 SP_LIMITS_DIR 覆盖）。
//
// 为什么两个槽要轮询：线上是**两个进程**共用一个文件。面板把上限写进文件，但只有收到那次 POST 的槽知道；另一个
// 槽（可能正在排空、还有几十个人在上面）如果不重读，就会继续按旧上限收人。3 秒足够——上限不像封禁那样是个安全
// 控制，晚 3 秒只是多收进来几个 socket。
//
// 存储形状：一个文件 `limits.json`，内容是 `{"version":1,"maxConnections":400,"at":…,"by":…}`。整份重写而不是
// 追加——这是一份**状态**（永远只有一个当前值）。先写临时文件再 rename，所以进程在任何时刻被打断都不会留下半截
// JSON。
//
// 读回一律过 server/limits.js `normalizeLimits`：盘上的东西是**信任边界之外**的（可能是手改的、旧的、写坏的），
// 坏文档一律丢掉而不是猜。读的**成败**同样分两种含义，混为一谈会让一次磁盘抖动把上限悄悄放开：
//   * `{ ok: true, limits: null }` = 文件不存在（没覆盖过，启动参数说了算） → 采纳；
//   * `{ ok: true, limits: { maxConnections: null } }` = 操作员明确**清除了**面板覆盖 → 同样回落到启动参数；
//   * `{ ok: false }` = 文件在但读不动 / 不是 JSON / 形状不对 / 缺了 maxConnections 键 → **什么都不做**。
// 最后一条尤其重要：一个被截断的 `{}` 绝不能读成「不限制」，否则写坏一次文件就等于把服务器的人数门敞开。

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { LIMITS_VERSION, normalizeLimits } from './limits.js';

/** 默认目录：家目录下的 sp-limits（不在安装目录里，热更新不会清掉）。 */
export function defaultLimitsDir() {
  const env = process.env.SP_LIMITS_DIR;
  return env && env.trim() ? env.trim() : path.join(os.homedir(), 'sp-limits');
}

/** 文件名。整份重写，所以永远只有一个文件。 */
export const LIMITS_FILE = 'limits.json';

/**
 * 多久看一次盘上的上限（server/index.js 的轮询间隔）。
 *
 * 和封禁名单同一个数字，同为蓝绿两进程共用一份状态：面板改完最多 3 秒覆盖另一个槽。代价是一个几十字节文件的
 * readSync。
 */
export const LIMITS_POLL_MS = 3000;

/** 读回上限：正常文档不到 200 字节，超过说明文件被写坏了，当作读不到而不是读进内存。 */
const MAX_FILE_BYTES = 64 * 1024;

/**
 * 服务器上限的存储。
 * @param {{ dir?: string, log?: object, now?: () => number }} [opts]
 */
export function createLimitsStore({ dir = defaultLimitsDir(), log = console, now = Date.now } = {}) {
  const file = path.join(dir, LIMITS_FILE);
  let ready = false;
  let warned = false;

  /** 目录准备（第一次写时建）。建不出来只警告一次：上限退回「只在本进程生效」。 */
  function ensureDir() {
    if (ready) return true;
    try {
      fs.mkdirSync(dir, { recursive: true });
      ready = true;
      return true;
    } catch (e) {
      if (!warned) {
        warned = true;
        log.warn?.(`[limits] 目录不可写，服务器上限将无法持久化：${dir}（${e?.code || e?.message}）`);
      }
      return false;
    }
  }

  /**
   * 落盘整份文档。先写 .tmp 再 rename：任何时刻被打断都不会留下半截 JSON。
   * @param {number | null} maxConnections 已规整；null = 清除面板覆盖（回落到启动参数）
   * @param {{ by?: string | null, maxBots?: number | null, maxBotsPerRoom?: number | null }} [meta]
   *   人机那两个（业主 2026-10-16）：**给了才写**（`undefined` = 这一格不动，保留盘上原值），`null` = 清除该格的覆盖。
   * @returns {boolean} 是否写成功（失败只影响持久化，不影响本进程已经生效的值）
   */
  function write(maxConnections, { by = null, maxBots = undefined, maxBotsPerRoom = undefined } = {}) {
    if (!ensureDir()) return false;
    const tmp = `${file}.tmp`;
    try {
      // 人机那两格要与盘上的原值合并：面板只改一格时，另一格不能被抹掉。
      const prev = readState().limits || {};
      const doc = {
        version: LIMITS_VERSION,
        maxConnections,
        maxBots: maxBots === undefined ? (prev.maxBots ?? null) : maxBots,
        maxBotsPerRoom: maxBotsPerRoom === undefined ? (prev.maxBotsPerRoom ?? null) : maxBotsPerRoom,
        at: now(),
        by,
      };
      fs.writeFileSync(tmp, JSON.stringify(doc), 'utf8');
      fs.renameSync(tmp, file);
      return true;
    } catch (e) {
      log.warn?.(`[limits] 写入失败：${e?.code || e?.message}`);
      try { fs.unlinkSync(tmp); } catch { /* ignore */ }
      return false;
    }
  }

  /**
   * 读回上限 **以及这次读到了没有**（见文件头：`{ok:true,limits:null}` 与 `{ok:false}` 必须区分）。永不抛。
   * @returns {{ ok: boolean, limits: { maxConnections: number | null, at: number | null, by: string | null } | null }}
   */
  function readState() {
    let text;
    try {
      const stat = fs.statSync(file);
      if (stat.size > MAX_FILE_BYTES) {
        log.warn?.(`[limits] ${LIMITS_FILE} 过大（${stat.size} B），忽略`);
        return { ok: false, limits: null };
      }
      text = fs.readFileSync(file, 'utf8');
    } catch (e) {
      // 文件不存在 = 没有覆盖（合法状态，启动参数说了算）；其它读取错误 = 不知道，什么都不做。
      if (e?.code === 'ENOENT') return { ok: true, limits: null };
      log.warn?.(`[limits] ${LIMITS_FILE} 读不动：${e?.code || e?.message}`);
      return { ok: false, limits: null };
    }
    let parsed;
    try { parsed = JSON.parse(text); } catch {
      log.warn?.('[limits] limits.json 不是合法 JSON，忽略');
      return { ok: false, limits: null };
    }
    const r = normalizeLimits(parsed);
    if (!r.ok) {
      log.warn?.(`[limits] limits.json 里的上限不合法（${r.error}），忽略`);
      return { ok: false, limits: null };
    }
    return {
      ok: true,
      limits: {
        maxConnections: r.maxConnections,
        // 人机两格（业主 2026-10-16）：缺键 = 没设过 = 跟随启动参数
        maxBots: r.maxBots,
        maxBotsPerRoom: r.maxBotsPerRoom,
        at: Number.isFinite(parsed?.at) ? Number(parsed.at) : null,
        by: typeof parsed?.by === 'string' && parsed.by ? parsed.by : null,
      },
    };
  }

  return {
    dir,
    file,
    /** 只要上限、不区分读到与否（启动时用；轮询请用 readState）。 */
    read() { return readState().limits; },
    readState,
    write,
    /** 同 write（与 announceStore 的 save 同名习惯）。 */
    save(maxConnections, meta) { return write(maxConnections, meta); },
  };
}
