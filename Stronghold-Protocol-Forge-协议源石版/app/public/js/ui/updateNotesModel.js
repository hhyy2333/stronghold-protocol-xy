// public/js/ui/updateNotesModel.js — the "show the update notes exactly once per revision" rule.
//
// WHY A SEPARATE MODEL. This is the one part of the feature that must not be wrong, so it has no Preact and no DOM in
// it: the tests drive every branch (a fresh revision, an already-seen revision, a corrupt record, a browser that
// refuses to store, two dismissals racing) without a browser. The panel (ui/updateNotes.js) only renders what this
// module decides.
//
// WHAT "SEEN" MEANS. The identity of a revision is the DIGEST OF ITS TEXT (canonicalJson + sha256Hex over `{ text }`),
// not a version number. Consequences, all of them intended:
//   * edit one word → new digest → the panel shows again for everyone;
//   * add a paragraph, reorder a section, reword a bullet → shows again;
//   * bump a version number somewhere else in the project without touching the announcement → NO pop, because nothing
//     new has been said. That is the literal ask ("有新东西了，才再弹一次").
// A stored `{ seen: <digest> }` is the whole state. There is no timestamp arithmetic, no "ignore if older than",
// no per-version list to keep in sync: one comparison, and a revision can never be half-seen.
//
// THE ANNOUNCEMENT IS ONE FREE-FORM TEXT (owner's decision 2026-10-13: no fixed format, no multi-language), so there is
// nothing to pick per language here — the operator's words are shown exactly as written, to everyone.
//
// WHERE THE NOTES COME FROM (changed 2026-10-13). The operator edits them in /admin/ and server/notesStore.js persists
// them; the browser fetches them from `GET /api/notes` at boot. `updateNotesData.js` is still the BUILT-IN copy and
// remains the fallback — if the request fails, if the server has no notes file, or if the body does not check out, the
// built-in revision is used and the feature behaves exactly as it did before. Whatever ends up active, the digest is
// computed over THAT object, which is why "which copy am I on?" can never desynchronize the pop decision from what the
// player actually read.
//
// THE FAILURE THIS IS BUILT AGAINST. "Closes it, reloads, and it is back" is only possible if the stored digest is
// lost or never written. So:
//   * the record is written BEFORE the panel is considered closed, and every close path (button, Escape, backdrop,
//     route change) funnels into the single `closeUpdateNotes()`;
//   * writing is VERIFIED by reading it back — `savePref` swallows quota / private-mode failures, so a write that
//     silently did not stick falls back to an in-memory digest for the rest of the page load (the panel cannot
//     re-open on a route change) and `markUpdateNotesSeen` reports the truth to its caller;
//   * a record that is absent, unparseable, the wrong shape, or from another key space reads as NOT SEEN — the safe
//     direction. A corrupt value costs one extra look at the notes; it can never steal the notes from a player.

import { loadPref, savePref } from '../store.js';
import { notesDigest, normalizeNotes } from '../../../shared/updateNotes.js';
import { UPDATE_NOTES } from './updateNotesData.js';

/** localStorage key under `sp.pref.` (store.js loadPref/savePref add the prefix). */
export const NOTES_PREF_KEY = 'updateNotes';

/** The public endpoint the live notes are fetched from (server/http/routes.js, `GET /api/notes`). */
export const NOTES_URL = '/api/notes';

/** The notes in force right now: the built-in revision until (and unless) the server's copy is installed. */
let activeNotes = UPDATE_NOTES;

/** The notes in force right now (what the panel renders and what the digest is computed over). */
export function getActiveNotes() { return activeNotes; }

/** The digest of a notes object: its content, canonicalized. Any content change moves it. */
export function updateNotesDigest(notes = activeNotes) {
  return notesDigest(notes);
}

/**
 * Install the server's copy as the active revision. Called once at boot by `loadUpdateNotes()`.
 *
 * The object stored is exactly what the server sent (and validated), so hashing it here reproduces the server's own
 * digest — that equality is asserted in the tests.
 *
 * @param {object} notes a notes object the server already normalized
 * @returns {boolean} whether the active revision actually changed (a listener is notified when it did)
 */
export function installNotes(notes) {
  if (!notes || typeof notes !== 'object' || typeof notes.text !== 'string') return false;
  if (notesDigest(notes) === notesDigest(activeNotes)) return false;
  activeNotes = notes;
  emit();
  return true;
}

/**
 * A stored record as `{ seen, at }`, or null when there is none / it is not one. Anything else — a string, an array,
 * a missing or empty `seen`, a `seen` that is not a string — is null, i.e. not seen.
 * @param {unknown} raw
 * @returns {{ seen: string, at: number }|null}
 */
export function normalizeSeenRecord(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const seen = /** @type {any} */ (raw).seen;
  if (typeof seen !== 'string' || !seen) return null;
  const at = /** @type {any} */ (raw).at;
  return { seen, at: Number.isFinite(at) ? at : 0 };
}

/** Set when this browser refused to persist (private mode, quota): the panel still opens at most once per load. */
let memorySeen = null;

/**
 * The digest this browser has already seen, or null. Reads storage live (there is no cache to go stale), then falls
 * back to the in-memory digest of this page load.
 * @returns {{ seen: string, at: number }|null}
 */
export function readSeenRecord() {
  const stored = normalizeSeenRecord(loadPref(NOTES_PREF_KEY, null));
  if (stored) return stored;
  return memorySeen ? { seen: memorySeen, at: 0 } : null;
}

/**
 * Record a revision as seen. Always sets the in-memory digest first, so even a refused write cannot bring the panel
 * back on a later route change in this page load.
 * @param {object} [notes]
 * @returns {boolean} whether it reached storage (false: in-memory only, it will show again after a reload)
 */
export function markUpdateNotesSeen(notes = activeNotes) {
  const digest = updateNotesDigest(notes);
  memorySeen = digest;
  savePref(NOTES_PREF_KEY, { seen: digest, at: Date.now() });
  const back = normalizeSeenRecord(loadPref(NOTES_PREF_KEY, null));
  return !!(back && back.seen === digest);
}

/**
 * Whether the panel should pop for this revision: yes unless the browser already recorded exactly this digest.
 * @param {object} [notes]
 * @returns {boolean}
 */
export function shouldShowUpdateNotes(notes = activeNotes) {
  const record = readSeenRecord();
  return !record || record.seen !== updateNotesDigest(notes);
}

// ---- the panel's own state (module-level, so every route and every mount agrees) ---------------------

/** @type {boolean} */
let open = false;
/** @type {Set<() => void>} */
const listeners = new Set();

function emit() { for (const fn of [...listeners]) fn(); }

/** Subscribe to open/close (the panel and any future menu entry). @param {() => void} fn */
export function onUpdateNotesChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }

/** Whether the panel is on screen. */
export function isUpdateNotesOpen() { return open; }

/** Open the notes by hand (the 查看更新公告 entry). Never marks anything seen. */
export function openUpdateNotes() {
  if (open) return false;
  open = true;
  emit();
  return true;
}

/**
 * Close the panel and record this revision as seen. Idempotent: a double click, an Escape landing beside a click, or
 * a close from two paths all write the same digest, so the state can never end up half-updated.
 * @returns {boolean} whether the write reached storage (see markUpdateNotesSeen)
 */
export function closeUpdateNotes() {
  const persisted = markUpdateNotesSeen();
  if (open) { open = false; emit(); }
  return persisted;
}

/**
 * The automatic pop: opens the panel when this revision has not been seen. Called once at boot (main.js) so the panel
 * is up before the first paint — "一进来就怼脸上", with no flash of an empty screen.
 * @returns {boolean} whether it opened
 */
export function maybeOpenUpdateNotes() {
  if (open || !shouldShowUpdateNotes()) return false;
  open = true;
  emit();
  return true;
}

/** Test-only: back to a fresh page load (module state does not reset between tests otherwise). */
export function resetUpdateNotesForTests() {
  open = false;
  memorySeen = null;
  listeners.clear();
  activeNotes = UPDATE_NOTES;
  loaded = null;
}

// ---- fetching the live revision (GET /api/notes) ------------------------------------------------

/** @type {Promise<{ source: string }>|null} the in-flight / settled load, so boot and the panel share one request. */
let loaded = null;

/**
 * The server's copy, validated with the SAME rules the server applied (`shared/updateNotes.js`).
 *
 * Anything unexpected — a network error, a non-200, a body that is not a valid revision — is NOT an error the player
 * should ever see: the built-in revision stays active and the feature is exactly what it was before. That is why this
 * never rejects.
 *
 * @param {{ fetchFn?: typeof fetch }} [opts] fetchFn is for tests (the suite passes a stub; the browser uses fetch).
 * @returns {Promise<{ source: 'server'|'builtin'|'unchanged', digest: string, notes: object, error?: string }>}
 */
export function loadUpdateNotes({ fetchFn } = {}) {
  if (loaded && !fetchFn) return loaded;
  const doFetch = fetchFn || globalThis.fetch;
  const run = (async () => {
    const fallback = { source: 'builtin', digest: notesDigest(UPDATE_NOTES), notes: UPDATE_NOTES };
    if (typeof doFetch !== 'function') return fallback;
    let body;
    try {
      const res = await doFetch(NOTES_URL, { cache: 'no-store', headers: { Accept: 'application/json' } });
      if (!res || !res.ok) return fallback;
      body = await res.json();
    } catch {
      return fallback;
    }
    // `{ notes: null }` = the server has no live copy: the built-in revision is the answer, not an error.
    const incoming = body?.notes;
    if (!incoming) return fallback;
    const r = normalizeNotes(incoming);
    if (!r.ok) return { ...fallback, error: r.error };
    const changed = installNotes(r.notes);
    return { source: changed ? 'server' : 'unchanged', digest: notesDigest(r.notes), notes: r.notes };
  })();
  if (!fetchFn) loaded = run;
  return run;
}

/** Test-only: forget the memoized load. */
export function resetUpdateNotesLoadForTests() { loaded = null; }
