// server/banStore.js — 封禁名单的落盘与读回（server/bans.js 写，server/index.js 在启动与轮询时读）。
//
// 为什么要有这个文件：封禁必须是**状态**而不是一次性动作。运维封掉一个人，进程重启、蓝绿热切换、崩一次
// 之后他都不该能再进来。mem-only 的名单在部署那一刻就忘了 —— 而那正是最需要它的时候。
//
// 为什么不用 data/ 或安装目录：和 server/announceStore.js、server/feedback.js 同一个理由——蓝绿热更新会整个替换
// /opt/Stronghold-Protocol-{a,b}，写在安装目录里的东西每次更新都会没。默认落到 **进程用户的家目录**
// `~/sp-bans/`（可用 SP_BAN_DIR 覆盖，服务器上建议设成 /var/lib/stronghold/bans）。
//
// 为什么两个槽要轮询这份文件：线上是**两个进程**共用一个文件。面板把一条封禁写进文件，但只有收到那次 POST 的
// 槽知道；另一个槽的会话、房间、socket 全都还在。所以两边都按 BAN_POLL_MS 重读这份文件——封禁必须在几秒内覆盖
// **整个部署**，只挡一半的安全控制等于没有。（同 server/announceStore.js 的 3 秒轮询；那里的代价是一条公告晚 3 秒，
// 这里是一条封禁晚 3 秒。）
//
// 存储形状：一个文件 `bans.json`，内容是 `{"version":1,"bans":[…]}`。整份重写而不是追加——名单是**状态**，
// 追加会越攒越多、还得靠回放去重。先写临时文件再 rename，所以进程在任何时刻被打断都不会留下半截 JSON。
//
// 读回一律过 server/bans.js `normalizeBanEntry`：盘上的东西是**信任边界之外**的（可能是手改的、旧的、写坏的），
// 坏条目一律丢掉而不是猜。但注意读的**成败**分两种含义，混为一谈会出大事：
//   * `{ ok: true, entries: [] }` = 文件不存在，或里面确实一条都没有 → 采纳（"没有封禁"是合法状态）；
//   * `{ ok: false }` = 文件在但读不动 / 不是 JSON / 形状不对 → **什么都不做**。
// 把"读不到"当成"空名单"会让一次磁盘抖动把全服的封禁清空。

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { normalizeBanEntry } from './bans.js';

/** 默认目录：家目录下的 sp-bans（不在安装目录里，热更新不会清掉）。 */
export function defaultBanDir() {
  const env = process.env.SP_BAN_DIR;
  return env && env.trim() ? env.trim() : path.join(os.homedir(), 'sp-bans');
}

/** 名单文件名。整份重写，所以永远只有一个文件。 */
export const BAN_FILE = 'bans.json';

/**
 * 多久看一次盘上的名单（server/index.js 的轮询间隔）。
 *
 * 与公告同一个数字，同为蓝绿两进程共用一份状态：一条封禁最多晚 3 秒覆盖另一个槽。代价是一个几百字节文件的
 * readSync。
 */
export const BAN_POLL_MS = 3000;

/** 读回上限：正常名单（BAN_LIST_MAX 条）远小于此，超过说明文件被写坏了，当作读不到而不是读进内存。 */
const MAX_FILE_BYTES = 4 * 1024 * 1024;

/**
 * 封禁名单的存储。
 * @param {{ dir?: string, log?: object, now?: () => number }} [opts]
 */
export function createBanStore({ dir = defaultBanDir(), log = console, now = Date.now } = {}) {
  const file = path.join(dir, BAN_FILE);
  let ready = false;
  let warned = false;

  /** 目录准备（第一次写时建）。建不出来只警告一次：封禁退回「只在本进程生效」。 */
  function ensureDir() {
    if (ready) return true;
    try {
      fs.mkdirSync(dir, { recursive: true });
      ready = true;
      return true;
    } catch (e) {
      if (!warned) {
        warned = true;
        log.warn?.(`[bans] 目录不可写，封禁名单将无法持久化：${dir}（${e?.code || e?.message}）`);
      }
      return false;
    }
  }

  /**
   * 落盘整份名单。先写 .tmp 再 rename：任何时刻被打断都不会留下半截 JSON。
   * @param {{ rule: string, reason: string, by: string, at: number, until: number | null }[]} entries
   * @returns {boolean} 是否写成功（失败只影响持久化，不影响本次封禁）
   */
  function write(entries) {
    if (!ensureDir()) return false;
    const tmp = `${file}.tmp`;
    try {
      fs.writeFileSync(tmp, JSON.stringify({ version: 1, bans: Array.isArray(entries) ? entries : [] }), 'utf8');
      fs.renameSync(tmp, file);
      return true;
    } catch (e) {
      log.warn?.(`[bans] 写入失败：${e?.code || e?.message}`);
      try { fs.unlinkSync(tmp); } catch { /* ignore */ }
      return false;
    }
  }

  /**
   * 读回名单 **以及这次读到了没有**（见文件头：`{ok:true,entries:[]}` 与 `{ok:false}` 必须区分）。
   * 永不抛。
   * @returns {{ ok: boolean, entries: { rule: string, reason: string, by: string, at: number, until: number | null }[] }}
   */
  function readState() {
    let text;
    try {
      const stat = fs.statSync(file);
      if (stat.size > MAX_FILE_BYTES) {
        log.warn?.(`[bans] ${BAN_FILE} 过大（${stat.size} B），忽略`);
        return { ok: false, entries: [] };
      }
      text = fs.readFileSync(file, 'utf8');
    } catch (e) {
      // 文件不存在 = 没有封禁（合法状态）；其它读取错误 = 不知道，什么都不做。
      if (e?.code === 'ENOENT') return { ok: true, entries: [] };
      log.warn?.(`[bans] ${BAN_FILE} 读不动：${e?.code || e?.message}`);
      return { ok: false, entries: [] };
    }
    let parsed;
    try { parsed = JSON.parse(text); } catch {
      log.warn?.('[bans] bans.json 不是合法 JSON，忽略');
      return { ok: false, entries: [] };
    }
    if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.bans)) {
      log.warn?.('[bans] bans.json 形状不对（缺 bans 数组），忽略');
      return { ok: false, entries: [] };
    }
    const out = [];
    let dropped = 0;
    for (const raw of parsed.bans) {
      const entry = normalizeBanEntry(raw, now());
      if (entry) out.push(entry); else dropped++;
    }
    if (dropped) log.warn?.(`[bans] bans.json 里有 ${dropped} 条不合法记录，已忽略`);
    return { ok: true, entries: out };
  }

  return {
    dir,
    file,
    /** 只要名单、不区分读到与否（启动时用；轮询请用 readState）。 */
    read() { return readState().entries; },
    readState,
    write,
    /** 同 write（与 announceStore 的 save 同名习惯）。 */
    save(entries) { return write(entries); },
    /** 清空名单。 */
    clear() { return write([]); },
  };
}
