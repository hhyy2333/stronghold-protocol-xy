// public/js/mods/autoFill.js — the decision "start downloading this room's missing packs NOW".
//
// Owner's decision 2026-10-18: 自动补齐模组，不自动准备. The reasons the automatic half is right:
//   * the player ALREADY consented to the room's set when joining (`MOD_CONSENT_REQUIRED` lists the packs) — making
//     them press one more button for the same consent was the step that got lost;
//   * the bytes are cached per pack (public/js/mods/store.js), so a second room with the same set downloads nothing;
//   * the old entry was a small button inside the room-mods strip — the owner's report 「补齐mod文件按钮不明显」.
//
// What "automatic" must NOT become — this module only says WHETHER to start; the caller still has to:
//   * show it (progress, size, a 取消 button) — never a silent download;
//   * remember a cancellation per digest (`dismissed`), so cancelling does not get undone by the next re-render;
//   * allow ONE automatic attempt per digest (`tried`) — a failed run waits for the manual 重试 instead of looping;
//   * never press 准备就绪 afterwards (owner: 不自动准备).

/** The digest an attempt is remembered by (the room's set identity); `null` when the plan has none. */
export function autoFillDigest(plan) {
  return plan && typeof plan.digest === 'string' && plan.digest ? plan.digest : null;
}

/**
 * Whether the room screen should start the fetch by itself.
 *
 * False when: there is no verdict yet, the client already holds the set, nothing is missing, the room names a pack this
 * server does not carry (nothing to download — that is a host-side problem), a run is already in flight, or this digest
 * was already attempted / cancelled.
 * @param {{ plan?: { ok?: boolean, needed?: boolean, missingFiles?: number, unknown?: string[], digest?: string }|null,
 *   busy?: boolean, tried?: string|null, dismissed?: string|null }} [o]
 * @returns {boolean}
 */
export function shouldAutoFill({ plan = null, busy = false, tried = null, dismissed = null } = {}) {
  if (busy || !plan) return false;
  if (plan.ok === true || plan.needed === false) return false;
  if (!(Number(plan.missingFiles) > 0)) return false;
  if (Array.isArray(plan.unknown) && plan.unknown.length > 0) return false;
  const key = autoFillDigest(plan);
  if (key && (key === tried || key === dismissed)) return false;
  return true;
}

/**
 * How long to wait after the check before starting, so that several clients entering the same room do not all open their
 * sockets on the same frame (the packs come from the game server, not a CDN). Kept short: the download is visible, so a
 * player who wants to cancel has the whole run to do it.
 */
export const AUTO_FILL_DELAY_MS = 150;
