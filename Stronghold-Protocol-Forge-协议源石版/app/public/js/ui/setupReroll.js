// Host-only opening reroll: the host redraws the whole opening for everybody, with no consent vote (业主 2026-10-30
// 「重刷开局改成联机房主重刷，不用投票」). The room, seats and player settings stay; everyone's Ready is reset.
import { useRef, useState } from '../../vendor/hooks.module.js';
import { html, Button, confirmDialog } from './components.js';
import { actions } from './gameActions.js';
import { useStore } from '../store.js';
import { t } from '../../../shared/i18n.js';

export function SetupReroll({ pub }) {
  const myId = useStore((s) => s.me.playerId);
  const hostId = useStore((s) => s.room?.hostId);
  const online = useStore((s) => s.connection.status === 'online');
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const host = myId === hostId;
  const players = pub.players || [];
  const me = players.find((p) => p.playerId === myId && p.status !== 'left');
  const send = async (fn) => {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    try { await fn(); } finally { pending.current = false; setBusy(false); }
  };
  if (!host || !me) return null;
  // One local confirmation, then the server redraws at once: no second player has to agree. The reroll cannot be undone,
  // and it interrupts everyone's briefing, so the host gets the same "are you sure" a kick or a sell gets.
  const reroll = () => send(async () => {
    const ok = await confirmDialog({
      title: t('重刷本局'),
      text: t('重新随机战场、领袖、特训敌人和禁用，并重置所有玩家的确认状态。确定重刷吗？'),
      okText: t('重刷'),
    });
    if (ok) await actions.rerollSetup(pub.setupRevision ?? 0);
  });
  return html`<section class="brief-reroll" aria-label=${t('重刷本局')} aria-live="polite">
    <div class="brief-reroll__text">
      <strong>${t('重刷本局')}</strong>
      <span>${t('保留房间和个人配置，重新随机全部开局信息。')}</span>
    </div>
    <div class="brief-reroll__actions">
      <${Button} icon="refresh" size="lg" loading=${busy} disabled=${!online}
        onClick=${reroll}>${t('重刷本局')}<//>
    </div>
  </section>`;
}
