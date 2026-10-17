// public/admin/admin.js — the read-only operational panel.
//
// i18n CHOICE (deliberate — see the task note): the panel keeps its own strings in the local `STRINGS` table below
// instead of importing shared/i18n.js and wrapping them in t().
//
//   1. public/admin/ is outside the i18n pipeline on purpose: test/i18n.test.js scans public/js, shared and server, and
//      tools/i18n.mjs builds public/i18n/en.json from the msgids it finds there. Strings introduced here would never be
//      extracted, so a t('…') call would silently fall back to Chinese for an English operator — a half-translated panel
//      with no test to catch it. A local table is the honest shape for a two-language, operator-only page.
//   2. The panel is an operator tool, not player UI: it must stay readable even when the game's language packs are
//      missing or a pack is broken, and the server serves it from the plain public/ mount with no boot sequence.
//   3. It stays a plain static file: no import map, no preact, no /shared/ or /js/ module — the panel loads even if the
//      client bundle is mid-deploy (the very moment an operator opens it).
//
// Everything else here follows the game client's spirit: native ES module, no framework, no dependency.
//
// NOT read-only any more: the operator writes are 全体公告 (pick up / put down a banner), 更新公告 (edit the live
// revision), 封禁 IP (refuse a source, dropping the sockets it holds) and 删除一条玩家反馈 (prune one report). Each is
// drawn as narrowly as its feature allows and none of them can touch a room, a match or a seat — see the SECURITY note
// in server/admin.js, which is the authority on what this surface may do. There is still no drain, no shutdown and no
// broadcast into a running match.
//
// It also shows things that are NOT in a JSON view on this process: the 蓝绿 other slot (server/peer.js, DEPLOY.md
// §8.4) is probed server-side over loopback, because a browser reaching :80 can only ever see the active slot.

const TOKEN_KEY = 'sp.admin.token';
const LANG_KEY = 'sp.admin.lang';
const POLL_MS = 2000;

/** One place for every string this page shows (see the i18n note above). */
const STRINGS = {
  zh: {
    subtitle: '只读运行监控面板',
    connecting: '连接中…',
    live: '运行中',
    unauthorized: '令牌无效或已被锁定',
    offline: '接口不可用',
    logout: '退出',
    loginTitle: '管理员令牌',
    loginHint: '输入服务器环境变量 ADMIN_SECRET 的值。令牌只保存在本标签页的 sessionStorage 中，不会写入 Cookie。',
    tokenLabel: '访问令牌',
    invalidToken: '令牌无效，请重试。',
    signIn: '进入面板',
    statSockets: '在线连接 / 会话',
    statRooms: '房间 / 进行中对局',
    statCpu: 'CPU 占用',
    statMemory: '进程内存 (RSS)',
    clients: '人类 {humans} · 电脑 {bots} · 观战 {spectators}',
    uptime: '运行 {uptime}',
    load: '负载 {load} · {cores} 核心',
    heap: '堆已用 {used} / {total} MB · 系统空闲 {free} MB',
    roomsTitle: '活跃房间',
    logsTitle: '服务端日志',
    colCode: '房间号',
    colHost: '房主',
    colMode: '模式 / 难度',
    colSeats: '座次',
    colSpectators: '观战',
    colPerf: '性能消耗',
    perfIdle: '未开打',
    perfWarm: '测量中…',
    perfShare: '{p}% 单核',
    perfTotal: '累计 {ms}',
    perfTip: '本房间的对局引擎在过去 {w} 秒里占用单核的百分比。\n\n本窗口：{window}\n合计 {ms}（这 {w} 秒内引擎实际花了多少毫秒）\n\n全程累计：{lifetime}\n累计 {total}，{frames} 次回调。{uptime}\n\n「本窗口」是速率（扩容看它，第一次刷新只显示累计值，第二次起才有速率）；「全程累计」是这局从开打到现在各处的总开销——脉冲式的桶（AI演练、托管）常常本窗口是 0 却在累计里占大头。',
    perfBucket: '{name} {p}%',
    perfUptime: '对局已跑约 {minutes} 分钟。',
    bucketBattle: '战场',
    bucketBots: 'AI演练',
    bucketVerify: '校验',
    bucketServerRun: '托管',
    bucketIntents: '操作',
    bucketViews: '视图',
    bucketCore: '流程',
    colMatch: '对局',
    noRooms: '暂无活动房间',
    noLogs: '暂无日志',
    inMatch: '对局中',
    lobby: '备战中',
    paused: '已暂停',
    bot: '电脑',
    seatFree: '空位',
    disconnected: '掉线',
    buildLabel: '构建',
    nodeLabel: 'Node',
    pollLabel: '每 2 秒刷新（只读）',
    modeSolo: '单人',
    modeCoop: '合作',
    announceTitle: '全体公告',
    announceHint: '发布后立即出现在所有在线玩家的页面顶部（大厅与对局中都能收到），滚动显示。会保存下来：之后才连上的人、以及服务器重启后，都还能看到这条公告，直到你发布下一条或点「撤回公告」。',
    announcePlaceholder: '在这里写公告…（最多 200 字）',
    announceSend: '发布公告',
    announceWithdraw: '撤回公告',
    announceSending: '发布中…',
    announceWithdrawing: '撤回中…',
    announceEmpty: '公告内容不能为空。',
    announceSent: '已发布，送达 {n} 个在线会话。',
    announceWithdrawn: '已撤回，送达 {n} 个在线会话。',
    announceFailed: '发布失败：{why}',
    announceWithdrawFailed: '撤回失败：{why}',
    announceTooFast: '发布太快，请等 {s} 秒再试。',
    announceHistory: '本次会话已发布',
    announceNone: '还没有发布过公告。',
    announceReach: '{n} 人收到',
    announceChars: '{n}/200',
    notesTitle: '更新公告',
    notesHint: '玩家首次打开页面时弹出一次的那块面板。直接写文字、点保存即可——不用填格式，也没有多语言：你写什么语言，玩家就看什么语言。只有两条排版规则：空行分段，行首写「- 」分条；其它一律原样显示（行内换行也保留）。保存的是服务端上的活版本，不改动代码树；点「恢复内置」即回到随包发布的那一版。内容一改指纹就变，玩家下次进来会再看到一次。',
    notesLive: '服务端版本',
    notesBuiltinOnlyShort: '内置（未保存过）',
    notesNone: '读不到公告内容（文件缺失或格式不对）',
    notesDigest: '指纹 {d}',
    notesPlaceholder: '随便写。比如：\n\n本次更新\n- 修了 XXX\n- 加了 YYY\n\n第二段直接空一行写。',
    notesSave: '保存公告',
    notesReset: '撤销编辑',
    notesClear: '恢复内置',
    notesPreview: '当前生效的公告（就是玩家看到的样子）',
    notesSaving: '保存中…',
    notesSaved: '已保存（指纹 {d}）。玩家下次打开页面会看到。',
    notesSavedUnwritable: '已生效，但磁盘写入失败——重启后会回到上一版。',
    notesSaveFailed: '保存失败：{why}',
    notesCleared: '已恢复内置公告，玩家下次打开页面会看到随包的那一版。',
    notesClearFailed: '恢复失败：{why}',
    notesClearConfirm: '确定要清掉服务端上的更新公告、回到随包发布的那一版吗？',
    notesBuiltinOnly: '服务端还没有保存过公告，下面显示的是随包发布的内置版本。',
    notesEmpty: '当前没有生效的公告。',
    feedbackTitle: '玩家反馈',
    feedbackNote: '玩家在「设置 → 问题反馈」里发送的内容。玩家名已被替换成 <me> / <player2>，房间号保留。点开可看诊断信息。',
    feedbackDiag: '诊断信息',
    noFeedback: '还没有收到反馈',
    feedbackDelete: '删除这条',
    feedbackDeleteConfirm: '永久删除这条反馈？文件里那一行会被移除，删掉就找不回来了。',
    feedbackDeleting: '删除中…',
    feedbackDeleted: '已删除。',
    feedbackDeleteFailed: '删除失败：{why}',
    slotsTitle: '服务器槽位（蓝绿）',
    slotsHint: '线上是两个进程（槽 A :3000 / 槽 B :3001），nginx 只把 :80 指向其中一个——所以你正在看的这个面板只属于活跃槽。这一节由服务端从回环去问另一个槽，用来看它是否还在跑、上面还有没有人。',
    slotsSelf: '本槽（活跃）',
    slotsPeer: '另一个槽',
    slotsNoPeer: '没有配置另一个槽（单个进程运行）。设置 SP_SLOT=a|b 或按 3000/3001 端口即自动识别。',
    slotsUnreachable: '连不上（可能已停）',
    slotsReachable: '可连通',
    slotsVia: '来源 {via}',
    slotsPort: '端口 {p}',
    slotsBuild: '构建 {b}',
    slotsUptime: '运行 {u}',
    slotsPlayers: '真人 {humans} · 电脑 {bots} · 观战 {spec}',
    slotsRooms: '房间 {rooms} · 对局 {matches} · 连接 {sockets} · 会话 {sessions}',
    slotsRss: '内存 {mb} MB',
    slotsHostname: '主机 {h}',
    slotsMayStop: '上面已经没有真人和对局了，可以停掉。',
    slotsDraining: '还有 {humans} 名真人 / {matches} 局在进行——先别停，等它排空。',
    slotsUnknown: '状态未知。',
    bansTitle: '封禁 IP',
    limitsTitle: '服务器人数上限',
    limitsHint: '允许多少个连接同时开着（含还没进大厅的）。数字落在服务器上、两个槽共用，重启与热更新都不会丢；改完本槽立即生效，另一个槽 3 秒内跟上。调低**只会挡住新人，不会踢掉任何已经在玩的人**。',
    limitsPlaceholder: '上限（留空则跟随启动参数）',
    limitsSave: '保存',
    limitsClear: '跟随启动参数',
    limitsInUse: '当前 {sockets} / 上限 {cap}',
    limitsFromPanel: '面板设置于 {when}（来自 {by}）',
    limitsFromBoot: '本机启动时自带的值（面板没有设过）',
    limitsFromBootCleared: '面板已清除设置，正跟随本机启动参数',
    limitsOver: '注意：当前人数已超过上限，新人进不来，但已在玩的人不受影响',
    limitsSaving: '正在保存…',
    limitsSaved: '上限已设为 {n}（本槽已生效，另一个槽 3 秒内跟上）',
    limitsSavedNoDisk: '上限已设为 {n}，但**没有写进磁盘**——重启或另一个槽不会知道它。',
    limitsCleared: '已清除面板设置，跟随本机启动参数。',
    limitsFailed: '保存失败：{why}',
    limitsBadValue: '请填一个不小于 1 的整数（0 会让谁都进不来，所以不允许）。',
    limitsConfirmClear: '清除面板设置，改为跟随本机启动参数？',
    // 人机上限（业主 2026-10-16）：全服一个、每房间一个。0 = 不限制。
    botsPlaceholder: '全服人机上限（留空 = 不动，0 = 不限制）',
    botsRoomPlaceholder: '每房间人机上限（留空 = 不动，0 = 不限制）',
    botsSave: '保存人机上限',
    botsBadValue: '请填一个不小于 0 的整数（0 = 不限制），或留空表示这一格不动。',
    botsSaved: '人机上限已设为 全服 {n}（本槽已生效，另一个槽 3 秒内跟上）',
    bansHint: '只手动，不自动（同一个 NAT 出口后面可能坐着整片玩家）。被ban 的地址会在所有 HTTP 路径与 /ws 升级时被拒，已经连上的会立刻断开；名单落在服务器上、两个槽共用，重启与热更新都不会丢。',
    banRulePlaceholder: 'IP 或 CIDR，如 203.0.113.7 或 203.0.113.0/24',
    banReasonPlaceholder: '理由（可选）',
    banMinutesPlaceholder: '分钟（留空＝永久）',
    banAdd: '封禁',
    banAdding: '封禁中…',
    banAdded: '已封禁 {rule}，断开 {n} 个连接。',
    banExists: '已更新 {rule}（这条本来就在名单里）。',
    banAddFailed: '封禁失败：{why}',
    banRemove: '解封',
    banRemoving: '解封中…',
    banRemoved: '已解封 {rule}。',
    banRemoveFailed: '解封失败：{why}',
    bansNone: '名单是空的。',
    banPermanent: '永久',
    banUntil: '至 {when}',
    banBy: '由 {by}',
    banEvicted: '断开 {n}',
    banEmptyRule: '请填写 IP 或 CIDR。',
    bansDisabled: '服务器没有配置封禁存储。',
    banConfirmRemove: '解封 {rule}？',
    addrHint: '{addr}（点一下填入封禁框）',
    banPrefilled: '已填入 {addr}——确认后点「封禁」。',
  },
  en: {
    subtitle: 'read-only operations monitor',
    connecting: 'connecting…',
    live: 'running',
    unauthorized: 'invalid or locked-out token',
    offline: 'API unavailable',
    logout: 'Sign out',
    loginTitle: 'Admin token',
    loginHint: 'Enter the value of the server\'s ADMIN_SECRET environment variable. The token is kept in this tab\'s sessionStorage only — never in a cookie.',
    tokenLabel: 'Access token',
    invalidToken: 'Invalid token, try again.',
    signIn: 'Open panel',
    statSockets: 'Sockets / sessions',
    statRooms: 'Rooms / matches',
    statCpu: 'CPU usage',
    statMemory: 'Process memory (RSS)',
    clients: 'humans {humans} · bots {bots} · spectators {spectators}',
    uptime: 'up {uptime}',
    load: 'load {load} · {cores} cores',
    heap: 'heap {used} / {total} MB · system free {free} MB',
    roomsTitle: 'Active rooms',
    logsTitle: 'Server log',
    colCode: 'Code',
    colHost: 'Host',
    colMode: 'Mode / difficulty',
    colSeats: 'Seats',
    colSpectators: 'Spectators',
    colPerf: 'CPU cost',
    perfIdle: 'idle',
    perfWarm: 'measuring…',
    perfShare: '{p}% core',
    perfTotal: '{ms} total',
    perfTip: 'Share of one core the match engine spent on this room over the last {w}s.\n\nThis window: {window}\n{ms} ms in it (what the engine actually spent during those {w}s)\n\nSince the match started: {lifetime}\n{total} ms total, {frames} callbacks. {uptime}\n\n"This window" is a RATE (what to watch when scaling; the first refresh shows totals only, a rate needs a second one). "Since the match started" is where a whole match\'s time went — a pulse bucket (AI rehearsal, takeover) is often 0 in the window while dominating the lifetime.',
    perfBucket: '{name} {p}%',
    perfUptime: 'match up ~{minutes} min.',
    bucketBattle: 'battle',
    bucketBots: 'AI rehearsal',
    bucketVerify: 'verify',
    bucketServerRun: 'takeover',
    bucketIntents: 'intents',
    bucketViews: 'views',
    bucketCore: 'flow',
    colMatch: 'Match',
    noRooms: 'No active rooms',
    noLogs: 'No log entries yet',
    inMatch: 'in match',
    lobby: 'in lobby',
    paused: 'paused',
    bot: 'bot',
    seatFree: 'empty',
    disconnected: 'offline',
    buildLabel: 'build',
    nodeLabel: 'Node',
    pollLabel: 'refreshes every 2 s (read-only)',
    modeSolo: 'solo',
    modeCoop: 'co-op',
    announceTitle: 'Server announcement',
    announceHint: 'Appears at once at the top of every online player\'s page (the lobby and a running match alike), scrolling. It is SAVED: a player who connects later — and the server itself after a restart — still sees it, until you publish another or press Withdraw.',
    announcePlaceholder: 'Write the announcement… (200 characters max)',
    announceSend: 'Publish',
    announceWithdraw: 'Withdraw',
    announceSending: 'Publishing…',
    announceWithdrawing: 'Withdrawing…',
    announceEmpty: 'The announcement text is empty.',
    announceSent: 'Published — delivered to {n} online session(s).',
    announceWithdrawn: 'Withdrawn — delivered to {n} online session(s).',
    announceFailed: 'Publish failed: {why}',
    announceWithdrawFailed: 'Withdraw failed: {why}',
    announceTooFast: 'Too fast — wait {s}s and try again.',
    announceHistory: 'Published in this session',
    announceNone: 'Nothing published yet.',
    announceReach: '{n} received',
    announceChars: '{n}/200',
    notesTitle: 'Update notes',
    notesHint: 'The panel a player sees once on their first visit. Just type the text and save — no format to fill in and no translations: players read whatever language you write in. Only two layout rules: a blank line starts a paragraph, a line beginning with "- " becomes a bullet; everything else is shown exactly as typed, line breaks included. It saves the LIVE server copy, not the code tree; 「恢复内置」 puts the shipped revision back. Any content change moves the digest, so the panel pops once more.',
    notesLive: 'live server copy',
    notesBuiltinOnlyShort: 'built-in (never saved)',
    notesNone: 'The notes could not be read (missing or malformed)',
    notesDigest: 'digest {d}',
    notesPlaceholder: 'Write freely. For example:\n\nThis update\n- fixed XXX\n- added YYY\n\nStart a new paragraph with a blank line.',
    notesSave: 'Save notes',
    notesReset: 'Revert edits',
    notesClear: 'Use built-in',
    notesPreview: 'Currently in effect (exactly what players see)',
    notesSaving: 'Saving…',
    notesSaved: 'Saved (digest {d}). Players see it on their next visit.',
    notesSavedUnwritable: 'Live now, but the disk write failed — a restart reverts it.',
    notesSaveFailed: 'Save failed: {why}',
    notesCleared: 'Back to the built-in notes; players see the shipped revision on their next visit.',
    notesClearFailed: 'Could not revert: {why}',
    notesClearConfirm: 'Drop the live update notes and go back to the shipped revision?',
    notesBuiltinOnly: 'No saved revision on this server yet — the shipped one is shown below.',
    notesEmpty: 'No revision is in effect.',
    feedbackTitle: 'Player feedback',
    feedbackNote: 'Sent from 设置 → 问题反馈. Player names are replaced with <me> / <player2>; the room code is kept. Open an entry for its diagnostics.',
    feedbackDiag: 'Diagnostics',
    noFeedback: 'No feedback yet',
    feedbackDelete: 'Delete',
    feedbackDeleteConfirm: 'Delete this report for good? Its line is removed from the file and cannot be recovered.',
    feedbackDeleting: 'Deleting…',
    feedbackDeleted: 'Deleted.',
    feedbackDeleteFailed: 'Delete failed: {why}',
    slotsTitle: 'Server slots (blue-green)',
    slotsHint: 'The live deployment is two processes (slot A :3000 / slot B :3001) and nginx points :80 at exactly one — so the panel you are reading belongs to the active slot only. This section asks the other one over loopback, to show whether it is still running and whether anyone is still on it.',
    slotsSelf: 'This slot (active)',
    slotsPeer: 'Other slot',
    slotsNoPeer: 'No other slot configured (single process). Set SP_SLOT=a|b, or use port 3000/3001 and it is detected automatically.',
    slotsUnreachable: 'unreachable (probably stopped)',
    slotsReachable: 'reachable',
    slotsVia: 'via {via}',
    slotsPort: 'port {p}',
    slotsBuild: 'build {b}',
    slotsUptime: 'up {u}',
    slotsPlayers: 'humans {humans} · bots {bots} · spectators {spec}',
    slotsRooms: 'rooms {rooms} · matches {matches} · sockets {sockets} · sessions {sessions}',
    slotsRss: 'memory {mb} MB',
    slotsHostname: 'host {h}',
    slotsMayStop: 'No humans and no match left on it — it is safe to stop.',
    slotsDraining: 'Still {humans} human(s) / {matches} match(es) on it — do not stop it, let it drain first.',
    slotsUnknown: 'State unknown.',
    bansTitle: 'Banned IPs',
    limitsTitle: 'Server player limit',
    limitsHint: 'How many connections may be open at once (including sockets that have not reached the lobby yet). The number lives on the server and both slots share it, so it survives restarts and blue-green updates; a change applies to this slot at once and to the other within 3 s. Lowering it **only refuses new people — nobody already playing is disconnected**.',
    limitsPlaceholder: 'Limit (empty = follow the boot option)',
    limitsSave: 'Save',
    limitsClear: 'Follow boot option',
    limitsInUse: '{sockets} in use / limit {cap}',
    limitsFromPanel: 'set from the panel at {when} (by {by})',
    limitsFromBoot: 'the value this machine started with (the panel has never set one)',
    limitsFromBootCleared: 'the panel value was cleared; following this machine\'s boot option',
    limitsOver: 'note: more connections are open than the limit — new ones are refused, existing players are unaffected',
    limitsSaving: 'Saving…',
    limitsSaved: 'Limit set to {n} (live on this slot; the other follows within 3 s)',
    limitsSavedNoDisk: 'Limit set to {n}, but it was **not written to disk** — a restart or the other slot will not know it.',
    limitsCleared: 'Panel value cleared; following this machine\'s boot option.',
    limitsFailed: 'Save failed: {why}',
    limitsBadValue: 'Enter a whole number of at least 1 (0 would refuse everybody, so it is not allowed).',
    limitsConfirmClear: 'Clear the panel value and follow this machine\'s boot option?',
    botsPlaceholder: 'Server AI cap (empty = leave it, 0 = unlimited)',
    botsRoomPlaceholder: 'Per-room AI cap (empty = leave it, 0 = unlimited)',
    botsSave: 'Save AI caps',
    botsBadValue: 'Enter an integer of 0 or more (0 = unlimited), or leave a field empty to keep it unchanged.',
    botsSaved: 'AI caps set to server {n} (this slot applies at once; the other follows within 3 s)',
    bansHint: 'Manual only, never automatic (a shared NAT egress can carry a whole crowd). A banned address is refused on every HTTP path and at the /ws upgrade, and its live sockets are closed at once. The list lives on the server, is shared by both slots, and survives restarts and blue-green deploys.',
    banRulePlaceholder: 'IP or CIDR, e.g. 203.0.113.7 or 203.0.113.0/24',
    banReasonPlaceholder: 'reason (optional)',
    banMinutesPlaceholder: 'minutes (blank = permanent)',
    banAdd: 'Ban',
    banAdding: 'Banning…',
    banAdded: 'Banned {rule} — {n} connection(s) dropped.',
    banExists: 'Updated {rule} (it was already on the list).',
    banAddFailed: 'Ban failed: {why}',
    banRemove: 'Unban',
    banRemoving: 'Lifting…',
    banRemoved: 'Lifted the ban on {rule}.',
    banRemoveFailed: 'Unban failed: {why}',
    bansNone: 'The list is empty.',
    banPermanent: 'permanent',
    banUntil: 'until {when}',
    banBy: 'by {by}',
    banEvicted: 'dropped {n}',
    banEmptyRule: 'Enter an IP or CIDR.',
    bansDisabled: 'No ban store is configured on this server.',
    banConfirmRemove: 'Lift the ban on {rule}?',
    addrHint: '{addr} — click to put it in the ban field',
    banPrefilled: '{addr} is in the ban field — press Ban to confirm.',
  },
};

const $ = (id) => document.getElementById(id);
const element = (tag, className, text) => {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text != null) el.textContent = text;
  return el;
};

/** `{name}` placeholders of one string. */
const fmt = (text, params) => String(text).replace(/\{(\w+)\}/g, (m, k) => (k in params ? String(params[k]) : m));

/** Seconds → "1h 02m 03s" (or "02m 03s" under an hour). */
function duration(sec) {
  const s = Math.max(0, Math.round(Number(sec) || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return h ? `${h}h ${pad(m)}m ${pad(r)}s` : `${pad(m)}m ${pad(r)}s`;
}

/**
 * Milliseconds → a short human figure for the 性能消耗 breakdown: "512ms", "1.8s", "27.5s", "2m 30s".
 *
 * WHY a second formatter (duration() above does whole seconds): the bucket totals are wall-clock milliseconds summed
 * over a whole match, and the interesting ones straddle the second boundary. Rounding 27 527 ms to a bare "28s" hides
 * whether a bucket is 20 s or 28 s of the total — and comparing two rooms' buckets is exactly what an operator does
 * with this number. So one decimal is kept for every second-scale figure (not only under ten), and dropped only when
 * it would be noise: sub-second reads in ms, a whole number of minutes drops the seconds.
 */
function shortMs(ms) {
  const v = Math.max(0, Number(ms) || 0);
  if (v < 1000) return `${Math.round(v)}ms`;
  const sec = v / 1000;
  if (sec < 60) return `${Math.round(sec * 10) / 10}s`;
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return s ? `${m}m ${s}s` : `${m}m`;
}

const store = {
  get(key) { try { return sessionStorage.getItem(key); } catch { return null; } },
  set(key, value) { try { sessionStorage.setItem(key, value); } catch { /* private mode: this page only */ } },
  remove(key) { try { sessionStorage.removeItem(key); } catch { /* ignore */ } },
};

let lang = store.get(LANG_KEY) === 'en' ? 'en' : 'zh';
let token = store.get(TOKEN_KEY) || '';
let pollTimer = null;
let logCursor = 0;
/** @type {object|null} the last overview, so a render can reuse its version fields */
let lastOverview = null;
/** The last /api/admin/limits document (server/limits.js), kept so the labels can be re-rendered on a language switch. */
let lastLimits = null;

const t = (key, params = {}) => fmt(STRINGS[lang][key] ?? STRINGS.zh[key] ?? key, params);

/** Apply the language to every static label of the page. */
function applyLang() {
  document.documentElement.lang = lang === 'en' ? 'en' : 'zh-CN';
  for (const el of document.querySelectorAll('[data-t]')) el.textContent = t(el.dataset.t);
  for (const el of document.querySelectorAll('[data-t-placeholder]')) el.placeholder = t(el.dataset.tPlaceholder);
  $('btn-lang').textContent = lang === 'en' ? '中文' : 'EN';
  $('token').placeholder = lang === 'en' ? 'ADMIN_SECRET…' : 'ADMIN_SECRET…';
}

function setState(text, kind) {
  const el = $('badge-state');
  el.textContent = text;
  el.className = `badge badge--${kind}`;
}

function showLogin(show) {
  $('login').hidden = !show;
  $('dashboard').hidden = show;
  $('btn-logout').hidden = show;
  if (show && pollTimer) { clearInterval(pollTimer); pollTimer = null; }
}

/** A GET against the read-only API. Returns { status, body }. */
async function apiGet(path, probeToken = token) {
  const res = await fetch(path, { headers: { Authorization: `Bearer ${probeToken}` }, cache: 'no-store' });
  let body = null;
  try { body = await res.json(); } catch { body = null; }
  return { status: res.status, body };
}

/**
 * The ONE POST of this page: publish a 全体公告. Returns { status, body }.
 * @param {string} text
 */
async function apiAnnounce(text) {
  const res = await fetch('/api/admin/announce', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    cache: 'no-store',
    body: JSON.stringify({ text }),
  });
  let body = null;
  try { body = await res.json(); } catch { body = null; }
  return { status: res.status, body };
}

/** POST /api/admin/announce/withdraw — 撤回 the standing announcement. Returns { status, body }. */
async function apiWithdrawAnnouncement() {
  const res = await fetch('/api/admin/announce/withdraw', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    cache: 'no-store',
  });
  let body = null;
  try { body = await res.json(); } catch { body = null; }
  return { status: res.status, body };
}

/**
 * A POST that carries a JSON body against the admin API — the shape every operator write here shares (announce,
 * notes, bans, feedback removal). Kept as one helper so a new write cannot forget the bearer token or `no-store`.
 * @param {string} path @param {any} payload @returns {Promise<{status: number, body: any}>}
 */
async function apiPost(path, payload) {
  const res = await fetch(path, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    cache: 'no-store',
    body: JSON.stringify(payload ?? {}),
  });
  let body = null;
  try { body = await res.json(); } catch { body = null; }
  return { status: res.status, body };
}

/** The server's own message for a failed write, falling back to the HTTP status. */
const whyOf = (r) => r?.body?.message || r?.body?.error || `HTTP ${r?.status ?? '?'}`;

// The one write this panel performs. The server sanitizes and truncates the text, rate limits the endpoint, persists it
// and pushes the frame to every connected session; this side only collects the text, reports what happened and lists
// what this session published.

/** Characters used, live. The textarea's maxlength already caps the input; this is the visible counter. */
function syncAnnounceCount() {
  const el = $('announce-text');
  if (!el) return;
  $('announce-count').textContent = t('announceChars', { n: el.value.length });
}

/** @param {string} text @param {'ok'|'error'|'busy'|''} kind */
function setAnnounceStatus(text, kind) {
  const el = $('announce-status');
  if (!el) return;
  el.textContent = text || '';
  el.className = `announce__status${kind ? ` is-${kind}` : ''}`;
}

/** The history list of what THIS panel session published (the server keeps the same ring; this renders it). */
function renderAnnouncements(list) {
  const ul = $('announce-list');
  if (!ul) return;
  ul.replaceChildren();
  if (!Array.isArray(list) || !list.length) {
    ul.append(element('li', 'announce__item announce__item--empty muted', t('announceNone')));
    return;
  }
  for (const a of list) {
    const li = element('li', 'announce__item');
    const head = element('div', 'announce__item-head');
    head.append(element('span', 'announce__item-time', new Date(a.at).toLocaleTimeString()));
    head.append(element('span', 'announce__item-reach', t('announceReach', { n: a.delivered ?? 0 })));
    li.append(head);
    li.append(element('div', 'announce__item-text', a.text ?? ''));
    ul.append(li);
  }
}

/** Refetch the panel's announcement history (it is not part of the 2 s poll). */
async function refreshAnnouncements() {
  const r = await apiGet('/api/admin/announcements');
  if (r.status === 200 && Array.isArray(r.body)) renderAnnouncements(r.body);
}

/** Wire the 全体公告 controls once. */
function wireAnnounce() {
  const text = $('announce-text');
  if (!text) return;
  text.addEventListener('input', syncAnnounceCount);

  $('announce-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const el = $('announce-text');
    const value = el.value.trim();
    if (!value) { setAnnounceStatus(t('announceEmpty'), 'error'); return; }
    const btn = $('announce-send');
    btn.disabled = true;
    setAnnounceStatus(t('announceSending'), 'busy');
    try {
      const r = await apiAnnounce(value);
      if (r.status === 200 && r.body?.ok) {
        el.value = '';
        setAnnounceStatus(t('announceSent', { n: r.body.announcement?.delivered ?? 0 }), 'ok');
        syncAnnounceCount();
        refreshAnnouncements();
        poll(); // the announcement also lands in the server log console; show it now rather than in 2 s
      } else if (r.status === 429) {
        const s = Math.ceil((r.body?.retryAfterMs ?? 0) / 1000);
        setAnnounceStatus(t('announceTooFast', { s }), 'error');
      } else if (r.status === 401) {
        setState(t('unauthorized'), 'error');
        showLogin(true);
      } else {
        setAnnounceStatus(t('announceFailed', { why: r.body?.message ?? r.body?.error ?? `HTTP ${r.status}` }), 'error');
      }
    } catch (err) {
      setAnnounceStatus(t('announceFailed', { why: String(err && err.message ? err.message : err) }), 'error');
    } finally {
      btn.disabled = false;
    }
  });

  $('announce-withdraw').addEventListener('click', async () => {
    const btn = $('announce-withdraw');
    btn.disabled = true;
    setAnnounceStatus(t('announceWithdrawing'), 'busy');
    try {
      const r = await apiWithdrawAnnouncement();
      if (r.status === 200 && r.body?.ok) {
        setAnnounceStatus(t('announceWithdrawn', { n: r.body.delivered ?? 0 }), 'ok');
        poll();
      } else if (r.status === 401) {
        setState(t('unauthorized'), 'error');
        showLogin(true);
      } else {
        setAnnounceStatus(t('announceWithdrawFailed', { why: r.body?.message ?? r.body?.error ?? `HTTP ${r.status}` }), 'error');
      }
    } catch (err) {
      setAnnounceStatus(t('announceWithdrawFailed', { why: String(err && err.message ? err.message : err) }), 'error');
    } finally {
      btn.disabled = false;
    }
  });
}

/** True when this token opens the API (used by the login form before the token is stored). */
async function checkToken(candidate) {
  try { return (await apiGet('/api/admin/overview', candidate)).status === 200; } catch { return false; }
}

// ---------------------------------------------------------------------------------------------------
// 更新公告 (editable: GET/POST /api/admin/notes, GET /api/notes)
// ---------------------------------------------------------------------------------------------------
//
// The announcement is SERVER state now (server/notesStore.js): the operator types it here and every client fetches the
// live copy at boot (public/js/ui/updateNotesModel.js, `GET /api/notes`). public/js/ui/updateNotesData.js is still the
// BUILT-IN revision and remains the fallback — it is what a server with nothing saved serves, and what 「恢复内置」
// goes back to — so this panel both edits the live copy and previews it.
//
// IT IS FREE TEXT, ONE LANGUAGE (owner's decision 2026-10-13: 「要有固定格式写我不喜欢，应该自由写，然后不需要多语言」).
// So this editor is a plain textarea — no JSON, no version/date/headline/sections fields, no per-language columns —
// and the only two rules the writer has to know are the two the preview also applies (shared/updateNotes.js
// `notesBlocks`): a blank line separates paragraphs, a leading `- ` makes a bullet. The preview below the box IS the
// player's layout, computed by the very same function, so what an operator sees here is what ships.
//
// The digest is the whole unlock mechanism: a browser stores it when the player closes the panel, and re-pops when it
// changes. `notes-digest` shows the digest of what is IN EFFECT, computed with the same shared primitives the client
// uses (shared/updateNotes.js → shared/dataPacks.js), so the number on screen IS the number a browser will store.

/** The live revision + its digest, straight from the admin API (null when the request failed). */
async function fetchNotes() {
  const r = await apiGet('/api/admin/notes');
  if (r.status !== 200 || !r.body) return null;
  return r.body;   // { notes, at, by, digest, builtinDigest, writable }
}

/** The built-in revision, so the editor has something valid to show when the server has nothing saved. */
async function builtinNotes() {
  try {
    const mod = await import('/js/ui/updateNotesData.js');
    const notes = mod?.UPDATE_NOTES;
    return notes && typeof notes.text === 'string' ? notes : null;
  } catch {
    return null;
  }
}

/**
 * The digest of the BUILT-IN revision, computed with the client's own recipe (shared/updateNotes.js → dataPacks.js).
 * Shown when the server has nothing saved, so an operator can compare "what ships" with "what is live" — the two
 * numbers differing is exactly the state where clearing would change what players see.
 * @returns {Promise<string|null>}
 */
async function builtinDigest() {
  try {
    const [{ UPDATE_NOTES }, shared] = await Promise.all([
      import('/js/ui/updateNotesData.js'),
      import('/shared/updateNotes.js'),
    ]);
    return UPDATE_NOTES ? shared.notesDigest(UPDATE_NOTES) : null;
  } catch {
    return null;
  }
}

/** Character count of the textarea, so an operator can see the text approaching the server's cap. */
function syncNotesSize() {
  const el = $('notes-text');
  if (!el) return;
  $('notes-size').textContent = `${el.value.length}`;
}

/** @param {string} text @param {'ok'|'error'|'busy'|''} kind */
function setNotesStatus(text, kind) {
  const el = $('notes-status');
  if (!el) return;
  el.textContent = text || '';
  el.className = `announce__status${kind ? ` is-${kind}` : ''}`;
}

/**
 * Fill the editor with a revision and render the preview under it.
 *
 * The textarea is only written when the operator has NOT typed (or when the caller forces it): a refresh or a language
 * switch must never overwrite work in progress. Same class of bug as the feedback panel's collapsing <details>, with a
 * worse consequence — lost typing.
 *
 * @param {object|null} notes what is in effect
 * @param {string|null} digest its digest
 * @param {{ force?: boolean, builtin?: boolean }} [opts] builtin: this is the shipped fallback, not a live revision
 */
function renderNotes(notes, digest, { force = false, builtin = false } = {}) {
  const box = $('notes-text');
  const preview = $('notes-preview');
  if (!box || !preview) return;

  const text = notes && typeof notes.text === 'string' ? notes.text : '';
  if (notes && (force || !notesDirty)) {
    box.value = text;
    syncNotesSize();
  }

  preview.replaceChildren();
  if (!notes) {
    $('notes-count').textContent = '0';
    $('notes-ver').textContent = t('notesEmpty');
    $('notes-digest').textContent = '';
    $('notes-digest').title = '';
    preview.append(element('p', 'notes__empty muted', t('notesNone')));
    return;
  }
  // The preview is the PLAYER's layout, block for block — same function the panel renders with.
  renderNotesPreview(text);
  $('notes-count').textContent = String(text.length);
  $('notes-ver').textContent = builtin ? t('notesBuiltinOnlyShort') : t('notesLive');
  $('notes-digest').textContent = digest ? t('notesDigest', { d: String(digest).slice(0, 12) }) : '';
  $('notes-digest').title = digest || '';
}

/**
 * Draw the preview for `text`. Split out of `renderNotes` so the shared layout rule can RE-draw it the moment it
 * finishes loading (see `loadNotesBlocks`) without touching the textarea the operator may be typing in.
 * @param {string} text
 */
function renderNotesPreview(text) {
  const preview = $('notes-preview');
  if (!preview) return;
  preview.replaceChildren();
  const blocks = notesBlocksFor(text);
  if (!blocks.length) { preview.append(element('p', 'notes__empty muted', t('notesNone'))); return; }
  for (const b of blocks) {
    if (b.kind === 'ul') {
      const ul = element('ul', 'notes__ul');
      for (const item of b.items) ul.append(element('li', 'notes__li', item));
      preview.append(ul);
    } else {
      preview.append(element('p', 'notes__p', b.text));
    }
  }
}

/**
 * `notesBlocks` from the shared module, loaded once and cached.
 *
 * The panel deliberately keeps no module graph of its own (it must render during a half-finished deploy), so this is a
 * dynamic import like `builtinNotes`. Two things make the wait invisible:
 *   * the load is kicked off at WIRE time, not on the first render, so by the time an operator has anything to look at
 *     the rule is normally already in hand;
 *   * when it does land, the preview is RE-DRAWN from the textarea's current value — otherwise the first paint would
 *     keep the one-paragraph fallback until some unrelated event happened to refresh the section.
 * Until it resolves (and if it never does) the fallback treats the whole text as one paragraph, which still shows every
 * character the operator typed — and `white-space: pre-wrap` keeps the line breaks, so it reads correctly even then.
 * @param {string} text
 * @returns {({ kind: 'p', text: string } | { kind: 'ul', items: string[] })[]}
 */
let notesBlocksFn = null;
let notesBlocksLoading = null;
function loadNotesBlocks() {
  if (notesBlocksLoading) return notesBlocksLoading;
  notesBlocksLoading = import('/shared/updateNotes.js')
    .then((mod) => {
      notesBlocksFn = typeof mod.notesBlocks === 'function' ? mod.notesBlocks : null;
      // The rule is in hand now: redraw what is on screen with it (never writing to the textarea).
      const box = $('notes-text');
      if (notesBlocksFn && box) renderNotesPreview(box.value);
      return notesBlocksFn;
    })
    .catch(() => null);
  return notesBlocksLoading;
}

/** @param {string} text */
function notesBlocksFor(text) {
  if (notesBlocksFn) return notesBlocksFn(text);
  loadNotesBlocks();
  // Kick the load for the redraw above; meanwhile show the honest thing: the raw text, line breaks and all.
  return text ? [{ kind: 'p', text }] : [];
}

/** True once the operator has typed: their text then wins over anything the server sends. */
let notesDirty = false;
/** The last revision the server reported, so 撤销编辑 can restore it without another request. */
let notesServerCopy = null;
/** The last digest reported, shown after a save. */
let notesServerDigest = null;

/**
 * Load the live revision and show it. Runs on sign-in, on a language switch, and after a clear.
 *
 * A server with nothing saved answers `notes: null`; the BUILT-IN revision is shown then (and offered for editing),
 * which is the honest thing to display — it is what players are actually seeing.
 * @param {{ force?: boolean }} [opts]
 */
async function refreshUpdateNotes({ force = false } = {}) {
  const data = await fetchNotes();
  if (data === null) {
    // The request failed (or there is no token yet): show the built-in copy rather than an empty box. The panel's own
    // state badge already reports the API being unreachable, so no extra message here.
    renderNotes(await builtinNotes(), null, { force, builtin: true });
    return;
  }
  notesServerDigest = data.digest || null;
  if (data.notes) {
    notesServerCopy = data.notes;
    renderNotes(data.notes, data.digest, { force });
    return;
  }
  const builtin = await builtinNotes();
  notesServerCopy = null;
  // The server has nothing saved, so what players are actually getting is the BUILT-IN revision — show ITS digest
  // (computed here, with the client's recipe) rather than a blank, so the number on screen is the real one.
  const digest = data.builtinDigest || await builtinDigest();
  notesServerDigest = digest;
  renderNotes(builtin, digest, { force, builtin: true });
  if (builtin && !force) setNotesStatus(t('notesBuiltinOnly'), '');
}

/** POST the edited text. The server cleans and validates it; nothing is written when it is not a usable revision. */
async function saveNotes() {
  const box = $('notes-text');
  if (!box) return;
  const btn = $('notes-save');
  btn.disabled = true;
  setNotesStatus(t('notesSaving'), 'busy');
  try {
    const res = await fetch('/api/admin/notes', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      cache: 'no-store',
      body: JSON.stringify({ text: box.value }),
    });
    let body = null;
    try { body = await res.json(); } catch { body = null; }
    if (res.status === 200 && body?.ok) {
      notesDirty = false;
      notesServerCopy = body.notes;
      notesServerDigest = body.digest;
      renderNotes(body.notes, body.digest, { force: true });
      const d = String(body.digest || '').slice(0, 12);
      setNotesStatus(body.unwritable
        ? t('notesSavedUnwritable')
        : t('notesSaved', { d }), body.unwritable ? 'error' : 'ok');
      poll();   // the save is logged; show the line now rather than up to 2 s later
    } else {
      setNotesStatus(t('notesSaveFailed', { why: body?.message ?? body?.error ?? `HTTP ${res.status}` }), 'error');
    }
  } catch (err) {
    setNotesStatus(t('notesSaveFailed', { why: String(err?.message || err) }), 'error');
  } finally {
    btn.disabled = false;
  }
}

/** Drop the live revision: every client falls back to the shipped one. */
async function clearNotes() {
  if (typeof globalThis.confirm === 'function' && !globalThis.confirm(t('notesClearConfirm'))) return;
  const btn = $('notes-clear');
  btn.disabled = true;
  try {
    const res = await fetch('/api/admin/notes/clear', {
      method: 'POST', headers: { Authorization: `Bearer ${token}` }, cache: 'no-store',
    });
    let body = null;
    try { body = await res.json(); } catch { body = null; }
    if (res.status === 200 && body?.ok) {
      notesDirty = false;
      notesServerCopy = null;
      notesServerDigest = null;
      setNotesStatus(t('notesCleared'), 'ok');
      await refreshUpdateNotes({ force: true });
      setNotesStatus(t('notesCleared'), 'ok');
      poll();
    } else {
      setNotesStatus(t('notesClearFailed', { why: body?.message ?? body?.error ?? `HTTP ${res.status}` }), 'error');
    }
  } catch (err) {
    setNotesStatus(t('notesClearFailed', { why: String(err?.message || err) }), 'error');
  } finally {
    btn.disabled = false;
  }
}

/** Wire the 更新公告 editor once. */
function wireUpdateNotes() {
  const box = $('notes-text');
  if (!box) return;
  // Start fetching the shared layout rule NOW rather than on the first render, so the preview is normally correct on
  // its very first paint (the load re-draws it when it lands either way — see loadNotesBlocks).
  loadNotesBlocks();
  box.addEventListener('input', () => { notesDirty = true; syncNotesSize(); });
  $('notes-form').addEventListener('submit', (event) => { event.preventDefault(); saveNotes(); });
  $('notes-reset').addEventListener('click', () => {
    // Back to the last revision the server reported — no request, so it works while offline.
    notesDirty = false;
    setNotesStatus('', '');
    if (notesServerCopy) renderNotes(notesServerCopy, notesServerDigest, { force: true });
    else refreshUpdateNotes({ force: true });
  });
  $('notes-clear').addEventListener('click', clearNotes);
}

async function poll() {
  try {
    const [overview, rooms, logs, feedback, bans, slots, limits] = await Promise.all([
      apiGet('/api/admin/overview'),
      apiGet('/api/admin/rooms'),
      apiGet(`/api/admin/logs?since=${logCursor}`),
      apiGet('/api/admin/feedback?limit=50'),
      apiGet('/api/admin/bans'),
      apiGet('/api/admin/slots'),
      apiGet('/api/admin/limits'),
    ]);
    // 404 = the server was started without ADMIN_SECRET (the surface does not exist); 401 = wrong or locked-out token.
    if (overview.status === 401) { setState(t('unauthorized'), 'error'); showLogin(true); return; }
    if (overview.status === 404) { setState(t('offline'), 'error'); showLogin(true); return; }
    if (overview.status !== 200 || !overview.body) { setState(t('offline'), 'error'); return; }
    setState(t('live'), 'ok');
    renderOverview(overview.body);
    if (Array.isArray(rooms.body)) renderRooms(rooms.body);
    if (Array.isArray(logs.body) && logs.body.length) appendLogs(logs.body);
    if (Array.isArray(feedback.body?.items)) renderFeedback(feedback.body.items);
    // Both of these answer 200 with a body even on an older build that does not know the route (it 404s instead), so a
    // failure here must not blank a section that still has valid content from the previous poll.
    if (bans.status === 200 && bans.body) renderBans(bans.body);
    if (slots.status === 200 && slots.body) renderSlots(slots.body);
    if (limits.status === 200 && limits.body) renderLimits(limits.body);
  } catch {
    // A dropped poll is not an error state of its own: the next tick retries.
    setState(t('offline'), 'warn');
  }
}

function renderOverview(o) {
  lastOverview = o;
  const version = o.version || {};
  $('badge-version').textContent = `v${version.app ?? '?'}${version.build ? ` · ${String(version.build).slice(0, 12)}` : ''}`;
  $('foot-build').textContent = version.build ?? '—';
  $('foot-node').textContent = version.node ?? '—';

  const system = o.system || {};
  $('stat-sockets').textContent = o.sockets ?? 0;
  $('stat-sessions').textContent = o.sessions ?? 0;
  $('stat-clients').textContent = `${t('clients', { humans: o.humans ?? 0, bots: o.bots ?? 0, spectators: o.spectators ?? 0 })} · ${t('uptime', { uptime: duration(o.uptimeSec) })}`;
  $('stat-rooms').textContent = o.rooms ?? 0;
  $('stat-matches').textContent = o.matches ?? 0;
  $('stat-population').textContent = t('clients', { humans: o.humans ?? 0, bots: o.bots ?? 0, spectators: o.spectators ?? 0 });
  $('stat-cpu').textContent = `${system.cpuPercent ?? 0}%`;
  const load = Array.isArray(system.loadAvg) ? system.loadAvg.map((v) => Number(v).toFixed(2)).join(' ') : '—';
  // The match engine's own share of one core, next to the process CPU% above: the gap between the two is what the
  // server spends outside the matches (network, static files, socket writes) — the first thing to look at when the
  // host is busy but no single room is. Absent a second reading yet, it says so instead of showing a fake 0%.
  const engine = o.perf && typeof o.perf.sharePercent === 'number'
    ? ` · ${t('perfShare', { p: o.perf.sharePercent.toFixed(1) })}`
    : '';
  $('stat-load').textContent = `${t('load', { load, cores: system.cpuCount ?? '—' })} · ${t('uptime', { uptime: duration(o.uptimeSec) })}${engine}`;
  $('stat-load').title = o.perf && typeof o.perf.sharePercent === 'number'
    ? perfTip({ ...o.perf, frames: o.perf.frames ?? 0 })
    : '';
  $('stat-rss').textContent = system.processRssMb ?? 0;
  $('stat-heap').textContent = t('heap', {
    used: system.heapUsedMb ?? 0, total: system.heapTotalMb ?? 0, free: system.systemFreeMb ?? 0,
  });
}

/** One feedback card: the time, the chips, the player's words and the diagnostics behind a <details>. */
function feedbackCard(it) {
  const card = element('article', 'fb');
  const head = element('div', 'fb__head');
  head.append(element('span', 'fb__time', new Date(it.at).toLocaleString()));
  const meta = it.meta || {};
  if (meta.room) head.append(element('span', 'fb__chip', `#${meta.room}`));
  if (meta.version) head.append(element('span', 'fb__chip', `v${meta.version}`));
  if (meta.phase) head.append(element('span', 'fb__chip', `${meta.phase}${meta.round ? ` · R${meta.round}` : ''}`));
  if (meta.mode) head.append(element('span', 'fb__chip', meta.mode));
  // 发送者的地址。**这一处是常显的，与房间表的悬停规则不同**，理由是使用场景：房间表是「一群人正在玩」，地址属于
  // 隐私、平时不该摆在表里；而这条反馈是**那个人自己主动送到运维面前的一份报告**——运维正要为它做判断（回信、查
  // 那个房间、或封掉刷屏的人）。要把它做判断的凭据再藏进悬停，只会让「删除这条」旁边的地址要点两下才看得见。
  // 服务器从一开始就存着它（server/feedback.js 的 `ip`），此前只是没画出来。
  if (it.ip && it.ip !== '?') {
    const ipChip = element('span', 'fb__chip fb__chip--ip', it.ip);
    ipChip.title = t('addrHint', { addr: it.ip });
    // 点一下 = 填进封禁框，和房间表里的座位一样。
    ipChip.dataset.banAddr = it.ip;
    ipChip.classList.add('fb__chip--click');
    head.append(ipChip);
  }
  head.append(element('span', 'fb__spacer'));
  // 删除 (owner request 2026-10-13): the one destructive control on this page, so it is a plain button that asks
  // before it acts, and it carries the report's id — the store deletes by id, never by position or by content.
  const del = element('button', 'fb__del btn btn--ghost btn--tiny', t('feedbackDelete'));
  del.type = 'button';
  del.dataset.fbDel = String(it.id ?? '');
  del.disabled = !it.id;
  if (!it.id) del.title = t('feedbackDeleteFailed', { why: 'no id' });
  head.append(del);
  card.append(head);
  if (it.description) card.append(element('p', 'fb__desc', it.description));
  if (it.report) {
    const det = element('details', 'fb__report');
    det.append(element('summary', null, t('feedbackDiag')));
    const pre = element('pre', 'fb__pre');
    pre.textContent = it.report;
    det.append(pre);
    card.append(det);
  }
  return card;
}

/**
 * 玩家反馈 (POST /api/feedback → server/feedback.js): newest first — the time, the room code the report came from,
 * the player's own words, and the diagnostics text behind a <details> (a full report is long; the panel stays readable).
 *
 * WHY THIS IS NOT A FULL RE-RENDER. It used to `replaceChildren()` on every 2 s poll, which threw away whatever the
 * operator had open: expanding 诊断信息 and watching it snap shut a moment later (reported 2026-10-12: 「点击诊断过几秒
 * 诊断详细界面会自动关闭」). A poll that returns the same reports must therefore not touch the DOM at all. Every entry
 * is keyed by its server id, and only the difference moves:
 *   * an id already on screen → its existing card is LEFT ALONE (an open <details> stays open, text selection survives);
 *   * a new id → its card is prepended (the list is newest-first);
 *   * an id that is gone → its card is removed.
 * The count and the empty state are the only things written unconditionally, and they are cheap.
 */
function renderFeedback(items) {
  $('feedback-count').textContent = String(items.length);
  const host = $('feedback-list');
  if (!items.length) {
    // Only touch the DOM when it is not already showing the empty state.
    if (!host.querySelector('.empty')) host.replaceChildren(element('p', 'empty', t('noFeedback')));
    return;
  }
  const empty = host.querySelector('.empty');
  if (empty) empty.remove();

  // Index what is already on screen by its key. Built from the DOM on every call (not kept in a module variable), so
  // the reconciler can never disagree with what is actually rendered.
  const onScreen = new Map();
  for (const el of [...host.children]) {
    const key = el.dataset ? el.dataset.fbId : undefined;
    if (key) onScreen.set(key, el);
  }

  const want = new Set();
  let anchor = host.firstElementChild;   // the oldest card currently rendered; a new card goes before it
  for (const it of items) {
    // A record without an id (a hand-edited line, an older format) is still rendered, but it cannot be reconciled:
    // give it a content-derived key so a repeat poll matches it and only a genuinely new line adds a card.
    const key = typeof it.id === 'string' && it.id
      ? it.id
      : `anon-${it.at}-${String(it.description || '').length}-${String(it.report || '').length}`;
    want.add(key);
    const existing = onScreen.get(key);
    if (existing) { anchor = existing.nextElementSibling; continue; }   // already on screen: DO NOT touch it
    const card = feedbackCard(it);
    card.dataset.fbId = key;
    if (anchor) host.insertBefore(card, anchor);
    else host.append(card);
    anchor = card.nextElementSibling;
  }
  // Anything left over is a report the server no longer lists (it aged out of the window, or was deleted).
  for (const el of [...host.children]) {
    if (el.classList.contains('empty')) continue;
    if (!want.has(el.dataset.fbId)) el.remove();
  }
}

/**
 * 删除一条玩家反馈 (POST /api/admin/feedback/remove { id }).
 *
 * The button carries the report's id and the request goes out on the click, so the panel never has to guess which card
 * the operator meant. On success the card is removed locally at once (the next poll would do it anyway, but waiting
 * 2 s after a delete reads like a failure) and the count is corrected.
 * @param {HTMLButtonElement} btn
 */
async function deleteFeedback(btn) {
  const id = btn?.dataset?.fbDel;
  if (!id) return;
  if (!window.confirm(t('feedbackDeleteConfirm'))) return;
  btn.disabled = true;
  const original = btn.textContent;
  btn.textContent = t('feedbackDeleting');
  try {
    const r = await apiPost('/api/admin/feedback/remove', { id });
    if (r.status === 200 && r.body?.ok) {
      const card = btn.closest('.fb');
      if (card) card.remove();
      const host = $('feedback-list');
      const left = host ? host.querySelectorAll('.fb').length : 0;
      $('feedback-count').textContent = String(left);
      if (!left && host && !host.querySelector('.empty')) host.append(element('p', 'empty', t('noFeedback')));
      return;
    }
    btn.textContent = original;
    btn.disabled = false;
    window.alert(t('feedbackDeleteFailed', { why: whyOf(r) }));
  } catch {
    btn.textContent = original;
    btn.disabled = false;
    window.alert(t('feedbackDeleteFailed', { why: 'network' }));
  }
}

// One listener for the whole list (the cards are reconciled in and out, so a per-card handler would be re-bound on
// every poll). The button names itself with data-fb-del; an address chip carries data-ban-addr instead (clicking it
// puts that address in the ban field — see fillBanField).
$('feedback-list').addEventListener('click', (event) => {
  const btn = event.target.closest('[data-fb-del]');
  if (btn) { deleteFeedback(btn); return; }
  const chip = event.target.closest('[data-ban-addr]');
  if (chip) fillBanField(chip.dataset.banAddr);
});

// ---------------------------------------------------------------------------------------------------
// 服务器槽位（蓝绿）— GET /api/admin/slots (server/peer.js, DEPLOY.md §8.4)
// ---------------------------------------------------------------------------------------------------

/** One slot row: its name, whether it answers, and the counters that decide whether it may be stopped. */
function slotCard(slot) {
  const card = element('article', `slot${slot.active ? ' slot--active' : ''}${slot.reachable ? '' : ' slot--down'}`);
  const head = element('div', 'slot__head');
  head.append(element('span', 'slot__name', slot.active ? t('slotsSelf') : t('slotsPeer')));
  if (slot.name) head.append(element('span', 'slot__tag', String(slot.name).toUpperCase()));
  head.append(element('span', 'slot__state', slot.reachable ? t('slotsReachable') : t('slotsUnreachable')));
  card.append(head);

  const c = slot.counters || {};
  const facts = element('div', 'slot__facts');
  if (slot.port != null) facts.append(element('span', 'slot__fact', t('slotsPort', { p: slot.port })));
  if (c.build) facts.append(element('span', 'slot__fact', t('slotsBuild', { b: String(c.build).slice(0, 12) })));
  if (c.uptimeSec != null) facts.append(element('span', 'slot__fact', t('slotsUptime', { u: duration(c.uptimeSec) })));
  if (slot.hostname) facts.append(element('span', 'slot__fact', t('slotsHostname', { h: slot.hostname })));
  if (slot.via && slot.via !== 'self') facts.append(element('span', 'slot__fact', t('slotsVia', { via: slot.via })));
  card.append(facts);

  if (slot.reachable && c) {
    card.append(element('div', 'slot__counters', t('slotsPlayers', {
      humans: c.humans ?? '—', bots: c.bots ?? '—', spec: c.spectators ?? '—',
    })));
    card.append(element('div', 'slot__counters', t('slotsRooms', {
      rooms: c.rooms ?? '—', matches: c.matches ?? '—', sockets: c.sockets ?? '—', sessions: c.sessions ?? '—',
    })));
    if (c.processRssMb != null) card.append(element('div', 'slot__counters', t('slotsRss', { mb: c.processRssMb })));
    // The one judgement this section exists to support: may I stop that process? Only say "safe" when the counters
    // say so — the same condition sp-release.sh waits on (rooms = 0 && matches = 0 && humans = 0).
    if (!slot.active) {
      const humans = Number(c.humans) || 0;
      const matches = Number(c.matches) || 0;
      const busy = humans > 0 || matches > 0;
      card.append(element('p', `slot__verdict${busy ? ' slot__verdict--busy' : ' slot__verdict--free'}`,
        busy ? t('slotsDraining', { humans, matches }) : t('slotsMayStop')));
    }
  } else if (!slot.active) {
    card.append(element('p', 'slot__verdict slot__verdict--free', slot.error ? `${t('slotsUnreachable')} · ${slot.error}` : t('slotsUnknown')));
  }
  return card;
}

/** The slot section. Hidden entirely when the server reports no peer at all (a single-process deployment). */
function renderSlots(data) {
  const host = $('slots-list');
  if (!host) return;
  const slots = Array.isArray(data?.slots) ? data.slots : [];
  // The server may report `slots: []` (no peer configured): show this process alone in that case.
  const list = slots.length ? slots : (data?.self ? [data.self] : []);
  host.replaceChildren();
  if (!list.length) { host.append(element('p', 'muted', t('slotsUnknown'))); return; }
  for (const slot of list) host.append(slotCard(slot));
  if (!data?.peerConfigured) host.append(element('p', 'muted slot__hint', t('slotsNoPeer')));
}

// ---------------------------------------------------------------------------------------------------
// 服务器人数上限 — GET/POST /api/admin/limits (server/limits.js, DEPLOY.md §8.7)
// ---------------------------------------------------------------------------------------------------
//
// 这个面板改的是**这台服务器允许多少个 WebSocket 同时开着**（`net.js admission()` 的那道门）。三件事在界面上
// 必须说清楚，因为它们都是运维一按下去就会问的：
//   * 「现在是多少」——生效值，以及它是**面板设的**还是**这机器启动时就带着的**（`bootMaxConnections`）；
//   * 「离满还有多远」——当前连接数 / 上限，这个分母缺了，数字就没有意义；
//   * 「调低了会不会把人踢掉」——不会。所以上限低于当前人数时要**明确写出来**，而不是让运维自己猜。

/** One line describing where the number in force came from. */
function limitsSource(data) {
  if (data?.overridden) return t('limitsFromPanel', { when: data.at ? new Date(data.at).toLocaleString() : '—', by: data.by || '—' });
  if (data?.touched) return t('limitsFromBootCleared');
  return t('limitsFromBoot');
}

/**
 * Render the current ceiling, its denominator, and where it came from.
 *
 * `enabled === false` (an old build, or a startServer without the limiter wired) must not blank the section: the
 * form stays usable and the operator sees why the number is unknown, rather than an empty panel that looks broken.
 */
function renderLimits(data) {
  lastLimits = data;
  const valueEl = $('limits-value');
  const metaEl = $('limits-meta');
  if (!valueEl) return;
  const cap = data?.maxConnections;
  const sockets = Number(data?.sockets) || 0;
  valueEl.textContent = cap == null ? '—' : String(cap);
  valueEl.className = `limits__value${cap != null && sockets >= cap ? ' limits__value--full' : ''}`;
  const parts = [t('limitsInUse', { sockets, cap: cap == null ? '—' : cap }), limitsSource(data)];
  // 调低到当前人数以下时，把「新人进不来、但没人会被踢」直接写在界面上——这是本功能唯一会让人误判的地方。
  if (cap != null && sockets > cap) parts.push(t('limitsOver'));
  metaEl.textContent = parts.join(' · ');
  // 输入框不覆盖运维正在打的字：只在它为空、或正是上一次从服务器读到的值时同步。
  const input = $('limits-input');
  if (input && (!input.value || input.dataset.synced === '1')) {
    input.value = cap == null ? '' : String(cap);
    input.dataset.synced = '1';
  }
  // 人机两格（业主 2026-10-16）：同一条「不覆盖运维正在打的字」的规矩。
  const bi = $('bots-input');
  if (bi && (!bi.value || bi.dataset.synced === '1')) {
    bi.value = data?.maxBots == null ? '' : String(data.maxBots);
    bi.dataset.synced = '1';
  }
  const bri = $('bots-room-input');
  if (bri && (!bri.value || bri.dataset.synced === '1')) {
    bri.value = data?.maxBotsPerRoom == null ? '' : String(data.maxBotsPerRoom);
    bri.dataset.synced = '1';
  }
}

/** @param {string} text @param {'ok'|'error'|'busy'|''} kind */
function setLimitsStatus(text, kind) {
  const el = $('limits-status');
  if (!el) return;
  el.textContent = text || '';
  el.className = `announce__status${kind ? ` is-${kind}` : ''}`;
}

/** POST one new ceiling (`null` clears the panel value and follows the boot option) and report what happened. */
async function saveLimits(value) {
  const btn = $('limits-save');
  const clearBtn = $('limits-clear');
  if (btn) btn.disabled = true;
  if (clearBtn) clearBtn.disabled = true;
  setLimitsStatus(t('limitsSaving'), 'busy');
  try {
    const r = await apiPost('/api/admin/limits', { maxConnections: value });
    if (r.status === 200 && r.body?.ok) {
      renderLimits(r.body);
      if ($('limits-input')) $('limits-input').dataset.synced = '1';
      // 落盘失败要说出来：值在本进程生效了，但重启（或另一个槽）不会知道。
      setLimitsStatus(r.body.persisted === false ? t('limitsSavedNoDisk', { n: r.body.maxConnections ?? '—' })
        : value == null ? t('limitsCleared') : t('limitsSaved', { n: r.body.maxConnections }), r.body.persisted === false ? 'error' : 'ok');
    } else {
      setLimitsStatus(t('limitsFailed', { why: whyOf(r) }), 'error');
    }
  } catch {
    setLimitsStatus(t('limitsFailed', { why: 'network' }), 'error');
  }
  if (btn) btn.disabled = false;
  if (clearBtn) clearBtn.disabled = false;
}

/**
 * 保存人机上限（业主 2026-10-16）：与 saveLimits 同一条路，只是 body 里带的是人机那两格。
 * 只提交填了的格子 —— 留空表示「这一格不动」，而不是清除（清除走「跟随启动参数」那个按钮）。
 * @param {{ maxBots?: number, maxBotsPerRoom?: number }} payload
 */
async function saveBots(payload) {
  const btn = $('bots-save');
  if (btn) btn.disabled = true;
  setLimitsStatus(t('limitsSaving'), 'busy');
  try {
    const r = await apiPost('/api/admin/limits', payload);
    if (r.status === 200 && r.body?.ok) {
      renderLimits(r.body);
      for (const id of ['bots-input', 'bots-room-input']) if ($(id)) $(id).dataset.synced = '1';
      const n = `${r.body.maxBots ?? '—'} / ${r.body.maxBotsPerRoom ?? '—'}`;
      setLimitsStatus(r.body.persisted === false ? t('limitsSavedNoDisk', { n }) : t('botsSaved', { n }), r.body.persisted === false ? 'error' : 'ok');
    } else {
      setLimitsStatus(t('limitsFailed', { why: whyOf(r) }), 'error');
    }
  } catch {
    setLimitsStatus(t('limitsFailed', { why: 'network' }), 'error');
  }
  if (btn) btn.disabled = false;
}

/** Wire the 上限 controls once. */
function wireLimits() {
  const form = $('limits-form');
  if (!form) return;
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const raw = $('limits-input').value.trim();
    const n = Number(raw);
    if (!raw || !Number.isInteger(n) || n < 1) { setLimitsStatus(t('limitsBadValue'), 'error'); return; }
    void saveLimits(n);
  });
  $('limits-clear').addEventListener('click', () => {
    if (!window.confirm(t('limitsConfirmClear'))) return;
    void saveLimits(null);
  });
  // 手打之后就不要再被轮询覆盖（否则每 2 秒把运维正在输的数字冲掉）。
  $('limits-input').addEventListener('input', (event) => { event.target.dataset.synced = '0'; });
  // 人机两格（业主 2026-10-16）：两个框一起提交，**留空 = 那一格不动**（跟「跟随启动参数」不是一回事 ——
  // 要清除面板设置就用下面那个「跟随启动参数」按钮）。0 合法 = 不限制。
  const botsBtn = $('bots-save');
  if (botsBtn) {
    botsBtn.addEventListener('click', () => {
      const rawB = $('bots-input')?.value.trim() ?? '';
      const rawR = $('bots-room-input')?.value.trim() ?? '';
      const payload = {};
      for (const [key, raw] of [['maxBots', rawB], ['maxBotsPerRoom', rawR]]) {
        if (!raw) continue;
        const n = Number(raw);
        if (!Number.isInteger(n) || n < 0) { setLimitsStatus(t('botsBadValue'), 'error'); return; }
        payload[key] = n;
      }
      if (!Object.keys(payload).length) { setLimitsStatus(t('botsBadValue'), 'error'); return; }
      void saveBots(payload);
    });
  }
  for (const id of ['bots-input', 'bots-room-input']) {
    $(id)?.addEventListener('input', (event) => { event.target.dataset.synced = '0'; });
  }
}

/** Refetch the ceiling (small document; every change re-renders from the server's answer). */
async function refreshLimits() {
  const r = await apiGet('/api/admin/limits');
  if (r.status === 200 && r.body) renderLimits(r.body);
}

// ---------------------------------------------------------------------------------------------------
// 封禁 IP — GET/POST /api/admin/bans (server/bans.js, DEPLOY.md §8.3)
// ---------------------------------------------------------------------------------------------------

/** One ban row: the rule, its reason, who set it and when it lapses, plus its 解封 button. */
function banRow(ban) {
  const li = element('li', 'ban');
  const main = element('div', 'ban__main');
  main.append(element('code', 'ban__rule', ban.rule ?? '—'));
  if (ban.reason) main.append(element('span', 'ban__reason', ban.reason));
  li.append(main);
  const meta = element('div', 'ban__meta');
  const when = ban.until != null ? t('banUntil', { when: new Date(ban.until).toLocaleString() }) : t('banPermanent');
  meta.append(element('span', 'muted', when));
  if (ban.by) meta.append(element('span', 'muted', t('banBy', { by: ban.by })));
  li.append(meta);
  const del = element('button', 'ban__remove btn btn--ghost btn--tiny', t('banRemove'));
  del.type = 'button';
  del.dataset.banRemove = String(ban.rule ?? '');
  li.append(del);
  return li;
}

/** The standing list. A full re-render is fine here: unlike the feedback list this one holds no <details> to keep. */
function renderBans(data) {
  const ul = $('bans-list');
  if (!ul) return;
  const bans = Array.isArray(data?.bans) ? data.bans : [];
  $('bans-count').textContent = String(bans.length);
  ul.replaceChildren();
  if (data && data.enabled === false) { ul.append(element('li', 'ban ban--empty muted', t('bansDisabled'))); return; }
  if (!bans.length) { ul.append(element('li', 'ban ban--empty muted', t('bansNone'))); return; }
  for (const ban of bans) ul.append(banRow(ban));
}

/** @param {string} text @param {'ok'|'error'|'busy'|''} kind */
function setBanStatus(text, kind) {
  const el = $('ban-status');
  if (!el) return;
  el.textContent = text || '';
  el.className = `announce__status${kind ? ` is-${kind}` : ''}`;
}

/** Refetch the ban list (it is small, and every change re-renders it from the server's answer). */
async function refreshBans() {
  const r = await apiGet('/api/admin/bans');
  if (r.status === 200) renderBans(r.body);
}

/** Wire the 封禁 controls once. */
function wireBans() {
  const form = $('ban-form');
  if (!form) return;

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const rule = $('ban-rule').value.trim();
    if (!rule) { setBanStatus(t('banEmptyRule'), 'error'); return; }
    const reason = $('ban-reason').value.trim();
    const minutes = Number($('ban-minutes').value);
    const btn = $('ban-add');
    btn.disabled = true;
    setBanStatus(t('banAdding'), 'busy');
    try {
      // An empty minutes field means permanent — send no duration at all rather than 0 or NaN.
      const payload = { rule, reason };
      if (Number.isFinite(minutes) && minutes > 0) payload.minutes = minutes;
      const r = await apiPost('/api/admin/bans', payload);
      if (r.status === 200 && r.body?.ok) {
        const n = Number(r.body.evicted) || 0;
        setBanStatus(r.body.added === false ? t('banExists', { rule: r.body.ban?.rule ?? rule }) : t('banAdded', { rule: r.body.ban?.rule ?? rule, n }), 'ok');
        $('ban-rule').value = '';
        $('ban-reason').value = '';
        $('ban-minutes').value = '';
        if (Array.isArray(r.body.bans)) renderBans({ bans: r.body.bans, enabled: true });
        else refreshBans();
      } else {
        setBanStatus(t('banAddFailed', { why: whyOf(r) }), 'error');
      }
    } catch {
      setBanStatus(t('banAddFailed', { why: 'network' }), 'error');
    }
    btn.disabled = false;
  });

  // 解封 — one listener for the list (its rows are replaced on every refresh).
  $('bans-list').addEventListener('click', async (event) => {
    const btn = event.target.closest('[data-ban-remove]');
    if (!btn) return;
    const rule = btn.dataset.banRemove;
    if (!window.confirm(t('banConfirmRemove', { rule }))) return;
    btn.disabled = true;
    setBanStatus(t('banRemoving'), 'busy');
    try {
      const r = await apiPost('/api/admin/bans/remove', { rule });
      if (r.status === 200 && r.body?.ok) {
        setBanStatus(t('banRemoved', { rule }), 'ok');
        if (Array.isArray(r.body.bans)) renderBans({ bans: r.body.bans, enabled: true });
        else refreshBans();
      } else {
        setBanStatus(t('banRemoveFailed', { why: whyOf(r) }), 'error');
      }
    } catch {
      setBanStatus(t('banRemoveFailed', { why: 'network' }), 'error');
    }
  });

  // 房间表里的座位：地址藏在悬停提示里，点一下把它填进上面的封禁框。
  // 这里是「看到捣乱的人 → 准备封他」最短的一条路，而**提交仍由操作员完成**——一次误点不该把在线玩家踢出去。
  $('rooms-body').addEventListener('click', (event) => {
    const tag = event.target.closest('[data-ban-addr]');
    if (tag) fillBanField(tag.dataset.banAddr);
  });
}

function renderRooms(rooms) {
  $('rooms-count').textContent = String(rooms.length);
  const body = $('rooms-body');
  body.replaceChildren();
  if (!rooms.length) {
    const row = element('tr');
    const cell = element('td', 'empty', t('noRooms'));
    cell.colSpan = 7;
    row.append(cell);
    body.append(row);
    return;
  }
  for (const room of rooms) {
    const row = element('tr');
    row.append(element('td', 'code', room.code ?? '—'));

    const host = element('td');
    host.append(element('span', null, room.hostName ?? room.host ?? '—'));
    row.append(host);

    const mode = element('td');
    mode.append(element('span', `pill pill--${room.mode === 'solo' ? 'warn' : 'ok'}`, room.mode === 'solo' ? t('modeSolo') : t('modeCoop')));
    mode.append(document.createTextNode(' '));
    mode.append(element('span', 'muted', room.difficulty ?? ''));
    row.append(mode);

    const seats = element('td');
    const list = Array.isArray(room.seats) ? room.seats : [];
    if (!list.length) seats.append(element('span', 'muted', '—'));
    for (const seat of list) seats.append(seatTag(seat));
    row.append(seats);

    const spectators = element('td');
    const watchers = Array.isArray(room.spectators) ? room.spectators : [];
    if (!watchers.length) spectators.append(element('span', 'muted', '—'));
    for (const w of watchers) spectators.append(element('span', 'tag', w.name ?? w.playerId ?? '—'));
    row.append(spectators);

    row.append(perfCell(room.perf));

    const match = element('td');
    if (!room.match) match.append(element('span', 'pill pill--idle', t('lobby')));
    else {
      match.append(element('span', 'pill pill--ok', t('inMatch')));
      match.append(document.createTextNode(' '));
      match.append(element('span', 'muted', `${room.match.phase ?? '—'} · R${room.match.round ?? 0}`));
      if (room.match.paused) match.append(element('span', 'pill pill--warn', t('paused')));
    }
    row.append(match);
    body.append(row);
  }
}

/** How much of one core counts as "hot" on the heat bar. Saturation, not a limit: past it the bar just stays full. */
const PERF_FULL_CORE = 100;

/**
 * The per-room cost cell: a heat bar plus the share of one core, with the bucket breakdown in the tooltip.
 *
 * Three states, and the panel never guesses between them:
 *   * `perf` null / no share yet → 未开打 (a room in the lobby runs no match at all);
 *   * a live match whose FIRST reading is all the server has → 测量中 (totals are known, a rate is not: a rate needs
 *     two readings, and inventing one from a single sample is how these meters lie);
 *   * a measured rate → the bar, the share, and a tooltip naming every bucket that spent time.
 * @param {any} perf the `perf` object of /api/admin/rooms, or null
 */
function perfCell(perf) {
  const td = element('td', 'perf');
  if (!perf) { td.append(element('span', 'muted', t('perfIdle'))); return td; }

  const fill = document.createElement('div');
  fill.className = 'perf__fill';
  const bar = element('div', 'perf__bar');
  bar.append(fill);
  td.append(bar);

  const share = typeof perf.sharePercent === 'number' ? perf.sharePercent : null;
  const line = element('div', 'perf__line');
  if (share == null) {
    bar.classList.add('perf__bar--warm');
    line.append(element('span', 'muted', t('perfWarm')));
  } else {
    fill.style.width = `${Math.max(0, Math.min(100, (share / PERF_FULL_CORE) * 100))}%`;
    bar.classList.add(share >= 25 ? 'perf__bar--hot' : share >= 5 ? 'perf__bar--warm' : 'perf__bar--cool');
    line.append(element('span', 'perf__pct', t('perfShare', { p: share.toFixed(1) })));
  }
  line.append(element('span', 'muted perf__total', t('perfTotal', { ms: Math.round(perf.totalMs ?? 0) })));
  td.append(line);
  td.title = perfTip(perf);
  return td;
}

/**
 * The tooltip: the window's rate, and the match's LIFETIME split across the seven buckets.
 *
 * WHY TWO VIEWS (owner's report 2026-10-14, with a screenshot of a tooltip that read 「合计 0」 for a room whose
 * counter said 48831 ms / 31915 callbacks). The old tip listed only buckets with a share > 0 IN THE CURRENT WINDOW.
 * That is the right number for the扩容 question ("is this room hot right now"), but it is EMPTY in the two situations
 * an operator actually hovers:
 *
 *   * a PREP phase, where the engine barely runs (a 49-minute match showing a 2-second window of ~0);
 *   * a PULSE bucket. `bots` (AI rehearsal) fires at the end of a prep turn and `serverRun` (takeover) only when a
 *     player is away — measured live: a room with bots=27 527 ms showed `sharePercent: 0` for that bucket, because
 *     27.5 s spread over a 49-minute match is 0.9 % and the WINDOW share rounded to 0.0. The filter dropped it.
 *
 * So the lifetime totals are listed FIRST (heaviest first, in ms — a bucket that spent 27 s is named even when this
 * window caught none of it), and the window's own rate follows. Neither number is invented: both come from
 * server/match/perf.js's cumulative counter, and the panel still only READS it (no call site changes — DEPLOY.md §8.2).
 *
 * TWO SHAPES, ONE RENDERER. `GET /api/admin/rooms` sends `buckets[k] = { ms, sharePercent }`, while
 * `GET /api/admin/overview` sends the SERVER-WIDE aggregate as flat numbers (`buckets[k] = 12345.6 ms`, and no
 * `matchUptimeSec` — there is no single match to time). Both shapes are read here, so the overview card's tooltip does
 * not silently degrade to an empty list; the figures it can carry are the ones that exist.
 */
function perfTip(perf) {
  const buckets = perf.buckets || {};
  /** One bucket's accumulated ms + window share, whichever shape the endpoint used. */
  const read = (k) => {
    const b = buckets[k];
    if (b && typeof b === 'object') return { ms: Number(b.ms) || 0, p: b.sharePercent };
    return { ms: Number(b) || 0, p: null };
  };
  const pick = (test) => Object.keys(BUCKET_LABELS)
    .map((k) => ({ k, ...read(k) }))
    .filter(test)
    .sort((a, b) => b.ms - a.ms);

  // Lifetime: every bucket that ever spent time, heaviest first, by its accumulated milliseconds.
  const life = pick((b) => b.ms > 0)
    .map((b) => `${t(BUCKET_LABELS[b.k])} ${shortMs(b.ms)}`)
    .join(' · ');
  // Window: the buckets that moved in this window, by their share — what the percentage on the cell is made of.
  // (The aggregate carries no per-window share, so this line is a dash there while the lifetime line still works.)
  const win = pick((b) => typeof b.p === 'number' && b.p > 0)
    .map((b) => t('perfBucket', { name: t(BUCKET_LABELS[b.k]), p: b.p.toFixed(1) }))
    .join(' · ');

  return t('perfTip', {
    w: perf.windowSec ?? 0,
    window: win || '—',
    lifetime: life || '—',
    ms: Math.round(perf.deltaMs ?? 0),
    total: Math.round(perf.totalMs ?? 0),
    // The per-room endpoint reports how long its match has run; the server-wide aggregate has no single match, so it
    // omits `matchUptimeSec` and this line is dropped rather than claiming "对局已跑约 0 分钟".
    uptime: Number.isFinite(Number(perf.matchUptimeSec)) ? t('perfUptime', { minutes: Math.round(Number(perf.matchUptimeSec) / 60) }) : '',
    frames: perf.frames ?? 0,
  });
}

/** Bucket id (the wire) → the string that names it (see PERF_BUCKETS in server/match/perf.js). */
const BUCKET_LABELS = {
  battle: 'bucketBattle',
  bots: 'bucketBots',
  verify: 'bucketVerify',
  serverRun: 'bucketServerRun',
  intents: 'bucketIntents',
  views: 'bucketViews',
  core: 'bucketCore',
};

/** One seat as a small tag: a bot, a player (name + ready/offline marks) or a free slot. */
function seatTag(seat) {
  if (!seat) return element('span', 'tag tag--free', t('seatFree'));
  const cls = seat.isBot ? 'tag tag--bot' : (seat.connected ? 'tag' : 'tag tag--off');
  const label = `${seat.name ?? seat.playerId ?? '—'}${seat.isBot ? ` · ${t('bot')}` : (seat.connected ? (seat.ready ? ' ✓' : '') : ` · ${t('disconnected')}`)}`;
  const tag = element('span', cls, label);
  // 地址只在悬停时出现（业主 2026-10-14）：列表里不留任何玩家的 IP，鼠标停在名字上才由**浏览器原生提示条**给出
  // （本面板对 性能消耗 用的就是这一手：td.title = perfTip(…)，见 renderRooms），点一下则把它填进下面的封禁框——
  // 地址在那里完整显示出来，由操作员亲眼确认后再提交。
  //
  // WHY the native tooltip and not a CSS reveal: `.table-wrap` is `overflow-x: auto`, which both clips an absolutely
  // positioned popover AND forces `overflow-y` to auto; and a CSS-revealed span would re-measure the seats column the
  // instant the pointer entered, so the hover target could move out from under the cursor. A title has neither
  // problem: no layout change at all, nothing to clip, and it cannot flicker.
  if (!seat.isBot && seat.addr) {
    tag.title = t('addrHint', { addr: seat.addr });
    tag.dataset.banAddr = seat.addr;
    tag.classList.add('tag--addr');
  }
  return tag;
}

/** 把一个地址填进封禁框（不提交）。列表里的地址从不常显，操作员在这里第一次完整看到它——并自己决定是否封。 */
function fillBanField(addr) {
  const input = $('ban-rule');
  if (!input || !addr) return;
  input.value = addr;
  input.focus();
  input.scrollIntoView?.({ block: 'center' });
  setBanStatus(t('banPrefilled', { addr }), 'ok');
}

/** Append new log lines (the endpoint is incremental through `since`), keeping the console bounded. */
function appendLogs(entries) {
  const console_ = $('log-console');
  const atBottom = console_.scrollHeight - console_.scrollTop <= console_.clientHeight + 40;
  const empty = console_.querySelector('.console__empty');
  if (empty) empty.remove();
  for (const entry of entries) {
    logCursor = Math.max(logCursor, Number(entry.at) || 0);
    const line = element('div', 'log');
    line.append(element('span', 'log__time', new Date(entry.at).toLocaleTimeString()));
    line.append(element('span', `log__level log__level--${entry.level}`, String(entry.level || 'info').toUpperCase()));
    line.append(element('span', 'log__msg', entry.message ?? ''));
    console_.append(line);
  }
  // The server ring holds 300 entries; keep the DOM from growing without bound over a long session.
  while (console_.childElementCount > 300) console_.firstElementChild.remove();
  if (atBottom) console_.scrollTop = console_.scrollHeight;
}

function resetConsole() {
  const console_ = $('log-console');
  console_.replaceChildren(element('div', 'console__empty', t('noLogs')));
  logCursor = 0;
}

function startPolling() {
  showLogin(false);
  resetConsole();
  poll();
  refreshAnnouncements();
  refreshUpdateNotes();
  if (!pollTimer) pollTimer = setInterval(poll, POLL_MS);
}

// ---------------------------------------------------------------------------------------------------
// wiring
// ---------------------------------------------------------------------------------------------------

$('login-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const candidate = $('token').value.trim();
  if (!candidate) return;
  const ok = await checkToken(candidate);
  $('login-error').hidden = ok;
  if (!ok) return;
  token = candidate;
  store.set(TOKEN_KEY, token);
  $('token').value = '';
  startPolling();
});

$('btn-logout').addEventListener('click', () => {
  store.remove(TOKEN_KEY);
  token = '';
  showLogin(true);
});

$('btn-lang').addEventListener('click', () => {
  lang = lang === 'en' ? 'zh' : 'en';
  store.set(LANG_KEY, lang);
  applyLang();
  if (lastOverview) renderOverview(lastOverview);
  if (lastLimits) renderLimits(lastLimits);
  resetConsole();
  refreshUpdateNotes(); // its section names / items are localized by the file itself
  poll();
});

applyLang();
wireAnnounce();
wireUpdateNotes();
wireBans();
wireLimits();
// No stored token → the login field; a stored one is probed first, because it may have been rotated on the server.
if (token) startPolling();
else showLogin(true);

// Test-only handles (test/admin-feedback.test.js, test/admin-update-notes.test.js). A `<script type="module">` ignores
// named exports, so exporting here costs the page nothing; it is what lets the suites drive these reconcilers against
// a DOM stand-in — the only way to assert "an open 诊断信息 survives a 2 s poll" and "a refresh never overwrites
// typing" without a browser.
export { renderFeedback, feedbackCard, renderNotes, syncNotesSize, renderRooms, perfCell, renderBans, banRow, renderSlots, slotCard, renderLimits };

