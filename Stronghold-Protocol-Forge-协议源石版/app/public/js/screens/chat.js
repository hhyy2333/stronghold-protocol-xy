// public/js/screens/chat.js — 房内聊天（引擎特性；docs/META.md 的聊天那一节）。
//
// 两样东西：**打字聊天**与**快捷短语**。都是引擎自己的一等能力，不是包能力（包要用自己的消息走
// `client.panels[].messages` + `pack.msg`，docs/WORKSHOP.md §1.9.6）。
//
// 三条边界，与服务端逐字对应（`server/lobby.js` 的 `chat` / `quickMsg` / `sayInRoom`）：
//
//   * **限制在服务端**。客户端的输入框只是照着 `room.state.chatMode` 摆样子（`'open'` 打字+短语、`'quick'` 只
//     短语、`'off'` 都禁）；能不能说由服务端再判一次。这里不做「本地说不行就不发」，因为那会让客户端的
//     判断成为真源 —— 而这个仓库到处在消灭「第二份真相」。
//   * **旁观者也能说**（业主 2026-10-16「观战不能聊天」）。这是**移植时丢掉的一条行为**：正本 repo 的文件头写着
//     「a spectator watches and talks, like the official room's 观战」，本树把 `and room.chat` 删掉了。
//     聊天是引擎能力，与 `g.*` 的「不能操纵这一局」是两回事 —— 服务端因此对 `room.chat` / `room.quickMsg`
//     放行旁观席（`server/lobby.js speakerOf`），面板对旁观者不再藏输入框。观战者仍然不能买 / 刷 / 升 / 准备。
//   * **文本是数据，不是标记**。消息一律经 Preact 的文本节点渲染（`${text}`），从不 `innerHTML`：一条消息
//     不该有能力改页面结构。
//
// 历史：重连时服务端补发 `chat.history`（只给这一个会话，`server/lobby.js runResync`），面板把它并到最前面。
// 环形缓冲在服务端内存里，房间没了它也就没了 —— 聊天永不落盘。

import { useEffect, useRef, useState } from '../../vendor/hooks.module.js';
import { html, Panel, Icon } from '../ui/components.js';
import { net } from '../net.js';
import { useStore, shallowEqual, isSpectating } from '../store.js';
import { t } from '../../../shared/i18n.js';

/**
 * 快捷短语：id（与服务端 `DEFAULT_QUICK_PHRASES` 一致）→ **msgid**。
 *
 * 这里存的是**中文 msgid**（`t()` 的键），不是已翻译的文案 —— 渲染时才 `t()`。把中文写死在这里当作显示文案会
 * 绕过 i18n（`tools/i18n.mjs` 会把它们报成「未包裹的中文字面量」，而且换语言也不会跟着变）。
 */
export const QUICK_PHRASES = Object.freeze([
  { id: 'niceOne', msgid: '打得漂亮' },        // i18n-ignore: msgid key, translated at render via t()
  { id: 'myBad', msgid: '我的失误' },          // i18n-ignore: msgid key
  { id: 'wellPlayed', msgid: '辛苦了' },       // i18n-ignore: msgid key
  { id: 'thanks', msgid: '收到，谢谢' },        // i18n-ignore: msgid key
  { id: 'wait', msgid: '稳住，别急' },         // i18n-ignore: msgid key
  { id: 'ready', msgid: '我准备好了' },        // i18n-ignore: msgid key
  { id: 'help', msgid: '请求支援' },           // i18n-ignore: msgid key
  { id: 'focus', msgid: '集中火力' },          // i18n-ignore: msgid key
  { id: 'goodLuck', msgid: '祝好运' },         // i18n-ignore: msgid key
]);

/** 一条消息在界面上的样子：`chat.msg` 直接来自服务端，不做二次加工（短语的文案在这里才翻译）。 */
const line = (m) => ({
  from: m.from,
  name: m.name,
  seat: m.seat,
  // 观战者没有座位号（服务端发 `seat: -1, isSpectator: true`，与正本同一套标记）：渲染时标成「观战」。
  isSpectator: !!m.isSpectator || m.seat === -1,
  at: m.at,
  // 快捷短语优先（它是 id + 可选短参），否则就是一段文本
  text: Array.isArray(m.quick)
    ? m.quick.map((id) => {
      const q = QUICK_PHRASES.find((x) => x.id === id);
      // 不认识的 id 原样显示（服务端已经用白名单挡过了；这里只是别把它变成空白）
      return (q ? t(q.msgid) : id) + (m.arg ? ` ${m.arg}` : '');
    }).join(' · ')
    : String(m.text ?? ''),
});

/**
 * 房内聊天面板。挂在房间屏里；`room` 来自 store（`room.state` 的那一份）。
 *
 * `compact` = 局内那个形态（owner's call 2026-10-18 「常态开启可隐藏」）：标题只留「聊天」、不画房间用的 micro 说明、
 * 快捷短语收成一行（CSS 横向滚动），并给一个「收起」按钮——局内默认展开，玩家随时可以收起来（偏好会记住）。
 * `onClose` 只有局内会传（房间屏的聊天本来就是常驻的一块，没有收起的概念）；`onMessage` 让宿主在面板**收起**时亮红点，
 * 而不是再订阅一次 `chat.msg` —— 订阅仍只有本文件这一处（test/ui/chatPanelMount.test.js 钉着这条）。
 * @param {{ compact?: boolean, onClose?: (() => void)|null, onMessage?: ((m: any) => void)|null }} [props]
 */
export function ChatPanel({ compact = false, onClose = null, onMessage = null } = {}) {
  const room = useStore((s) => s.room, shallowEqual);
  const me = useStore((s) => s.me, shallowEqual);
  const [lines, setLines] = useState([]);
  const [draft, setDraft] = useState('');
  const alive = useRef(true);
  const listRef = useRef(null);
  // the host's "a line arrived" hook, read through a ref so a re-render never re-subscribes
  const onMessageRef = useRef(onMessage);
  onMessageRef.current = onMessage;

  useEffect(() => () => { alive.current = false; }, []);

  useEffect(() => {
    const offMsg = net.on('chat.msg', (m) => {
      if (!alive.current || !m) return;
      setLines((prev) => [...prev, line(m)].slice(-200));
      try { onMessageRef.current?.(m); } catch { /* a host hook must not break the panel */ }
    });
    // 重连补发：`chat.history` 只发给这一个会话，整体替换（服务端那份才是真源，不是「追加」）
    const offHist = net.on('chat.history', (m) => {
      if (!alive.current || !m || !Array.isArray(m.messages)) return;
      setLines(m.messages.map(line).slice(-200));
    });
    // 离开房间就把记录清掉：换一个房间不该看见上一个房间说的话
    const offState = net.on('room.state', (m) => {
      if (!alive.current) return;
      if (!m || !m.code) setLines([]);
    });
    return () => { offMsg(); offHist(); offState(); };
  }, []);

  // 新消息到达时滚到底（列表本身就是滚动容器）
  useEffect(() => {
    const el = listRef.current;
    if (el && typeof el.scrollTop === 'number') el.scrollTop = el.scrollHeight;
  }, [lines.length]);

  if (!room) return null;
  // `isSpectating(room, playerId)` 是**两个**参数；只传一个时 `playerId != null` 直接不成立、恒为 false
  // （此前这里写的是 `isSpectating(store.get())`，靠后半截兜着 —— 功能没坏，但前一半是死代码）。
  const spectating = isSpectating(room, me.playerId);
  const mode = room.chatMode || 'open';
  // 观战者也能说话（业主 2026-10-16）：这里只留「房间的 chatMode」这一道，服务端照旧再判一次。
  const canType = mode === 'open';
  const canQuick = mode !== 'off';

  const send = () => {
    const text = draft.trim();
    if (!text) return;
    // 乐观清空输入框：失败时服务端会回一条错误（面板不去猜），比卡住一个字更不容易让人连点
    setDraft('');
    net.request('room.chat', { text }).catch(() => {});
  };
  const quick = (id) => { net.request('room.quickMsg', { ids: id }).catch(() => {}); };

  return html`
    <${Panel} title=${compact ? t('聊天') : t('房内聊天')} class=${compact ? 'chatp chatp--compact' : 'chatp'}
      actions=${onClose ? html`<button type="button" class="chatp__close" onClick=${onClose} aria-label=${t('收起聊天')} title=${t('收起聊天')}><${Icon} name="close" /></button>` : null}
      micro=${compact ? undefined : t(mode === 'open' ? '允许打字与快捷短语' : mode === 'quick' ? '只允许快捷短语' : '关闭聊天')}>
      <div class="chatp__list" ref=${listRef}>
        ${lines.length === 0
          ? html`<div class="chatp__empty">${t('说点什么…')}</div>`
          : lines.map((m, i) => html`
            <div class="chatp__row" key=${`${m.from}:${m.at}:${i}`}>
              <span class="chatp__name">${m.name || t('博士')}${m.isSpectator ? html`<i class="chatp__spec">${t('观战')}</i>` : null}</span>
              <span class="chatp__text">${m.text}</span>
            </div>`)}
      </div>
      ${canQuick ? html`
        <div class="chatp__quick">
          ${QUICK_PHRASES.map((q) => html`
            <button type="button" class="chatp__q" key=${q.id} onClick=${() => quick(q.id)}>${t(q.msgid)}</button>`)}
        </div>` : null}
      ${canType
        ? html`
            <div class="chatp__send">
              <input class="chatp__input" value=${draft} maxlength="120" placeholder=${t('说点什么…')}
                onInput=${(e) => setDraft(e.currentTarget.value)}
                onKeyDown=${(e) => { if (e.key === 'Enter') send(); }} />
              <button type="button" class="chatp__go" disabled=${!draft.trim()} onClick=${send}>${t('发送')}</button>
            </div>`
        : html`<div class="chatp__note">${t('该房间已关闭打字聊天')}</div>`}
    <//>`;
}
