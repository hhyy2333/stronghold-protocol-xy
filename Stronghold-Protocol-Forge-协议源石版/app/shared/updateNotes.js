// shared/updateNotes.js — the 更新公告 shape: ONE free-form text, how it is cleaned, and its digest.
//
// FREE TEXT, ONE LANGUAGE (owner's decision, 2026-10-13). The notes used to be a structured document — a `version`, an
// ISO `date`, a `headline`, `sections[]` of items, every entry carrying `zh` / `en` (and optionally more) — and the
// panel made the operator hand-write that JSON. The owner's verdict: 「要有固定格式写我不喜欢，应该自由写，然后不需要
// 多语言」. So the revision is now exactly what an operator types:
//
//   { text: '一段随便写的公告，可以有换行。\n\n- 想分条就自己打 - \n- 面板会把它渲染成分条' }
//
// What that changes: no fields to fill in, no JSON to get right, no per-language duplication. What it does NOT change
// is the one mechanism that makes the feature work — the DIGEST. A revision's identity is still its content (see
// `notesDigest`), so editing one word still re-pops the panel for everyone, and a version bumped elsewhere in the
// project still does not. The player sees the text in whatever language the operator wrote it in; there is no
// per-language fallback to reason about.
//
// WHY THIS IS SHARED. The operator edits the notes in /admin/, the server persists them (server/notesStore.js) and
// every browser fetches them (`GET /api/notes`), so all three parties must agree on what a valid revision is:
//   * the server validates and normalizes what it is about to hand every player (the trust boundary: a hand-edited or
//     half-written file must never put a non-string on the whole server's screen);
//   * the browser validates what it fetched and falls back to its built-in copy when the fetch fails;
//   * both compute the SAME digest, which is the whole unlock mechanism.
//
// PURE AND DEPENDENCY-FREE, like shared/dataPacks.js: the browser imports it too, so no node builtins.
//
// PORT NOTE (协议源石版): upstream imports these two from `shared/dataPacks.js`, a module THIS tree does not have.
// `shared/modIdentity.js` already ships both — same sorted-key canonical form, same SHA-256 — and the two pairs were
// verified to produce byte-identical digests before this repoint (8 shapes incl. undefined/null/nested/中文). The
// digest is the unlock mechanism shared with every client, so an accidental divergence would silently lock all of
// them out; that check is the reason this is a comment and not a re-implementation.

import { canonicalJson, sha256Hex } from './modIdentity.js';

/**
 * The only cap: characters of the whole announcement. Generous for release notes (this is ~4 000 characters of prose,
 * far more than anyone reads in a pop-up) and small enough that one bad paste cannot bloat every client — the text
 * travels to every browser on every page load.
 */
export const NOTES_LIMITS = Object.freeze({
  text: 4000,
});

/**
 * Clean a free-form announcement: normalize line endings, strip control characters, collapse runs of spaces/tabs, keep
 * PARAGRAPH BREAKS, trim, cap the length.
 *
 * Blank lines are PRESERVED (up to one at a time): they are how a person writing prose separates paragraphs, and
 * flattening them — as the structured model did, when a note was one line per item — would destroy the only layout a
 * free-text announcement has. A LONGER run of blank lines (3+) collapses to one, so leaning on the Enter key does not
 * turn into a wall of empty space on a phone.
 *
 * Returns '' when nothing survives, which the caller treats as "there is no announcement" rather than as an error.
 * @param {unknown} raw
 * @param {number} max
 * @returns {string}
 */
export function sanitizeNotesText(raw, max = NOTES_LIMITS.text) {
  if (typeof raw !== 'string') return '';
  return raw
    .replace(/\r\n?/g, '\n')
    // The C0/C1 control range with \t and \n excluded (both are handled by the whitespace rules below).
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]+/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    // Every line is trimmed: an accidental leading space (a paste out of an indented document, a stray tap) would
    // otherwise render as a visible indent in a `pre-wrap` block, which reads as a formatting mistake.
    .split('\n').map((l) => l.trim()).join('\n')
    .replace(/^\n+/, '')
    .replace(/\n+$/, '')
    .slice(0, max);
}

/** Whether `v` is a plain object (not null, not an array). */
export const isPlainObject = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Validate + normalize an untrusted revision into the canonical shape, or explain why it is unusable.
 *
 * Accepts either the canonical `{ text }` or a BARE string, because the two callers write differently: the panel posts
 * an object, while a hand-written `curl` or a person editing `current.json` naturally writes just the text. Both land
 * on the same normalized object, so the digest cannot depend on which door was used.
 *
 * The result is what gets persisted, handed to every client and hashed — so the same input always yields the same
 * digest, and a cosmetic difference (a stray trailing space, CRLF instead of LF) cannot produce a "revision" that
 * nobody actually edited.
 *
 * @param {unknown} raw
 * @returns {{ ok: true, notes: { text: string }, warnings: string[] } | { ok: false, error: string }}
 */
export function normalizeNotes(raw) {
  const source = isPlainObject(raw) ? /** @type {any} */ (raw).text : raw;
  if (typeof source !== 'string') return { ok: false, error: 'BAD_NOTES' };
  // Clean WITHOUT the cap first: only then does a shorter result mean the CAP cut something. Comparing against the raw
  // input instead would report TEXT_TRUNCATED for a text that merely had its whitespace normalized.
  const cleaned = sanitizeNotesText(source, Number.MAX_SAFE_INTEGER);
  const text = cleaned.slice(0, NOTES_LIMITS.text);
  if (!text) return { ok: false, error: 'EMPTY' };
  const warnings = cleaned.length > text.length ? ['TEXT_TRUNCATED'] : [];
  // One key, always in this order: the object is hashed by canonicalJson, so a fixed shape is what keeps the digest
  // stable across callers and versions.
  return { ok: true, notes: { text }, warnings };
}

/**
 * Lay an announcement out as blocks. THE ONLY TWO RULES a writer has to know:
 *   * a BLANK LINE separates paragraphs;
 *   * a line starting with `- `, `* ` or `• ` is a bullet.
 * Everything else — including line breaks inside a paragraph — is shown exactly as written.
 *
 * It lives here, in the shared shape module, because TWO surfaces must agree on it: the player's panel
 * (public/js/ui/updateNotes.js) and the live preview in the admin editor (public/admin/admin.js). A preview that
 * laid the text out differently from the panel would be worse than no preview at all.
 *
 * @param {string} text
 * @returns {({ kind: 'p', text: string } | { kind: 'ul', items: string[] })[]}
 */
export function notesBlocks(text) {
  /** @type {({ kind: 'p', text: string } | { kind: 'ul', items: string[] })[]} */
  const out = [];
  /** @type {string[]} */
  let para = [];
  /** @type {string[]} */
  let bullets = [];
  const flushPara = () => { if (para.length) { out.push({ kind: 'p', text: para.join('\n') }); para = []; } };
  const flushBullets = () => { if (bullets.length) { out.push({ kind: 'ul', items: bullets.slice() }); bullets = []; } };
  for (const raw of String(text ?? '').split('\n')) {
    const line = raw.replace(/[ \t]+$/, '');
    const bullet = /^[ \t]*[-*•][ \t]+(.*)$/.exec(line);
    if (bullet) { flushPara(); bullets.push(bullet[1]); continue; }
    if (!line.trim()) { flushPara(); flushBullets(); continue; }
    flushBullets();
    para.push(line);
  }
  flushPara();
  flushBullets();
  return out;
}

/**
 * The digest of a revision: its canonical content, hashed. THIS IS THE REVISION'S IDENTITY — a browser stores it when
 * the player closes the panel and compares it on the next visit, so ANY content change re-pops the panel for everyone
 * and a change of hash recipe is a breaking change for every stored record.
 *
 * The recipe is deliberately unchanged from the structured era (canonicalJson + sha256Hex over the notes object): a
 * browser that stored a digest of the old shape simply does not match the new one and shows the panel once more, which
 * is exactly what the owner wants to happen after this change.
 * @param {{ text?: string }|object} notes
 * @returns {string} 64 lowercase hex characters
 */
export function notesDigest(notes) {
  return sha256Hex(canonicalJson(notes));
}

/**
 * A human-readable reason per error code (the panel shows it; the browser only logs it).
 *
 * ASCII on purpose: this lives in `shared/`, which the i18n pipeline scans (tools/i18n.mjs), and these are operator
 * diagnostics rather than player-facing text — the panel supplies its own localized frame ("保存失败：{why}" /
 * "Save failed: {why}"). The announcement itself is data and is shown exactly as written.
 * @param {string} code
 * @returns {string}
 */
export function notesErrorText(code) {
  switch (code) {
    case 'BAD_NOTES': return 'the announcement must be text';
    case 'EMPTY': return 'the announcement is empty';
    case 'TEXT_TRUNCATED': return `the announcement was cut to ${NOTES_LIMITS.text} characters`;
    default: return code;
  }
}
