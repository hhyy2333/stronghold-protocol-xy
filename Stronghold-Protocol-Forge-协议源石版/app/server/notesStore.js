// server/notesStore.js — 更新公告的落盘与读回（server/admin.js 写，server/http/routes.js 读)。
//
// WHY A FILE AND NOT THE CHECKOUT. The notes used to be a static module (public/js/ui/updateNotesData.js) that only
// shipped with a release: changing a typo meant editing the tree and redeploying. The owner asked to edit them from
// the admin panel instead (2026-10-13「我要能直接在服务端改更新公告」). So the live copy lives OUTSIDE the install
// tree, for the same reason as server/announceStore.js and server/feedback.js: a blue-green update replaces
// /opt/Stronghold-Protocol-{a,b} wholesale, and anything written inside it would vanish on every deploy.
// Default: `~/sp-notes/` (SP_NOTES_DIR overrides; on the server, /var/lib/stronghold/notes).
//
// THE ANNOUNCEMENT IS ONE FREE-FORM TEXT (owner's decision 2026-10-13: no fixed format, no multi-language). The stored
// document is `{ current: { text }, at, by }` — see shared/updateNotes.js for what a valid revision is and why the
// digest of that text is the revision's identity.
//
// THE BUILT-IN COPY IS THE FALLBACK, NOT THE SOURCE. public/js/ui/updateNotesData.js still ships (and is still what
// the browser shows when this store is empty or unreadable), so a fresh install with no notes file behaves exactly as
// before. Once an operator saves from the panel, the file wins — for the server AND for every client.
//
// ONE FILE, WHOLE-REWRITE. The notes are a single document, not a log: `current.json` holds
// `{ current: <notes|null>, at, by }`. Rewriting it wholesale means there is never a "which line is current?" question
// and never a partially-applied edit. Written to `.tmp` then renamed, so an interrupted process cannot leave half a
// JSON document behind (rename within one filesystem is atomic).
//
// EVERY READ GOES THROUGH shared/updateNotes.js `normalizeNotes`. The file is outside the trust boundary — hand-edited,
// truncated by a full disk, written by a future version — so a bad document is reported and ignored rather than
// guessed at, and never reaches a player's screen.

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { normalizeNotes, notesDigest } from '../shared/updateNotes.js';

/** Default directory: `~/sp-notes` (never inside the install tree — a deploy would delete it). */
export function defaultNotesDir() {
  const env = process.env.SP_NOTES_DIR;
  return env && env.trim() ? env.trim() : path.join(os.homedir(), 'sp-notes');
}

/** The one file. Wholesale rewrite, so there is never a second one to reconcile. */
export const NOTES_FILE = 'current.json';

/**
 * The 更新公告 store.
 * @param {{ dir?: string, log?: object, now?: () => number }} [opts]
 */
export function createNotesStore({ dir = defaultNotesDir(), log = console, now = Date.now } = {}) {
  const file = path.join(dir, NOTES_FILE);
  let ready = false;
  let warned = false;

  /** Prepare the directory on first write. If it cannot be created, warn once and run read-only. */
  function ensureDir() {
    if (ready) return true;
    try {
      fs.mkdirSync(dir, { recursive: true });
      ready = true;
      return true;
    } catch (e) {
      if (!warned) {
        warned = true;
        log.warn?.(`[notes] 目录不可写，更新公告无法保存：${dir}（${e?.code || e?.message}）`);
      }
      return false;
    }
  }

  /**
   * Write the document. `null` clears the live copy (the built-in fallback then applies again).
   * @param {object|null} notes already normalized
   * @param {{ by?: string|null }} [meta]
   * @returns {boolean} whether it reached the disk
   */
  function write(notes, { by = null } = {}) {
    if (!ensureDir()) return false;
    const tmp = `${file}.tmp`;
    try {
      const doc = { current: notes, at: now(), by };
      fs.writeFileSync(tmp, JSON.stringify(doc), 'utf8');
      fs.renameSync(tmp, file);
      return true;
    } catch (e) {
      log.warn?.(`[notes] 写入失败：${e?.code || e?.message}`);
      try { fs.unlinkSync(tmp); } catch { /* ignore */ }
      return false;
    }
  }

  /**
   * Read the live notes back. A missing file is the normal "not set yet" case (the built-in fallback applies); a
   * malformed one is reported and treated as absent, never thrown.
   * @returns {{ notes: object, at: number, by: string|null } | null}
   */
  function readDocument() {
    let text;
    try { text = fs.readFileSync(file, 'utf8'); } catch { return null; }
    let parsed;
    try { parsed = JSON.parse(text); } catch {
      log.warn?.('[notes] current.json 不是合法 JSON，忽略（沿用内置公告）');
      return null;
    }
    const raw = parsed?.current;
    if (raw == null) return null;
    const r = normalizeNotes(raw);
    if (!r.ok) {
      log.warn?.(`[notes] current.json 里的公告不合法（${r.error}），忽略（沿用内置公告）`);
      return null;
    }
    const at = Number.isFinite(parsed?.at) ? Number(parsed.at) : 0;
    const by = typeof parsed?.by === 'string' && parsed.by ? parsed.by : null;
    return { notes: r.notes, at, by };
  }

  return {
    dir,
    file,
    read: readDocument,

    /**
     * Save an untrusted notes object: normalize, then persist. Refuses (without writing) when the object is not a
     * usable revision, so a broken save can never replace a working one.
     * @param {unknown} raw
     * @param {{ by?: string|null }} [meta]
     * @returns {{ ok: true, notes: object, digest: string, at: number, by: string|null, warnings: string[] }
     *   | { ok: false, error: string, message?: string, unwritable?: boolean }}
     */
    save(raw, meta = {}) {
      const r = normalizeNotes(raw);
      if (!r.ok) return { ok: false, error: r.error };
      const stored = write(r.notes, meta);
      return {
        ok: true,
        notes: r.notes,
        digest: notesDigest(r.notes),
        at: now(),
        by: typeof meta.by === 'string' && meta.by ? meta.by : null,
        warnings: r.warnings,
        // The save is live for this process either way; `unwritable` says the next boot will fall back.
        ...(stored ? {} : { unwritable: true }),
      };
    },

    /** Clear the live copy (the built-in revision applies again). */
    clear() {
      return write(null);
    },
  };
}
