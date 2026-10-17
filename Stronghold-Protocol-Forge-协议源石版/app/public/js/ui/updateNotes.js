// public/js/ui/updateNotes.js — the 更新公告 panel: what changed, shown once per revision.
//
// THE RULE LIVES ELSEWHERE. Whether the panel may pop, and what "already seen" means, is ui/updateNotesModel.js — a
// pure module with no Preact in it, tested on its own. This file is the surface: it reads that decision, renders the
// announcement and routes EVERY close path through `closeUpdateNotes()`, which records the revision's digest before
// the panel is gone. There is deliberately no second way to close it: a path that forgot to record would be the
// "closes it, reloads, it is back" bug the owner called out.
//
// THE ANNOUNCEMENT IS FREE TEXT (owner's decision 2026-10-13: no fixed format, no multi-language). This file therefore
// has no sections, no headline and no language picker — it lays out whatever the operator typed, and only two things
// carry meaning (see `notesBlocks`):
//   * a BLANK LINE separates paragraphs;
//   * a line starting with `- `, `* ` or `• ` is a bullet.
// Everything else — including line breaks inside a paragraph — is shown exactly as written. That is the whole point of
// free text: the operator's layout must survive to the player's screen.
//
// MOUNTED ONCE, ABOVE THE ROUTER. main.js renders <UpdateNotesHost/> inside <App/> next to the announcement banner, so
// the panel covers the title screen, the lobby, a room and a match alike, and a route change cannot drop it. Its open
// state is module-level (the model), so remounting the host does not re-open or re-close anything.
//
// THE MANUAL ENTRY. Auto-pop is the feature; re-reading is courtesy. `UpdateNotesButton` (the title screen and the
// lobby) opens the same panel on demand and marks nothing seen — the digest was already recorded the first time.

import { useEffect, useState } from '../../vendor/hooks.module.js';
import { html, Modal, Button, Icon } from './components.js';
import { t } from '../../../shared/i18n.js';
import { notesBlocks } from '../../../shared/updateNotes.js';
import {
  closeUpdateNotes, isUpdateNotesOpen, onUpdateNotesChange, openUpdateNotes, getActiveNotes,
} from './updateNotesModel.js';

// The block rule (blank line = paragraph, leading `- ` = bullet) lives in shared/updateNotes.js, because the admin
// editor's live preview must lay the text out exactly like this panel does. Re-exported so the tests can reach it here.
export { notesBlocks };

/** Reactive view of the model's open flag. */
function useNotesOpen() {
  const [isOpen, setOpen] = useState(() => isUpdateNotesOpen());
  useEffect(() => {
    // A state that changed before this component mounted (the boot-time pop in main.js) is applied on mount.
    setOpen(isUpdateNotesOpen());
    return onUpdateNotesChange(() => setOpen(isUpdateNotesOpen()));
  }, []);
  return isOpen;
}

/** Reactive view of the ACTIVE revision: the server's copy once it arrives, the built-in one until then. */
function useActiveNotes() {
  const [notes, setNotes] = useState(() => getActiveNotes());
  useEffect(() => onUpdateNotesChange(() => setNotes(getActiveNotes())), []);
  return notes;
}

/** The announcement body: paragraphs and bullet lists, exactly as `notesBlocks` split them. */
function NotesBody({ text }) {
  return html`<div class="unotes__body">
    ${notesBlocks(text).map((b, i) => (b.kind === 'ul'
      ? html`<ul class="unotes__list" key=${i}>
          ${b.items.map((item, j) => html`<li class="unotes__item" key=${j}>
            <span class="unotes__bullet" aria-hidden="true"></span>
            <span class="unotes__text">${item}</span>
          </li>`)}
        </ul>`
      : html`<p class="unotes__p" key=${i}>${b.text}</p>`))}
  </div>`;
}

/**
 * The update-notes panel. Mounted once by main.js; renders nothing while closed.
 *
 * Closing (the 知道了 button, Escape, a backdrop click) goes through `closeUpdateNotes()` — the single place that
 * records the revision's digest. `onClose` is what Modal calls for Escape and the backdrop, so both are covered by
 * the same call; there is no path that hides the panel without recording it.
 *
 * The auto-pop happens at boot (main.js `maybeOpenUpdateNotes()`), BEFORE the first paint: the panel is up when the
 * page appears instead of sliding in a moment later. main.js loads the live revision BEFORE that, so what pops is
 * already the server's copy, and the digest the close records belongs to what the player actually read.
 */
export function UpdateNotesHost() {
  const isOpen = useNotesOpen();
  const notes = useActiveNotes();
  if (!isOpen) return null;

  return html`<${Modal}
      open=${true}
      tone="mint"
      class="unotes"
      width="min(9.4rem, 94vw)"
      micro="UPDATE NOTES"
      title=${t('更新公告')}
      onClose=${closeUpdateNotes}
      closeOnBackdrop=${true}
      actions=${html`
        <${Button} variant="ghost" size="md" icon="close" class="unotes__close" onClick=${closeUpdateNotes}>
          ${t('知道了')}<//>`}>
    <${NotesBody} text=${notes.text} />
    <p class="unotes__foot">
      <${Icon} name="info" class="unotes__footicon" />
      <span>${t('关闭后不会再弹出；等下次有新的更新内容时才会再显示一次。')}</span>
    </p>
  <//>`;
}

/**
 * The manual entry (title screen + lobby): opens the same panel without changing what has been seen. Present on
 * every screen that has a tool corner, so a player who closed the pop can always read it again.
 * @param {{ class?: string, size?: 'sm'|'md' }} props
 */
export function UpdateNotesButton({ class: cls, size = 'sm' }) {
  return html`<${Button} variant="ghost" size=${size} icon="info" class=${cls}
      onClick=${openUpdateNotes}
      title=${t('查看更新公告')} aria-label=${t('查看更新公告')}>${t('更新公告')}<//>`;
}

/** Test-only: the notes the panel is showing, for the single-pop assertions. */
export function updateNotesForTests() {
  return { open: isUpdateNotesOpen(), notes: getActiveNotes() };
}
