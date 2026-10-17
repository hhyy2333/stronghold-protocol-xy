// server/announceStore.js — 全体公告的落盘与读回（server/admin.js 写，server/lobby.js 读）。
//
// 为什么要有这个文件：公告以前是「推给当时在线的人」，之后才连上的人看不到、重启即忘。业主要求**持久化**：
// 公告写下去以后要一直在，直到被下一条顶掉或被撤回。于是「当前公告」是一份**状态**而不是一次性广播——
//   * 发布 → 落盘，并推给所有在线会话；
//   * 新会话连上（server/lobby.js onHello）→ 读回当前公告补推一次，所以晚来的人也看得到；
//   * 进程重启（server/index.js）→ 从盘上读回来，公告照旧挂着，蓝绿热更新/崩溃都不会把它弄丢；
//   * 撤回 → 落盘为空，并向所有在线会话推一条「已清空」。
//
// 为什么不用 data/ 或安装目录：和 server/feedback.js 同一个理由——蓝绿热更新会整个替换
// /opt/Stronghold-Protocol-{a,b}，写在安装目录里的东西每次更新都会没。默认落到 **进程用户的家目录**
// `~/sp-announce/`（可用 SP_ANNOUNCE_DIR 覆盖，服务器上建议设成 /var/lib/stronghold/announce）。
//
// 存储形状：一个文件 `current.json`，内容是一条 JSON 记录（没有当前公告时是 `{"current":null}`）。整份重写而不是
// 追加——公告是**状态**（永远只有一条），追加会越攒越多且读回时还要挑最后一条，反而更容易读错。先写临时文件再
// rename，所以进程在任何时刻被打断都不会留下半截 JSON（rename 在同一文件系统上是原子的）。
//
// 读回一律过 shared/announce.js `normalizeAnnouncement`：盘上的东西是**信任边界之外**的（可能是手改的、旧的、
// 写坏的），坏记录一律丢掉而不是猜，绝不让一个非字符串的 `text` 走到每个人的屏幕上。

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { normalizeAnnouncement } from '../shared/announce.js';

/** 默认目录：家目录下的 sp-announce（不在安装目录里，热更新不会清掉）。 */
export function defaultAnnounceDir() {
  const env = process.env.SP_ANNOUNCE_DIR;
  return env && env.trim() ? env.trim() : path.join(os.homedir(), 'sp-announce');
}

/** 当前公告的文件名。整份重写，所以永远只有一个文件。 */
export const ANNOUNCE_FILE = 'current.json';

/**
 * 多久看一次盘上的公告（server/index.js 的轮询间隔）。
 *
 * 为什么必须轮询：一个部署是**两个进程**（蓝绿）共用这一个文件。面板把线写进文件，但只有收到那次 POST 的槽会
 * 把线推给它的会话；另一个槽启动时读一次，之后再也不看 —— 于是"从哪个面板发"决定了另一半玩家收不收得到
 * （2026-10-13 实测：从 :80 面板发的公告，排空中的旧槽上 14 个玩家一条都看不到）。
 * 3 秒：真发布一条时另一半最多晚 3 秒；代价是一个 100 字节文件的 readSync。
 */
export const ANNOUNCE_POLL_MS = 3000;

/**
 * 全体公告的存储。
 * @param {{ dir?: string, log?: object, now?: () => number }} [opts]
 */
export function createAnnounceStore({ dir = defaultAnnounceDir(), log = console, now = Date.now } = {}) {
  const file = path.join(dir, ANNOUNCE_FILE);
  let ready = false;
  let warned = false;

  /** 目录准备（第一次写时建）。建不出来只警告一次，公告退回「只推不落盘」。 */
  function ensureDir() {
    if (ready) return true;
    try {
      fs.mkdirSync(dir, { recursive: true });
      ready = true;
      return true;
    } catch (e) {
      if (!warned) {
        warned = true;
        log.warn?.(`[announce] 目录不可写，公告将无法持久化：${dir}（${e?.code || e?.message}）`);
      }
      return false;
    }
  }

  /**
   * 落盘一条记录（`null` = 没有当前公告）。先写 .tmp 再 rename：任何时刻被打断都不会留下半截 JSON。
   * @param {{ id: string, text: string, at: number, seq: number } | null} record
   * @returns {boolean} 是否写成功（失败只影响持久化，不影响本次广播）
   */
  function write(record) {
    if (!ensureDir()) return false;
    const tmp = `${file}.tmp`;
    try {
      fs.writeFileSync(tmp, JSON.stringify({ current: record }), 'utf8');
      fs.renameSync(tmp, file);
      return true;
    } catch (e) {
      log.warn?.(`[announce] 写入失败：${e?.code || e?.message}`);
      try { fs.unlinkSync(tmp); } catch { /* ignore */ }
      return false;
    }
  }

  /**
   * 读回当前公告（进程启动时一次）。文件不存在 / 读不动 / 坏 JSON / 记录不合法 → null，绝不抛。
   * @returns {{ id: string, text: string, at: number, seq: number } | null}
   */
  function read() {
    return readState().record;
  }

  /**
   * 盘上的记录 **加上这次读到了没有** —— 轮询要能区分两件必须区分开的事：
   *   * `{ ok: true, record: null }` = 操作员**撤回了** → 每个槽都要把横幅撤下来；
   *   * `{ ok: false }` = 文件暂时读不动 / 坏 JSON / 记录不合法 → 任何槽都不许动（把"读不到"当成"撤回"会让
   *     一次磁盘抖动把全服的公告清掉）。
   * @returns {{ ok: boolean, record: { id: string, text: string, at: number, seq: number } | null }}
   */
  function readState() {
    let text;
    try { text = fs.readFileSync(file, 'utf8'); } catch { return { ok: false, record: null }; }
    let parsed;
    try { parsed = JSON.parse(text); } catch {
      log.warn?.('[announce] current.json 不是合法 JSON，忽略');
      return { ok: false, record: null };
    }
    if (parsed?.current == null) return { ok: true, record: null };
    const record = normalizeAnnouncement(parsed.current);
    if (record == null) {
      log.warn?.('[announce] current.json 里的公告记录不合法，忽略');
      return { ok: false, record: null };
    }
    return { ok: true, record };
  }

  return {
    dir,
    file,
    read,
    readState,
    write,

    /**
     * 发布：写盘并返回规整后的记录。
     * @param {{ id: string, text: string, at: number, seq: number }} record
     * @returns {{ id: string, text: string, at: number, seq: number }}
     */
    save(record) {
      const clean = normalizeAnnouncement(record);
      if (!clean) throw new TypeError('announceStore.save: 记录不合法');
      write(clean);
      return clean;
    },

    /** 撤回：把「当前公告」清空。 */
    clear() {
      return write(null);
    },
  };
}
