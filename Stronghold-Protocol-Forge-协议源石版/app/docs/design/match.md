# DESIGN §6, §16 — The match and meta engine (server/match), operator loadouts

Part of [DESIGN.md](../DESIGN.md) (the index; section numbers are global).

## 6. Match & meta (server/match)

### 6.1 State machine (Match.js)

```
LOBBY(room, whose SEAT COUNT is set when it is created — the host's slider at `room.create` picks 2…this server's ceiling (缺省 20, `DEFAULT_MAX_SEATS`; `SP_MAX_SEATS=4` puts it back on the official room — 业主裁令 2026-10-12), and the host may resize it afterwards with `room.setSeatCap` (docs/META.md §1.9a) as long as the new cap still holds everybody already in the room, so no occupant can ever be evicted and no seat index moves; a 4-seat room's frames are byte-for-byte the ones from before that feature) → INFO_CHECK (co-op 25 s; solo and any single-human match untimed (§18.2); all ready ⇒ skip; the operator loadout (§16) locks when it ends) → BAND_DRAFT (co-op: random order — the room option 「AI 队友最后选择」 (host, off by default; `room.setAiPicksLast`) puts every human seat before every AI seat, each group keeping the drawn order, and draws no extra random number; a skipping human goes behind the other humans still to pick and ahead of the AI seats, or to the very end when no other human remains [ASSUMED] —, ONE countdown — `BAND_TURN_SECONDS` 50 s per turn = m.public.deadline, AI seats pick at once, 1 skip each, **duplicates allowed** — `data/config.json bandDraft.duplicatesAllowed` true (the official rule and the default: two seats may take the same strategy; research 01 `_criticAddendum.bandDraft`, superseding research 09 §5's reading of the guidebook page), published as `m.public.draft.duplicatesAllowed`; with the switch off a strategy a teammate already took is refused (队友已选) and the automatic assignments hunt for a free one —, timeout ⇒ the strategy the player highlights (`g.bandFocus`) while allowed (and, switch off, free), else band_bldsk, else (switch off) the first free one; solo: free pick, no timer, no skip; a single human: untimed) → BATTLE_CHECK (3 s)
→ loop r = 1..lastRound:
     ROUND_START   (income, upgrade price −1 (floor 0), temp NOT wiped — what overflowed after the last prep's deadline is shown in this
                    prep (§6.2 temp overflow), unfrozen shop slots rerolled, frozen kept, <进入休整期时> effects;
                    破财消灾's debt (`ps.payoffDue`, booked by the previous round's 悬赏决策) is collected here, after the
                    income, as a real `spend()` — owner 2026-10-30, META §1.2)
     [SP_DRAFT]    (if r ∈ spRounds: 机变 draft; co-op: random order (「AI 队友最后选择」, off by default: humans first, the same partition as the strategy draft), 30 s first picker / 16 s others; solo 3 cards; solo / single human untimed;
                    a card is picked with two taps, §18.2; a 悬赏决策 round also offers 「破财消灾」 — a −1 pseudo index, once
                    per player, 1 资金, no card taken (META §1.2) — and its 1 资金 is charged at the NEXT round's start, not on
                    the pick, with no funds gate on the pick itself (业主 2026-10-30「扣1块钱是在下回合开始时扣」/「没钱也能选，
                    下回合从收入里扣」: `ps.payoffDue` → `settleSpPayoffs` in ROUND_START)
     PREP          (co-op: timer from config (else the infoCheck 25 s guard), ends when all alive humans+bots ready; solo: untimed, ends on ready; a single human in a co-op room is TIMED — the prep waits on that human's Ready and would otherwise stall, docs/PS100-MIGRATION.md §5. **修订 playtest #4 item 3**: that rule used to let the lone-human 同盟房 wait forever at this phase — the defect this timing removes; the `test/match/verification-slices.test.js` assertion that depended on that stall was retargeted to the accepted-result object, and a positive assertion added — docs/META.md §1)
     PREP_END      (<休整期结束时> effects; unfrozen shop cleared; Ready is blocked while a personal choice or temp overflow is pending;
                    at the deadline personal choices are auto-picked first, then
                    the temp pieces due at this prep are resolved (chess sold back, items destroyed, summon stacks removed — they come back at the next round start, §20.1) — pieces that arrived
                    after Ready or during the <休整期结束时> effects wait for the next prep (§6.2 tempDue))
     COMBAT        (one Battle per alive player, all in parallel, 2×; watchers get snapshots; solo: pausable, §14 Solo pause)
     UNITE         (co-op only, if ≥1 leaked & ≥1 perfect: ≤2 perfect helpers in `unite.js helperOrder` order (research 08 §5 / PRTS 帮助:
                    most units on the field > an active bond > most standing units > seat; the pair ordered by units > active bond >
                    Σ active layers > standing > seat, the first one on the right-hand field) fight the union of leaks; no layer gains — with
                    the layers their own combat reached (the round's pending gains, PRTS "以其阵地当前的状态" [ASSUMED]);
                    a helper's operator knocked out at the end of its own combat enters down — carryState { down: true },
                    PRTS "上一阶段为退场状态的干员强制退场", its full redeploy timer — confirmed by the user (§19.3))
     SETTLE        (LP −min(leaks,10) per player (unite survivors to their source); eliminations; layer gains applied; coins; broadcast;
                    after a 联防 the outcome and every player's charge ride the SETTLE m.public as `uniteResult`, GitHub #235)
   R14 FINAL_ASSAULT (merged team LP; pairs by seat; shared boss pool; 120 real s countdown, no hard stop; overtime −1 team LP per
                    real s after 120 real s, or 150 with an AI teammate at fight start (§31.1, m.public.overtimeAt); no layer gains; team LP 0 ⇒ defeat at once (PRTS 直接失败),
                    pool 0 ⇒ victory — the first end the server registers decides, §20.5)
   R15 HIDDEN_CORE  (if difficulty ≥ NORMAL and Σ activated layers > 350 solo / 1200 co-op and team LP > 1)
   R16 木桩演练    (only after the Hidden Core was CLEARED, and only in a mode with `dummyRound` — the six NORMAL+ ones;
                    owner 2026-10-29「增加16回合，加一个“木桩”让玩家看看自己的输出」. A NORMAL-template round
                    (`custom_dummy`, 60 real s) whose wave builds exactly one 木桩: it neither moves nor fights back and
                    heals itself, so the players read their own output on a fixed window. It is NOT a rule round — it
                    pays no reward, moves no `roundsPassed`, has no shared pool and no 限伤 (the post's spawn carries no
                    `boss` tag) — so `_finishFinal` starts it and `afterSettle` ends the match when it settles)
→ RESULT (per-player stats, titles, rounds passed, victory/defeat)
```
Solo FUNNY has 9 rounds (boss at R9); everything is read from `data/config.json → modes[modeId]`.

**The 木桩演练 round (R16)** exists because the owner wanted a way to see one's own output. Two properties follow from that
and are worth stating, because they are what make the numbers readable:

- *played from the boss deploy field* (owner 2026-10-30「16回合没有设置成boss回合，导致地图有问题」): the round registers the
  players into `bossWaves` (`phases.js _planDummyField`) so `deployFieldOf` hands out `bossL` / `bossR` and the post stands
  on the official leader route — but the FIGHT stays a normal `PHASE.COMBAT` one: no shared pool (its `bloodPoint` would
  override the post's HP), no `BOSS_HIT_LIMIT` 限伤 (300 000 — it cancels a big hit whole and would eat exactly what this
  round measures), no overtime LP drain.
- *a measuring device, not an enemy*: `enemy_9901_dummy` is `enemy_9033_acdeer` (“萨米的意志”) cloned with `atk` 0,
  `moveSpeed` 0, `lpr` 0, `def`/`res` **0**, a **20 亿** (2 000 000 000) HP pool that regenerates **20 亿/s** and **锁血**
  (owner 2026-10-31「修改木桩至20亿血，加上每秒回20亿和锁血」). The three numbers go together: a 20 亿 pool *can* be exceeded by
  one burst, so the post survives on 自愈 (one whole bar per second — any hit is undone on the next tick) plus the lock
  (the kit's `fatal` hook keeps it on 1 HP instead of dying) rather than on pool size, which is what the 2026-10-30
  325 亿 pool did. 锁血 does not skew the reading: damage is counted as HP actually removed, so a hit that lands while
  locked still reads as the whole hit (an 无敌 buff would read 0 and defeat the round's purpose). The unarmoured target is
  the point — `max(A − D, 5 %·A)` would floor every low-ATK operator at 5 % against 萨米's own 800 DEF, and the reading
  would be “output vs an 800-DEF target” rather than the operator's own (docs/DATA.md "The training post").
- *readable while it runs*: the in-battle 伤害统计 panel carries a 秒伤 (DPS) column — damage dealt ÷ the seconds the
  battle on screen has run (`public/js/ui/damageReport.js`; the panel itself stays a pure view and takes `elapsed` from the
  game screen's battle clock) — and the panel opens itself, frozen, once when this round settles. The dummy round and that
  panel are the only parts of the game that do this; every other round's report is opened by the player.

### 6.2 Player state (PlayerState.js) — authoritative per player

```js
{ playerId, seat, name, isBot, connected,
  alive, lp, bandId,
  funds, shop: { level, upgradePrice, slots: [ Slot ], frozen: bool, freeRefreshes: n, freeBuyWindow: n, rewardOffer: null | { tier, source:'merge'|'special', label, queued, slots:[Slot] } },  // a special offer (凯瑟琳's 定向投放 …) by its source's label; queued = offers behind the shown one (§21.2)
  hand: [ Piece|null ×10 ], temp: [ Piece|null ×5 ],
  board: Map<'r,c', Piece>,                          // chess & token pieces on the normal field
  bonds: { [bondId]: { count, active, tier, layers } },  // layers persist all match
  effects: [ EffectRef ],                             // band/choice/team/garrison persistent effects & counters
  personalChoice: null | { id, round, sourceItemId, cards: [ BountyCard ] }, // private PREP offer; raw cards on the server
  counters: { refreshes, buys, sells, … },
  stats: { … for results } }
Slot  = { kind:'chess'|'item', id, price, sold:false, frozen }
Piece = { uid, kind:'chess'|'item'|'token', id /* chessId (golden id if elite) | itemId | tokenId */,
          items:[itemPiece...] (chess only, max 2), count (token stacks), ownerUid (tokens), boughtRound,
          meta: { round?: { r, n: { key: count } } } }   // per-piece counters of the current round, module-prefixed keys (拉普兰德's first refresh, §21.1)
```

Intent handlers (validate → mutate → recompute bonds → push private view): `buy(slot)`, `refresh()`, `freeze()`, `levelUp()`, `sell(uid)`, `move(uid, to)`, `equip(itemUid, targetUid, replaceUid?)`, `useArt(itemUid, row, col)`, `destroy(uid)`, `pickReward(idx)`, `pickChoice(idx)`, `setReady(bool)`. Every handler rejects when the phase forbids it (only PREP allows board/shop mutations; SP_DRAFT allows `pickChoice` only; reward pick allowed in PREP). Invalid intents return `error` with a code from `shared/constants.js → ERR` — the server never throws on bad input.

Summons (§20.1): an operator on the board sends its manually deployable summons to the hand — deploy-limit copies in one stack, no deploy slot (tokens.json `placeable`, `gamedata.placeableTokens`); moving or swapping it sends its placed summons back to their stack, withdrawing or selling it removes them. A range-bound summon (tokens.json `ownerRange`: 狼群, 流形) goes only on a tile of its owner's attack range (`PlayerState._legal` / `summonRange`); in a swap each piece is checked from the tile it ends on; an in-place re-orientation or promotion that leaves it outside sends it back to its stack with a toast (one still inside stays [ASSUMED], user-confirmed 2026-10-03), and a re-orientation whose lifted summon would have no room is refused with `HAND_FULL`; on the other paths it leaves the board and returns at the next round start (§21.3).

Equipment (research 04 §2 + addendum, 09 §1.2): 2 slots per chess; a third item on a full carrier replaces the equipped item `replaceUid` names (the replace dialog's pick, official `UseEquipUp.unloadInstId`; absent ⇒ the oldest; a uid not equipped on the target ⇒ `BAD_TARGET`, nothing changes) and the replaced item is destroyed. A consume-on-equip item (盟约之币, 博士投影 …) on a full carrier replaces the same way before it resolves, so the carrier is left with a free slot (the normal 博士投影 takes it until the next round start); a target its effect refuses (博士投影 on an elite) keeps both items — PRTS 卫戍协议/帮助 "达到上限强行佩戴会改为替换装备" names no exception (GitHub #263; the client opens the replace dialog for it, `equipReplaces`). Equipped items are otherwise **locked**: `destroy` (销毁) accepts hand / temp items only (`BAD_TARGET 'equipped items are locked'`); equipment goes back to the hand only when its carrier merges, is sold, or is destroyed by 突变细胞's transformation (the cell itself returns too; PRTS 帮助 "在失去该干员（干员出售、销毁、合并等）…时自动卸除", §21.1) — a sale is refused with `HAND_FULL` when there is no room for it; returned equipment is stowed before the operator a transformation gains and before a merge elite's summon cards, and every path that hands the player an item — returned equipment included — ends with the auto-merge, so no player holds two identical mergeable normal items (§21.7).

Economy/shop/pool/merge/hand rules: exactly as research 00-INDEX §3–§4 (income `min(3+r,12)`; prices by tier; refresh 1; freeze toggles all; sell +1; items not sellable; upgrade prices per mode with −1/round; single-player pool copies 12/14/18/16/8/5 plus measured exceptions; co-op shared operators use twice those counts, while equipment has separate shared stock (DESIGN §31.8); elite = 3 copies; odds = copy-weighted draw over unbanned visible chess with tier ≤ level; merge 3 (风丸 2) → elite onto the consumed deployed copy's tile, else to the hand (§20.11) + reward offer of 3 **different** free chess of tier `min(level+1, 6)` (copy-weighted; a tier short of different chess tops up from the tier below [ASSUMED], §20.6); full hand blocks every buy / reward pick, a merge-completing one too (PRTS 卫戍协议/帮助 §手牌区, GitHub #82); overflow to temp; a free hand slot pulls the temp pieces back in at once, right → left (`PlayerState._fillHandFromTemp`); temp blocks ready).

**N19 的负面：一回合获得的资金上限（业主 2026-10-29「增加限制玩家一回合最多获得30块」→「把这个负面做成 n19」）.** 这条规则**属于协议等级 19**（表里那一行的 `fundsGainCap: 30`）：0–18 级、其它难度、以及关了等级的每一局都是 0 = 不设上限，从前的经济逐字节不变。口径按业主同一次追问的两个选择定：**所有正收益都算** —— 回合开始的收入（含上回合结转的首领金币 `pendingFunds`）、协议源石 / 盟约 / 装备 / 策略的发放、卖出返还、债务还款，全部计入同一个额度；超出的部分**直接作废**、不结转下回合，并在第一次被削时给本人一条 toast（每回合最多一条，四语都翻了）。执行点只有一个：`PlayerState.addFunds`（`server/match/player/economy.js`）—— 全游戏的钱都从那个原语进（内容层也走 `effectsMeta` 的 `ctx.addFunds` → 它），所以没有能绕过去的路；计数器是 `ps.round.fundsGained`，`startRound` 用它之前先清零，于是「一回合」= 一次回合开始到下一次。负数 `addFunds`（刚扣掉又退回来的付款、对外还的债）把额度**还回来**：那只还回钱包里真正少掉的那部分，「先付再退」的一对因此不占额度；而 `spend()` 真正花掉的钱不还。`force: true` = 不是「获得」：跳过上限、也不计数 —— 测试场自己的工具钱（`g.testFunds`、`g.testBoss` 的起步资金）与只把钱挪去立刻花掉的内部过路（天人形态的免费升级）用它。回归：`test/match/funds-cap.test.js`（19 级生效 / 18 级与关等级不生效 / toast / 卖出 / 退款 / force）。

**Temp overflow (临时整备区, row 8; user playtest #3 item 3).** Passive gains that find the hand full (merge elites, grants — the operator a 突变细胞 transformation gains included, §21.1 —, battle-result rewards, equipment returned by a merged / sold / transformed carrier) overflow into the 5 temp slots, and Ready is refused while any is occupied (official "直到溢出情况排除才可开始进行作战"). A temp piece is resolved — a chess sold back to the pool with its summons removed, items destroyed, a summon stack removed (it comes back at the next round start, PRTS "干员所属召唤物会于下一回合返还", §20.1) — only at the deadline of the **first prep in which its player could act on it** (`PlayerState.tempDue(piece)` vs `prepsEnded`; every write into a temp slot goes through `_putTemp`, which records it): a piece that arrived during a prep before Ready is due at that prep's end; one that arrived after Ready or during the `<休整期结束时>` effects, or outside PREP (COMBAT, 联防, SETTLE — battle-result grants, a SETTLE merge's elite, returned equipment —, the next ROUND_START, 机变) is kept, visible and usable (move to a free hand slot, place, equip, use, destroy, sell) through the **next** prep. Un-readying (`setReady(false)`) makes whatever arrived while ready due at the current prep. ROUND_START no longer wipes temp (it used to destroy what SETTLE had put there before the player ever saw it). A merge's elite whose merge consumed a deployed copy takes that copy's tile and facing (§20.11); otherwise it goes to the hand, overflowing into temp (also outside PREP). `server/match/audit.js` (`tools/matchrun.mjs --check`) tracks the arrivals itself and flags any temp piece that outlives its due prep. The UI frames the row on the board with the rule (§17.5).

Pointing Stick creates at most one pending offer per alive, non-Ready player in PREP. The owner confirms it with
`g.choice { idx, choiceId }`; confirmation validates its ID, round and index, adds one bounty and clears the offer.
Ready requires no pending offer as well as an empty temp area. The co-op prep deadline resolves the offer randomly
before resolving temp and setting Ready; untimed solo / single-human prep does not schedule a separate choice timer.
The offer is recipient-private, including after reconnect, and never enters `m.public.sp` or a teammate's scout view.

### 6.3 Bonds & layers (bondsMeta.js)

- `count` = number of **distinct base chess** on the board carrying the bond (`BOARD`); `BOARD_AND_DECK` bonds also count the hand; 绝技 counts elites on board; 调和 adds +1 to each core bond count that has a real member on the board (the views mark such an entry `harmony: 1`, §21.26), etc. (research 02).
- 变形同构体: an operator wearing it together with an item that has a `giveBondId` is a member of that bond — counted like any member (BOARD: on the board only; once per operator), in the battle, and in the client's member list (tagged 同构) and bond chips (§21.11). A fused 百变 (锻炉) counts as wearing both items it swallowed: every reader expands the piece's `merged: [idA, idB]` through `shared/morph.js itemRecs`, so the pairing survives the fusion while the 百变 still uses one equipment slot.
- `tier` from thresholds; `active = tier ≥ 1`.
- `layers[bondId]` persist all match; gains come from garrisons/bands/items/choices/bond effects; IN_BATTLE gains are collected from `BattleResult.layerGains` at SETTLE (disabled in unite/boss/hidden — except a 【突破极限】 owner in 联防, whose gains the unite spec turns on per player via `flags.layerGainsByPlayer`; 业主 2026-11-01).
- Layer milestones (维多利亚's 维式重锤 every 25, 远见's funds every 10 and its 80 / 150 discounts, 奇迹's funds every 100) pay only while the bond is active; those owed for layers gained while it was off pay as soon as it lights up — `PlayerState.recompute` dispatches `onActiveBonds` whenever the set of active bonds changes, so placing the third 维多利亚 member in prep grants the hammer at once (the maintainer's report of the official game, 2026-10-15; §34.14.31). Each milestone pays once, however often the bond goes off and on.
- A bond holds at most `BOND_LAYER_CAP` = 999 layers (the client's `MAX_GARRISON_STACK`, §20.12): every writer — `PlayerState.addLayers`, the SETTLE merge, `Battle.addLayers`, the dev tools — adds `layerGainRoom(before, n)` = min(n, 999 − before); a gain at the cap adds 0 and dispatches nothing (no onLayers, no `layerGain` hook, no 'layer' event), so the per-N milestones stop with the count.
- Σ activated layers (hidden-core check) = Σ layers over bonds that are active at the moment of the check (end of R14 prep, per research).

### 6.4 Prep-phase effect dispatcher (effectsMeta.js)

A registry mapping **effect keys** → handler objects `{ onRoundStart, onPrepEnd, onGain(piece), onSold(piece), onRefresh, onPrice(slot), onBuy, onMerge, onLevelUp, onBattleResult }`. Sources: garrison `SERVER_*` keys (per chess on board or hand as the key requires), band effects, item meta effects, bond meta effects (助力, 远见, 奇迹, 投资人…), choice/team cards. Content owners register handlers; the dispatcher owns ordering and the 投资人 "获得时 ×2/×3" multiplier, and only while that bond is active (标准 lists `investShip` inactive; copies of one investor are one member — §34.14.8). 娜仁图亚 见者有份 draws `pool_equip_narant` with no tier cap: every shop-eligible equip, uniform [ASSUMED] (§34.14.8). `onBuy` = a shop purchase (`g.buy`) only: a free pick or a grant never counts as 购买 (休露丝, 玛恩纳, 升华, 整备; §21.21). Equipped items run from a snapshot — the owned chess and each holder's items as that step begins (every [holder, item] pair, taken before the first item runs) — each only while it is still equipped on its still-owned holder (handlers move and destroy pieces: 突变细胞, 博士投影; §21.25).

### 6.5 Waves (waves.js)

Per match: pick stage (weighted among the mode's `config.modes[m].stages`, weight 50 each: 标准 FUNNY = 战场#01 `act1autochess_m01` only, 险境 NORMAL = 8 stages, 绝境 / 终极 = 7 without 战场#01 — `waves.js setupMatchWaves`, `test/match/stagepick.test.js`), 3 of 6 typed enemy factions, disabled bond set (3 core + 4 add-on for NORMAL+, per research), boss (weighted), hidden boss. Per round: wave template (by mode & round) → replace placeholders per research 05 §3.2 algorithm → apply stat multipliers (research 00-INDEX §5 `atk ×base×1.1^k`, `hp ×base×1.2^k`, ABYSS speed ×1.15 from R3) → `SpawnSpec[]` + routes resolved on the stage. *(Superseded by the official generator — §14 "Corrections from research 08/09" and the waves.js header.)* A player's normal battle (and the bot rehearsal) runs `withBounties(gd, round, wave, bounties, playerId)`: the bounty units inserted among their host action's own units, which are re-timed around them (client order); `previewOf` keeps one entry per action (`wave.spawns` + `bountySpawns`).

### 6.6 AI players (bot.js)

After the greedy layout is complete, `planLayoutSteps` rechecks self-range guards on enemy-road tiles. An isolated
guard may move to a free legal road tile with allied damage covering both it and the preceding tile of every incoming
ground route. Different routes may have different supporting allies. The exposure score must not decrease [ASSUMED],
regardless of seat count. Supported guards and guards without such an alternative keep their positions.
These placement assumptions are tracked in [issue #315](https://github.com/sganggs/Stronghold-Protocol/issues/315).

[ASSUMED] Blocking medics prefer legal tiles outside the enemy road, then road tiles supported by allied damage,
then any legal fallback when neither exists (#577). The supported-road test is the same as the guard repair above:
every incoming ground route needs an ally covering both the medic's tile and its preceding contact tile; different
routes may use different allies, and healing never counts as fire support. Within each preference group the existing
exposure score chooses the tile. On boss rounds (no rehearsal), wider healing ranges are placed first; equal exposure
scores prefer estimated allied DPS **not already covered by a previously placed medic**, before the tile-noise tie-break.

[ASSUMED] Purchase scores within `1e-9` tie in favour of the cheaper offer; genuine score advantages still win.
Pre-emptive hand shedding only sells when the owned operator count exceeds the deploy cap. Lineup evaluation counts
BOARD_AND_DECK members withdrawn from the board only while hand slots remain, in the same order as arrangement
(withdrawals before deployments). A purchase reserves its own hand slot first; members forced to be sold do not count.

[ASSUMED] Layout rehearsals use normal battle inputs and the normal field seed, including battle-start effects,
enemy replacements, teammate effects and in-battle layer gains. Each candidate uses an independent copy of the current
meta RNG. Candidate boards and events are detached; preview contexts expose copied reads and no-op state writers,
including contexts reached through teammates/player. A separate dispatcher owns the preview script budget and drops
preview errors; no live script quota, diagnostics or settlement is affected. Actual starts retain the original RNG
and dispatch. Rehearsals estimate current prep state, not later prep actions or other players' random choices.
These three bot policies are tracked in [issue #315](https://github.com/sganggs/Stronghold-Protocol/issues/315);
combat blocking, healing and damage rules are unchanged.

Pending Pointing Stick offers use the existing bounty scorer at bot prep entry, immediately after a successful cast,
and before Ready. The prep's deadline — and the scheduler's fallback when a step of a bot's prep fails — randomly resolves any remaining offer before temp and Ready; a seat that left is eliminated and its offer dropped.

Deterministic-ish heuristic player used for (a) AI teammates, (b) auto-play for disconnected humans (only auto-ready + auto-picks, not shopping, unless "AI 托管" is toggled), (c) tests. Strategy (§21.6): pick a band (weighted by starting LP; never one built around a bond the mode switches off — `gd.bandBondIds`, §21.26); each prep: take offers, sell dead bench weight, fill the board, complete affordable merges, level on the curve, then buy only merge progress / lineup upgrades worth more than the refreshes their price would buy (shop odds of completing held pairs), freeze for an unaffordable third copy (坎诺特 keeps 5 funds back); build around a committed focus core bond (a teammate's main bond on its strip counts against it; bonds the mode switches off never) + a second bond; value dealers by DPS vs the round's DEF / RES (an attack on every enemy in range counts double — 阵法术师 / 轰击术师), with the range the unit is deployed with; place by the exposure model + rehearsal on the server's deploy map (no 深水区; a blocker whose range is its own tile only — range 0-1 — takes a free tile of the enemy road first; a tactician's 援军 within `PlayerState.summonRange`; a melee chess whose trait reads 「可以放置于远程位」 (钩索师 / 推击手) on a 高台 whose range covers the enemy road, else on the ground, counted as a blocker in the lineup either way — §3; `g.move` judges legality); items by effect (META §1.5: 突变细胞 on the least valuable normal single below 6阶, a cell left in temp gets a hand slot made for it, the operator its transformation gains is deployed by the next prep's lineup step like any owned unit — AI 托管 too; the buy loop's bench shed never sells a piece gained since the bot's last prep, §21.1); 机变 bounties by expected payout − expected LP loss over the offered cards; resolve temp — on a human seat under AI 托管 never by destroying an item while a bench operator can be sold for the slot —; ready. A bot's whole prep — shop decisions and layout planning (`botPrepBeginSteps`, 25–70 ms late in a 4-bot match), the layout rehearsal and `botPrepEndSteps` — runs in wall-clock slices of `botSliceMs` (8 ms) per scheduler callback on a real host (step generators that yield between whole actions, never with a transient board; the same actions in the same order, so decisions are unchanged; at once in virtual time). Under AI 托管 a human's own 自选 pieces score `DIY_PIECE_BONUS` (12) more in the shop / reward choice and the 调度中心 is levelled one round earlier for the step that opens a slotted tier (`levelUp`, `diyOpensAt`; 0.2.0 — bots field no 自选 piece).

---

## 16. Operator loadout: skill & module selection (v2.1, user playtest #1)

Official rule (bwiki 盟约, 更新公告 5114): before a match the player cannot change an operator's tier, but can change the **equipped skill and module** of each chess; some non-default choices are stronger. Scope in the remake (no accounts ⇒ everything the chess's status unlocks is selectable):
- **Skills:** any skill unlocked at the chess's status (`evolvePhase`: E1 ⇒ S1–S2, E2 ⇒ S1–S3) at the chess's skill level (normal Lv4, elite Lv7). Default = `defaultSkillIndex`.
- **Modules:** only matter for the elite (golden) chess (`equipLevel` 1, or 3 at T6): any module of that character (or none); default = `defaultUniEquipId`. Normal chess have no module (equipLevel 0).

**Data (`data/chess.json`, built by tools/build-data.mjs):** every chess keeps `skill` (the default, unchanged shape) and gains `skills: [SkillRecord…]` (index, skillId, iconId, name, desc/descRaw, skillType, durationType, duration, spType, spCost, initSp, maxChargeTime, bb (at the chess's skill level), bbStr, rangeGrid, trigger {rule, customRangeGrid} resolved for THAT skill index, isDefault). Golden chess gain `modules: [ModuleRecord…]` = `{ uniEquipId, name, typeName, icon, isDefault, attr: {maxHp, atk, def, res, aspd, cost, blockCnt, respawnTime…} (flat adds at the chess's equipLevel), traitOverride: {desc, descRaw, bb} | null, talentChanges: [{talentIndex, name, desc, bb}] }` plus `statsBase` (stats WITHOUT any module); `stats` stays = stats with the default module (back-compat).

**Loadout wire & state:** the client keeps a per-browser loadout `{ [baseChessId]: { skill: index, module: uniEquipId | 'none' } }` (localStorage) and sends it with C2S `room.loadout { entries }` (validated: known visible chess, legal skill index for that chess's normal AND elite status, legal module id). The lobby stores it on the seat; at match start `Match` receives `seats[].loadout`; `PlayerState` keeps it immutable for the match; board pieces are resolved to `{chessId, skillIndex, moduleId}` when building `PlayerBattleInput.units[]` (fields `skillIndex`, `moduleId`; BattleSpec carries them). Bots use defaults. m.private exposes the effective loadout so the UI (shop cards, detail panel) shows the chosen skill/module.

**潜能 / 练度 (0.2.2, the owner's decision of 2026-10-08: 「调配干员里自己设置吧，默认满潜满加成」):** official — an operator fights at the player's own potential (调度手册 「卫戍协议中干员潜能由自身已持有干员潜能决定」; an unowned 特许 operator at potential 1) and an owned operator of the same name gets the 自持有 练度 bonus (activity_table `cultivateEffectList`: 未精英化 +0 %, 精英1 ATK / DEF +5 %, 精英2 ATK +10 % DEF / HP +5 %, 精英2 Lv.60 +10 % each — a multiplier of its own, never summed with the 直接乘算 bonuses). The 干员调配 screen sets both per operator (by charId: initial, elite and 自选 forms share them; default 潜能 6 and 精英2 Lv.60); they travel as `room.loadout.ops` (`{ [charId]: { potential, cultivate } }`, defaults dropped; shared/protocol.js `checkLoadoutOps`, strict like the entries), `seats[].ops` → `PlayerState.ops` (re-checked; bots none = the defaults), and every operator the player owns states them in its `PlayerBattleInput` entry (`potential`, `cultivate`; shared/potential.js `cultivationOf`) — never a 补位 stand-in (a not-owned NORMAL chess) or a prototype 自选 pick. The sim composes the def at the potential (data/*.json carry every potential, DATA.md §2.3; the summons' talents at the owner's) and multiplies ATK / DEF / max HP by the tier's `char_attribute_mul` (effects.json `aceffect_char_1…4`, SIM.md §12). The cards (局内数值, shop and detail cards, a teammate's unit from UnitInfo `potential` / `cultivate`) show the numbers at the settings.

**Sim:** `simdata` resolves a unit def for `(chessId, skillIndex, moduleId)` (cached): `skill` = the selected SkillRecord; stats = `statsBase` + module attr (elite) ; trait/talents = base with the selected module's overrides. Kit contract (backward compatible): a kit function `(bb, chess) => { skill?, skills?: { [skillId]: SkillSpec }, talents, trait }` receives `chess.skill` = the **selected** skill and `bb` = its blackboard; the loader uses `skills[selectedSkillId]` if present, else `skill` only when the selected skill is the chess's default, else the **generic** skill spec — talents/trait from the kit always apply. Every visible chess must get hand-authored specs for all of its selectable skills (tracked by a coverage test).

**UI:** a 干员调配 screen reachable from the lobby, room and briefing (INFO_CHECK): the roster is one list, a row per operator with aligned columns under a head row — portrait / name / bonds (opens the detail), the skills and the elite's modules to tap (不装备 first; the quick choices of PR #301 by @farridge, laid out as one list instead of its three columns of cards, the owner's call of 2026-10-08), the 潜能 / 练度 selects (`screens/loadout.js RosterRow`, `screens/cultivation.js`); the detail beside it (below 1000 px wide it slides over the list, a quick choice keeps the list) opens with the 潜能与练度 section (潜能 1–6, the four official 练度 tiers with their effect texts); the detail then shows the operator's 特质 — the in-match `GarrisonBlock` / RichText of the form its 普通 / 精锐 skill toggle shows, triggers such as 「<进入休整期时>」 kept (0.2.2, PR #301 by @farridge); filter by tier/bond/class, per chess choose skill (icon, name, SP info, desc at Lv4 and Lv7) and elite module (official type icon from the local-client art when extracted (§13), else a lettered tile; name/type, stat bonus, trait/talent changes), 恢复默认, persisted; a 局内数值 section between the skills and the modules (普通 / 精锐 toggle, 精锐 first) draws the detail card's own stats block, 特性 and 天赋 for the chosen skill / module (§22.16); the chosen skill/module shown on shop cards and in the detail panel (a teammate's unit — 前往查看 in prep, 联防 / 最终攻势 fields, an observed battle — shows **its owner's** skill/module from its UnitInfo `skillIndex` / `moduleId`, `gameLogic.js unitLoadout`) — which also shows the stats, 特性, talents and attack range the unit fights with (`shared/loadoutRecord.js` `loadoutRecord` / `attackRangeGrid`, the same composition the sim's `getChess(id, loadout)` uses; the deploy wheel's range preview too) — the range it is deployed with: a selected passive range skill (引星棘刺 S3 3-9) and the 特性's permanent 攻击距离 (信仰搅拌机 SPT-Y +1) included, over all 1284 loadouts equal to the battle's range at deployment; in battle and prep the card draws the live `range` (§21.16). In battle the renderer plays the equipped skill's own Spine clip and ON_SKILL_START sound (`UnitInfo.skillIndex`; `data/assets.json` lists icons, clips and sounds for every skill index).

**导出 / 导入 a loadout:** 导出 hands the current loadout out as a versioned envelope `{ kind: 'stronghold.loadout', v, exportedAt, count, entries, ops }` (`ops`: the 潜能 / 练度 settings, 0.2.2 — an import without them leaves the current settings alone) — copied through `ui/clipboard.js copyText` or downloaded as a file. 导入 accepts that envelope, the stored `{ v, entries }` form and a bare `{ [chessId]: { skill, module } }` map (serialised text too), and refuses another tool's `kind`, junk, an empty result and a **newer** `v` (`parseImport` — a newer payload is never mis-read). Both go through `loadoutSync.applyLoadoutEntries` → `sanitizeEntries`, so a preset from another build never sends the server an entry it would refuse, an import that keeps nothing changes nothing, and the result is reported as N imported / M not (`ui/loadoutModel.js`, `screens/loadout.js`).
**干员持有 (0.2.0 补位):** the overlay's second tab marks operators as not owned (the 55 NORMAL chess; per-browser `sp.pref.ownership` = `{ v, notOwned }`, synced as `room.ownership { notOwned }` by the same sync engine as the loadout, `ui/loadoutSync.js installPrefSync`; 导出 / 导入 as `{ kind: 'stronghold.ownership', v, exportedAt, count, notOwned }`). A not-owned chess fights as its official stand-in with the backup skill / module — the loadout never applies to it ("对于补位干员其技能不可更改") — and is shown as the stand-in wherever the player's copy appears (shop / reward cards, hand and 临时整备区, board, detail card, result lineup, a teammate's scouting and bond popups: portrait, name, model, with a small 「替补」 mark; the owner's recall of the official mode, 2026-10-06), while its bonds, 特质, tier, price and merge stay the chess's; the 0.2.0 补位 design subsections have the rules and sources.
**自选编队 (0.2.0):** the overlay's third tab fills the four DIY slots (5阶 ×2, 6阶 ×2) with an owned 6★ outside the chess pool (any of its three skills, any module of its elite form but a 集成战略 one) or a prototype (its locked skill / module); only operators with a kit are offered (`welcome.diyKitted`). Per-browser `sp.pref.diy` = `{ v, picks }`, synced as `room.diy { picks }` by the same sync engine; 导出 / 导入 as `{ kind: 'stronghold.diy', v, exportedAt, count, picks }` (`ui/diyModel.js`, `screens/diy.js`). In the match a slotted piece is the operator for its player (name, art, class, bonds from its factions, no 特质, the pick's skill and module; the slot's tier, price and merge), sold only in that player's shop from the slot's 调度中心 level with its own stock; the shop / reward / detail cards and the own pieces carry a 「自选」 badge (`ui/gameLogic/diy.js`); the 0.2.0 自选编队 design subsection has the rules and sources.

---

### Cooperative buying, reactions and opening rerolls (§28.15–16, §28.21)

[ASSUMED] Bot purchasing applies one soft 18-point penalty to non-elite, non-DIY tier V/VI shared-pool cards whose
active bonds overlap another living teammate's opening strategy. Human and AI teammates are treated equally; it
neither reserves stock nor prevents a stronger purchase. Existing strategy presets and rehearsal counts are unchanged.

[ASSUMED] AI reactions are cosmetic social choices, enabled by default and disabled with `SP_BOT_EMOTES=0`. Only
mixed human/AI matches emit them, through the existing whitelist and cooldown. A human emote gets at most one eligible
bot reply. Settlement uses that round's results (kills then damage, stable seat tie-break), once per round; the third
chess merge reacts once and resets at settlement. Gifts are classified by trusted source playerId, never display name.
These hooks consume no gameplay RNG and schedule no game actions.

[ASSUMED] During INFO_CHECK the host alone may reroll the opening (业主 2026-10-30); no other player votes or has to
agree. The request carries the `setupRevision` the host saw, so a stale briefing cannot overwrite a newer opening. It
also preserves the room, seats, settings and connections, redraws the complete opening, resets every human's Ready, and
starts the full original timer (single-human matches remain untimed). Fixed stage/bans remain fixed and random results
can repeat. A separate seed-derived stream leaves shop/draft RNG untouched; requests have a 300 ms anti-burst guard and
are refused outside INFO_CHECK. All new setup data and player DIY stocks are prepared before mutation; data
preparation failure leaves the old opening intact, and a queued all-ready transition is cancelled only once the new
opening is ready. A disconnected or autoplaying human does not block the host, and a reconnect receives the new setup.
The client asks the host for one local confirmation, which is not a vote. This is a remake convenience, not an official
mode rule. Unrelated result-screen changes from PR #408 are not included.

The shared DIY detail preview (stats, range, trait, talents, potential, cultivation and matching normal/elite skill descriptions) follows roster loadout resolution. Jessica shield placement is limited to her four orthogonal neighbors. The two Ptilopsis prep-gift copy exceptions are defined in §31.3 and META; no generic change to all copied conditions is implied.


## 协议等级 1–19（2026-10-18；19 级 2026-10-29，业主裁定）

**叠加在「终极模拟」之上的一条数值难度轴，`0` = 关闭。** 它不是第 5 个模式：四个难度是四份不同的官方数据
（回合表 / 敌池 / 盟约集合 / 首领回合），各做 19 份 = 76 套数据，不可维护。等级只折进引擎**已有**的读取点。

- **口径**：只有 `difficulty === 'ABYSS'` 能开 1–19；其他难度上服务端归一化为 0。`0` 时引擎逐字节不变
  （golden 不移动）。13–18 已用 `tools/balance.mjs --level` 量过一轮（docs/BALANCE.md §8），与 1–12 同一条
  单调曲线（生命/攻击逐级升；数量、漏怪、收入惩罚、首领池、额外敌方源石在 13–18 都不回头）。**19 级的敌方数值
  没量过**（`[ASSUMED]`，沿 18 级的增量再抬一格）：业主 2026-10-29 点名的是它的**负面**，不是它的数值。
- **表**：`shared/protocolLevels.js`。每级只动 1–2 个玩家能感知的量，乘法曲线，每 3 级一个拐点：
  1–6 敌方生命/攻击；7–12 追加防御/法抗、漏怪 LP、每波数量、收入；13–19 首领池、额外敌方协议源石、收入惩罚。
- **19 级 = 18 级 + 一个负面**（业主 2026-10-29「把这个负面做成 n19」）：多出来的那一格是行里的 `fundsGainCap: 30` ——
  **一回合最多获得 30 资金，超出的部分作废**（完整口径与唯一的执行点 `PlayerState.addFunds` 见上面 §6.2 经济那段）。
  它是**唯一**带这一格的等级；0–18 级、其它难度、以及关了等级的每一局都是 0 = 不设上限，从前的经济逐字节不变。
  18 级起有的东西（R10 彩蛋首领）19 级也有。
- **回合爬升（2026-10-24，业主「削弱敌方前期加强后期」→「k = 1 落在第 6 回合」；2026-10-31 后三回合再各抬一档）**：
  同一级的乘区在**局内**按回合缩放「高于 1 的那一段」——`有效乘区 = 1 + (表值 - 1) × k(round)`，k = R1–2 0.45 /
  R3–4 0.60 / R5 0.80 / **R6–10 1.00** / R11–12 1.20 / **R13 1.35** / **R14–15 1.55**（`PROTOCOL_LEVEL_ROUND_RAMP` /
  `protocolLevelRoundK`）。业主 2026-10-31「增加 n1-n19，13，14，15 回合的敌人加成」就是这一档：R13（最后一个普通回合）
  与 R14 / R15（最终攻势 / 隐秘核心）单独抬，前面所有回合一个字没动。表值不为它改动，所以 R6–R10 与改前逐字节相同。
  `countAdd` 另走一条阶梯（`protocolLevelCountAddAt`：R1–5 = 0、R6–10 = 表值、R11 起 +1）；`bossPoolMul` 不吃 k
  （它只在首领回合生效），改成直接抬表值：13/14 = 1.35、15/16 = 1.50、17 = 1.70、18 = 2.00、19 = 2.10 —— 首领轮
  「跟着更硬」走的是这一列，不是给池子乘 k。`round` 缺失或非整数 ⇒ k = 1（开局前的读取路径与旧口径一致）。
- **远程怪的攻击力单走一条曲线（2026-10-30，业主「给 n1-n19 的远程怪攻击力曲线单独设置」）**：每行多一格
  `atkMulRanged`，只作用于 **`applyWay === 'RANGED'`** 的敌人（当前 92 个）；`ALL`（能近能远，16 个）与 `MELEE`
  仍吃 `atkMul` —— 业主当场选的是这个**窄口径**，不是官方图鉴「攻击方式包含远程」那个宽口径（`op-thorns.js`
  的反伤判定用的是宽的，两者故意不一致）。曲线更**缓**：1–6 级两条逐值相同（稳定区不动），7 级起放缓，
  19 级 1.46 对通用的 1.94。它吃同一份回合爬升（`PROTOCOL_LEVEL_RAMPED_KEYS` 里有它）。折入点只有一个：
  `server/match/hextech.js` 的 `applyEnemyHexes` —— 远程怪的 spawn 拿「卡牌那份 `atkMul` × `atkMulRanged`」，
  **生命 / 防御 / 法抗 / 速度两条完全一样**；`tag === 'boss'` 的领袖**不吃**这一格（首领轮有自己的 `bossPoolMul`
  与共享血池，这条曲线是给小怪 / 精英怪的）。两条曲线相同时（0 级 / 1–6 级）连 `atkMulRanged` 这个键都不带出来，
  于是 0 级、其余三个难度、以及 1–6 级的对局逐字节不变。回归：`test/match/protocol-levels.test.js`。
- **收入惩罚从第 8 回合起生效**（`PROTOCOL_LEVEL_INCOME_FREE_ROUNDS = 7`，业主 2026-10-18：「n18 经济惩罚太重」
  →「从第 8 回合开始减少钱」）。这条惩罚是**绝对减**，而开局是自走棋最脆弱的地方：Lv18 的 `incomeDelta: -3`
  曾把第 1 回合的 4 金砍到 1 金（最便宜的棋子 2 金）—— 那不是「更难」，是开局就被判死。豁免前 7 回合后，
  Lv18 的资金轨迹是 `4 5 6 7 8 9 10 | 8 9`（第 8 回合从 11 掉到 8），而**每一级都比原来不更重**。
  **为什么不改成百分比**：`-1` 档（Lv10–13）只砍掉约 8 %，换成 −25 % 那种比例反而比原来更重。高等级的强度
  前 7 回合由敌方数值 / 首领池 / 额外敌方源石承担，第 8 回合起再加入经济压力。
- **读取点**：`GameData.protocolLevel / protocolLevelMods`（`income()`、`bossPoolHp()`）；
  `server/match/hextech.js matchEnemyMods`（敌方协议源石 + 等级折成同一份 spawn mods —— **实战与预览是同一个
  fold**）；`settle.js` 的漏怪损失。
- **协议 / 房间**：`room.create.level`（可选）、`room.setLevel`（房主、开局前、ABYSS 专属，别处点名拒绝）、
  `room.state.level`（只有 >0 才带这个键）；`m.result.protocolLevel` 进战绩（`matchRecords` 的 `level`、
  `ui/stats` 的 `level`）。
- **匹配**：`server/matchmaking.js` 严格按 `(difficulty, level)` 成房 —— 不同等级不会凑到同一间。
- **额外敌方协议源石**：13/14/15 级 1 张、16/17 级 2 张、18/19 级 3 张，**按 1 / 3 / 5 回合分散发放**
  （`MatchHexDraft.applyProtocolLevelEnemyHexes(round)`，每回合由 `MatchPhases.startRound` 调一次；第 i 张落在
  `PROTOCOL_LEVEL_EXTRA_HEX_ROUNDS[i]` 回合。业主 2026-10-22「额外协议源石分散给，在1，3，5回合给额外的」——
  此前是开局一次发完，L18 等于 R1 就拿到 3 张）。从敌方名册按这一局的 `rngHex` 抽（跳过已有的卡、确定性；等级
  关闭时返回 0，一个字节都不动）。
- **互斥的敌方协议源石**：`shared/hextech.js ENEMY_HEX_EXCLUSIONS` 里的组合永远不同时出现 —— 目前只有一条：
  **隐匿（`ehex_stealth`）× 势不可挡（`ehex_unstoppable`）**（业主 2026-10-24「不要让敌方协议隐匿和势不可挡一起出现」）。
  理由：隐匿让地面非首领敌人开场不可见，只能靠挡住它来现形；势不可挡又每名敌人多要 1 点阻挡、速度减半 ——
  两者叠加等于要求玩家去挡一个看不见、且挡不住的单位，整波没有解法。规则在**抽取点**生效
  （`pickEnemyHex` → `enemyHexConflicts`），两条发牌路径（每回合 1 张、等级额外那几张）共用同一个函数，
  所以重放仍确定性、老存档不用迁移；测试面板 / 工坊包的**显式发放**不过滤（那是明确给的卡，不是抽的）。
- **排行榜**：`MatchRecords.board({ difficulty, level, limit })` —— 每 (难度, 等级) 一张榜，每名真人只留「胜 > 通过回合多 >
  更早达成」的最好一局，榜长封顶 50；公开面只有名字与成绩（**不含 playerId**），装载时从 journal 重建。C2S
  `records.board` 取榜，客户端「统计 → 排行榜」按难度 / 等级筛选。
- **N18 第 10 回合的彩蛋首领**（业主 2026-10-22「n18难度增加第10回合会出现黑蛇或梅菲斯特」）：**普通回合里额外
  刷一只**「不死的黑蛇」（`enemy_1515_bsnake`）或梅菲斯特（`enemy_1507_mephi`），由对局种子决定是哪一只；只在
  **ABYSS 18 级起（18 / 19）**、**只在 R10**。

  形态是业主当场选定的那一条：**不是一个额外的首领回合** —— 它不碰最终攻势那一整套（不合并团队 LP、没有共享
  血池、没有 BOSS_HIT 播报、R14 照常还是本局唯一那场首领关），而是像波次里任何一个敌人那样打：走本回合第一条
  地面路线的起点、0 秒出场、按普通敌人结算（漏掉照扣 `lpr`、破坏完美作战，联席的联防也会把它带进去）。

  - 表与抽签：`shared/protocolLevels.js` 的 `PROTOCOL_LEVEL_EXTRA_BOSS_ROUND / _LEVEL / _BOSSES` 与
    `protocolLevelExtraBossAt(level, round, difficulty, seed)`（纯函数，`(seed % 2)` 决定哪一只）。
  - 摆进波次：`server/match/waves.js` 的 `withExtraBoss`，由 `MatchPhases.startRound` 在 `buildNormalWave` 之后
    接一次。**没有它时返回同一个对象** —— 0–17 级与其它三个难度逐字节不变（golden 不移动）。
  - **不消耗 `rngWaves`**：那是「本局每一轮出怪表」的同一条随机流，在 R10 多抽一次会把 R11–R14 的出怪整体换一份。
    抽签走种子哈希，所以后半局与以前完全一致（`test/match/protocol-levels.test.js` 钉住这条性质）。
  - 血量是 `data/enemies.json` 的表值，**不叠**本回合的 `enemyScale.hpMul`、也不叠 N18 的 `bossPoolMul`（那是首领
    **血池**的倍率，这里没有池子）—— 与最终攻势同一条口径「领袖单位于服务器的生命值加成不受上述加成影响」；
    攻击 / 移速照旧吃本回合的倍率。
  - 预览与客户端：spawn 规格带 `tag: 'boss'` 与 `preview.boss / preview.start`，于是它进 `m.private.nextEnemies`
    的「领袖」组、带上出生格，客户端的 `leaderStand`（`public/js/render/prepfield.js`）因此在备战界面把它直接画在
    起点上，敌方情报里也照常显示。
- **难度介绍**（业主 2026-10-22「有人不知道n18的效果，增加难度介绍」）：等级选择器原来只有一句「敌方生命
  ×{hp}、攻击 ×{atk}；等级越高，首领池与收入惩罚越重」—— 没说清 18 级到底多了什么。现在**每一级**都列一份逐条
  清单，内容由 `shared/protocolLevels.js` 的 `protocolLevelEffects(level)` 从表里**现算**（界面不写第二份数字：
  这个仓库里已经出现过「表的注释改了、界面的字样没改」那种谎），每一项 `{ id, msgid, params }`，界面只负责 `t()`
  与排版；顶上一行 `protocolLevelHeadline` 给出「稳定区 / 危险区 / 深潜区」的一句摘要。两个落点：
  `public/js/screens/lobby.js` 的 `ProtocolLevelPicker`（选择模拟协议里，等级条下面直接摊开）、
  `public/js/screens/room.js` 的底栏滑块（空间只有一格，点 `?` 展开浮层 `.rs-lvhelp`）。
  「不是数值」的两条（R10 的彩蛋首领、19 级的一回合资金上限）用 `is-special` 单独标记。
  这些 msgid 是运行时拼出来的，`tools/i18n.mjs` 的字面量提取看不到它们，所以：四个语言包手工补齐，
  `PROTOCOL_LEVEL_EFFECT_TEXT` 留一份完整清单，`test/match/protocol-levels.test.js` 逐个查
  `public/i18n/*.json`（少一条就报 —— 漏了的表现是界面上直接显示中文原文）。
- **彩蛋首领各自的实力以 §19 的脚本为准**（0.19.15 补记）：黑蛇的普通攻击在 0.19.15 之前**一次都没打出去过**
  （射程读了 `e.s.range`，那里只有派生数值；`undefined` 让候选目标恒为空），它的 `atk` 事件也从来不发，
  所以模型只播 Idle / Move / Die / Reborn。修好之后它才按 PRTS 打真实伤害 + 附加【烈焚灼息】，
  官方那条「带火的干员对黑蛇伤害降低 50%」也随之第一次生效（见 `docs/BALANCE.md` 的同一节）。
  R10 彩蛋首领的手感数据是在**修复前**量的，那批数字偏软。
- **待办**：人手实测；L18 的 R8 尖峰（每波 +1 + 3 张额外源石）是刻意的终局强度，实测过狠时先动 18 的 `countAdd`。
  **L19 的敌方数值还没量过**（`[ASSUMED]`，沿 18 的增量再抬一格）：实测时若比 18 级狠太多，先调 19 的 `hpMul/atkMul`，
  别动它的 `fundsGainCap`（那是业主点名的那一格）。



## 协议源石：第 7 回合的盟约专属协议（2026-10-26，业主裁定）

**第 7 回合改成「盟约专属协议」抽取回合**：抽卡池按玩家**当前激活的核心盟约**收窄到带 `requiresBond` 的那一族
（先例是维多利亚【锻炉】）；没有激活核心盟约、或该族为空时回退普通池，保证这一回合仍有牌可抽。刷新与单卡刷新共用
同一个收窄后的池子（`server/match/match/hexDraft.js _hexPoolFor`）；敌方照常按本回合选中的阶位抽 1 张。
数据侧：`data/hextech.json format.rounds = [1,3,6,7,11]`、`format.exclusiveRounds = [7]`；客户端在 `HEX_DRAFT`
覆盖层显示「盟约专属协议」一行（`v.hex.exclusive`）。

同一批新增 7 张核心盟约专属协议（**3 阶**，均 `requiresBond`；【锻炉】保持 2 阶）——【锻炉】之外全部新增：

| 盟约 | 卡 | 作战中 | 获得时 / 里程碑 |
|---|---|---|---|
| 炎 | 燎原 | 己方伤害附加 2% 攻击力灼燃损伤（每干员 1s 一次）；炎≥200 层灼燃爆发伤害×2；炎≥300 层炎干员**视为坚守干员**：备战侧算进坚守人数（激活 / 阶跟着走），作战中并入坚守的 40% 分担 / 反伤 | 部署位 +2 |
| 萨尔贡 | 绿洲 | 萨尔贡开技能获得 100% 攻击力护盾，下次攻击附加等额法术伤害 | 60 层给缇缇；325 层给黄沙罗盘 |
| 谢拉格 | 冰雪消融 | 谢拉格攻击寒冷/冻结敌人时解除状态、+1 层、伤害 130%/260%、40% 减速 6s；≥75 层谢拉格 +50% 攻/血 | 给耶拉；谢拉格价格 −1（最低 1） |
| 拉特兰 | 圣佑 | 拉特兰攻速 +50、攻击力 +80%；每消耗 1 颗弹药所有拉特兰获得自身 5% 最大生命的护盾（可累加）；消耗子弹时额外消耗 1 发；致命时若有弹药则清空弹药、免死、得 1 层次数盾；本场累计消耗的子弹量，每 3 秒对一个随机活敌人狙击「累计 ×325」物理伤害 | — |
| 阿戈尔 | 协同进化 | 吞噬不再造成伤害；吞噬结束后阿戈尔攻/血提升到最大值 80%（高了不降） | — |
| 叙拉古 | 教父 | 己方伤害使敌人 +10% 易伤，最高 +200% | 给安洁莉娜 |
| 卡西米尔 | 骑士 | 装备【骑士徽章】：卡西米尔受伤转移给骑士、卡西米尔真伤×2、致命时 +5 不屈并锁血 5s（每场一次，再部署刷新） | 给骑士徽章 |

- 「视为坚守」的判据只有一处：`server/match/bondsMeta.js yanSteadLayerGate`（门槛读卡的 `yanEmber.steadLayer`，缺省 300；
  层数读 `ps.layers`，**圣约回响的显示倍率不算**）把**场上**的炎干员加进 `steadShip` 的成员集合 ⇒ 坚守真的激活 / 升阶，
  盟约条与弹窗的在场数跟着变。战斗输入随后带着这个 `tier`，`bonds/addon/battle.js` 再把炎干员并进坚守的成员名单
  （战斗中才到 300 层时由 `layerGain` 重建名单）；客户端 `gameLogic/bonds.js bondMembers` 只镜像弹窗的成员行。
- 伤害转移的叠加口径（业主 2026-10-29 裁定）：**任何转移的产出都不再被二次转移**。100 % 转移（【骑士徽章】）在
  `hit` 阶段**认领**整次伤害（`dmg.redirectClaim`），坚守 / 浊心斯卡蒂 S1 / 燎原的炎烬据此不削减、不分成 —— 它们的
  分成是从「落到被转移者身上的 HP」反推的（`damage.js redirectShare`），认领之后那里恒为 0，先削后转只会把那份伤害
  **删掉**（实测：1000 打在「卡西米尔 + 坚守 t2」的干员身上，全队只吃 600）。反过来，任何一种转移产出的那一份
  （`damage.js isRedirectShare`：`transfer` / `bond:stead:share` / `hex:yanember:share` 标记与 `steadShare` /
  `steadThorn` / `yanEmberShare` / `knightTransfer`）都不会被再切一次、也不会被徽章接走。所以「斯卡蒂 S1 + 坚守」
  同时生效时，受击者照旧保留 1−R−S，而斯卡蒂转移过去的那一份**不再**被坚守二次削减（旧实现会再切 40 %：500 → 300 给
  斯卡蒂、200 给成员；现为 500 整份），分配回到 100 / 400 / 500 —— 即 `docs/history/0.2.4.md` 的 31.2 节记录的数字，
  此前的实现与那一段不符。灰毫（`chess_char_2_18_a`，同时是卡西米尔与坚守）在场时，旧版徽章与坚守会互打，直到 32 层
  hook 深度上限（每一击 6 条 `hookDepth` 错误）。
- 战斗半段：`server/sim/content/hexcards/stone_*.js`（各自由 `specOf` 的参数门控）；卡西米尔那件走
  `server/sim/content/items/knightbadge.js`（装备驱动，与卡无关）。
- 备战半段：`applySpec` 新增 `chess.ids`（指定干员，锻炉给薄绿+洛洛）、`deployCap`（部署位）、
  `layerGift`（层数里程碑，挂在 `effect.onLayers`）、`bondPriceDiscount`（挂在 `effect.onPrice`）。
- 新装备：【骑士徽章】`chess_item_9_98_e_a`（`tools/build-data.mjs CUSTOM_ITEMS`；1 阶、价格 0、商店不出售、不可合并）。
- 阿戈尔那半：`bonds/core.js devour()` 读 `hex_egir_symbiosis`，有卡时跳过 5000 物理流失，并在每次吞噬结束时
  `emit('egirDevourEnd', { playerId })` 给卡脚本做属性结算。
- 设计口径与 [ASSUMED] 清单见 `04-文档/协议源石-盟约专属协议-第7回合-设计稿-20261026.md`（工作区级）。

## 协议源石：四张 2 阶盟约专属协议【衰朽的骄矜】【炎百兽】【困毙之雪】【骑士金神】（2026-10-31，业主裁定）

第 7 回合的专属池新增四张 **2 阶（gold）** 卡（与【锻炉】同阶，专属池不再全是 3 阶）：维多利亚【衰朽的骄矜】
(`hex_victoria_decay`)、炎【炎百兽】(`hex_yan_beasts`)、谢拉格【困毙之雪】(`hex_kjerag_frostdeath`)、卡西米尔【骑士金神】
(`hex_kazimierz_knightgold`)，均 `requiresBond`。数值全部在卡面 `effect` 参数里（`tools/hextech/roster.mjs` →
`data/hextech.json`），战斗半段在 `server/sim/content/hexcards/stone_victoria_decay.js` / `stone_yan_beasts.js` /
`stone_kjerag_frostdeath.js` / `stone_kazimierz_knightgold.js`（各自由 `specOf` 的参数门控）。

| 盟约 | 卡 | 作战中 |
|---|---|---|
| 维多利亚 | 衰朽的骄矜 | 在场 3 名不同维多利亚：携带装备者攻击无视防御/法抗，维多利亚每秒流失 0.5% 最大生命；5 名：生命 >80% 时 +50 生命 / +50 防御 / +100 攻击 / +7 攻速（随层数增长）、额外流失 0.5%（装备维式重锤时 0）；7 名：额外流失 1%；维多利亚生命首次归零时锁血进入「衰朽」8 秒（阻挡 0、攻击 +100%、攻速 +7 随层数），8 秒内**本人**击杀 3 名则回复 50% 最大生命并脱离，否则强制撤退（每名干员每场一次） |
| 炎 | 炎百兽 | 炎干员技力消耗 +5%（装备天师古鼎的豁免）；战斗开始时为每名炎干员召唤一只与其生命共享的炎佑（属性 = 对应干员 80% + 0.4%/层，加到模板上）；5 名：技力消耗再 +5%、炎干员每秒回复 20 + 0.5/层 生命；7 名：技力消耗再 +5%、炎佑的祛恶之焰改为锁定 2 个目标（攻击力 60% + 0.2%/层，半径 1，每秒一次，最多 20 秒） |
| 谢拉格 | 困毙之雪 | 每层霜寒：防御 +5%、攻速 −5；所有【谢拉格】干员每 5 秒 +1 层霜寒（完全无条件）。10 层消耗清零进入「冰封」5 秒（无法攻击/技能/被治疗，阻挡 +1、免疫伤害，期间不叠层）；3 名：敌人被冻结时（来源不限）所有谢拉格 +1 层、冰封干员周围八格内的敌人每秒 100 + 40×谢拉格层数 真伤（被该真伤杀死的敌人使谢拉格 +1 层）；6 名：谢拉格死亡冻结全场 5 秒并全体 −4 层，全员冰封时每秒 100 + 50×谢拉格层数 真伤 + 寒冷、持续 5 秒（被该真伤杀死的敌人使谢拉格 +2 层） |
| 卡西米尔 | 骑士金神 | 卡西米尔击杀 4 个敌人获得 1 金（全队共享计数，每场上限 min(9, 1+floor(卡西米尔层数/50))）；5 名：战斗开始时按卡西米尔层数累计刷怪（<50 一只无胄盟清扫小队、50–100 再 +1、100–200 烛骑士薇薇安娜、200–300 腐败骑士、300–400 凋零骑士），等阶最高的卡西米尔（并列都加）攻击力 +30+层数、攻击范围 +1 格；7 名：本回合每消耗 3 金，所有己方干员伤害 +20%（可叠加，只在本回合有效，备战侧写 `params.battle.dmgPct`） |

- 祛恶之焰的 2 目标由 `server/sim/content/tokens.js yanyouKit` 读 `unit.mem.flameTargets` / `unit.mem.flameScaleFn`
  （缺省 1 目标 + 数据里的 `atk_scale`，与旧版行为逐字节一致）。
- 设计口径与 [ASSUMED] 清单见 `04-文档/协议源石-专属协议-衰朽的骄矜与炎百兽-设计稿-20261031.md` 与
  `04-文档/协议源石-专属协议-困毙之雪-设计稿-20261031.md`（工作区级）。

## 协议源石：普通卡【突破极限】(3 阶) 与【特限恢复】(2 阶)（2026-10-31，业主裁定）

两张**普通卡**（无 `requiresBond`），都只对抽到卡的玩家自己生效：

- 【突破极限】`hex_break_limit`（3 阶）：盟约叠层上限 999 → **9999**。`bondLayerCapOf(ps)` 从卡面
  `params.bondCap.cap` 读每玩家上限；备战加层/预览、战斗内加层、回合结算、客户端显示全部跟着抬
  （`shared/constants.js layerGainRoom(before, n, cap)`；`PlayerBattleInput.bondLayerCap`）。
  **联防里也能叠层**（2026-11-01 业主追加，卡面 `params.bondCap.uniteLayers`）：联防 spec 整场仍是
  `layerGainsEnabled: false`，另给 `flags.layerGainsByPlayer = { [pid]: true }`（`unitePhase.js _uniteOpts`，只点名拥有者；
  一个拥有者都没有时不写这个键）；sim `Battle.layerGainsOn(playerId)`（`support.gainLayers` 同一条闸门）、结算
  `uniteLayerGainsOn(ps)` 与客户端盟约条都按它放行，没这张卡的玩家照旧不加层。
- 【特限恢复】`hex_mode_modules`（2 阶）：① 拥有者的干员使用 **3 级模组**数据 ——
  `data/moduleLevels.json`（`tools/build-data.mjs` 生成，按 `uniEquipId` 记录 equipLevel 3 的 attr / traitOverride /
  talentChanges），战斗与备战预览按 `loadout.moduleLevel = 3` 组合（普通形态用默认模组的 3 级数据）；
  ② **特限模组（ISW / SO / RA）** 的专属效果在战斗中生效（`hexcards/stone_mode_modules_isw.js` /
  `stone_mode_modules_ra.js`，按 `u.def.module.type` 前缀逐干员实现）；
  ③ **号角「号角特限证章」的「可以部署在目标点」**（2026-10-31 业主追加）：保护目标点（stage 图例 `tile_end`）平时
  `buildable NONE`、谁都不能站；拥有本卡的玩家让号角装备 **ISW- 特限模组** 后，可以把她摆上去（`shared/goalPoint.js`
  `goalPointKeys` / `canStandOnGoalPoint`；服务端 `player/placement.js _mayStandOnGoalPoint`、`invariants.js`、
  客户端 `ui/gameLogic/placement.js` 读同一份）。`[ASSUMED]` 目标点不是阻挡地形：她站在那里不挡路，敌人照常漏；
  补位形态不适用。
  ④ **普通形态（棋盘上还没有精锐棋子）也用干员调配里选的模组**（2026-10-31 业主报「特限恢复有问题，不生效对没有
  精锐的干员」）：普通记录没有 `modules` 列表，模组选择原来被 `resolveLoadout` 丢掉 ⇒ `PlayerState.battleInput`
  用 `shared/loadoutRecord.js selectedModuleOf` 按**精锐记录的模组表**校验后补 `moduleId`，战斗按该模组的 3 级数据打，
  特限模组（ISW）的专属效果与「可以部署在目标点」对普通形态同样生效；没选 / 选默认模组 ⇒ 默认模组的 3 级；选
  「不装备」⇒ 一个模组都不套。补位干员仍不适用（它打的是另一名干员的身体与模组）。
  客户端同样接上：`ui/gameLogic/loadout.js chessLoadout(..., { moduleLevel: 3, moduleLevels })` 组合同一份 3 级记录，
  局内详情卡（`ui/detailPanel.js`）对普通形态也画「模组」区块（名字 / 类型 / 已调配 + 3 级特性追加行与天赋），
  `moduleLevel` 由 `screens/game.js` 只对**自己的**棋子给出（队友的干员按他们自己的卡）。`data/moduleLevels.json`
  因此进了 `GAME_FILES`（局内 UI 等它）与 `SIM_DATA_FILES`（浏览器端跑的默认战斗要它，页面没有 Node 的 fallback）。
- 设计口径与 [ASSUMED] 清单见 `04-文档/协议源石-突破极限与特限恢复-设计稿-20261031.md`（工作区级）。

## 协议源石：【死亡之舞】新增 + 四张卡调整（2026-10-31，业主裁定）

- 新增 3 阶普通卡【死亡之舞】`hex_deathdance`：己方干员受到的 HP 伤害改为**3 秒内均匀扣**（0.5 秒一跳、可致死、
  护盾仍先抵挡；`hpDamage` 钩子把即时伤害压成待扣队列）；己方干员**周围八格**有敌人死亡时，该干员回复 5% 最大生命。
- 【圣佑】`hex_laterano_sanctuary`（3 阶专属）：每消耗 1 弹药的「回复 5% 最大生命」改为**获得自身 5% 最大生命的护盾**
  （可累加）；新增：本场累计拉特兰子弹量，每 3 秒随机狙击一个敌人，造成 **累计子弹量 ×325** 物理伤害。
  - **2026-11-03 修（业主「圣佑子弹消耗未正确计算」）**：「累计消耗的子弹量」数的是**子弹**，不是 `ammoUsed` 事件。
    此前这张卡自己的「额外消耗 1 发」与免死时的「消耗全部弹药」都会真实扣弹夹却不记账 ⇒ **实际掉 2 颗只记 1 颗**：
    50 发技能打完只累计 25 颗，狙击伤害只有一半。现在三个消耗点（引擎 / kit 的 `ammoUsed`、额外那 1 发、免死清空）
    统一走 `stone_kjerag_laterano.js` 的 `countBullets(u, n)`，「消耗的子弹量」= 弹夹真正少掉的子弹数。
    **护盾的粒度不变**：仍每条 `ammoUsed` 事件结算一次，额外那 1 发与免死清空不另加一份（业主 2026-10-27
    「额外这发不再触发一次治疗」，2026-10-31 换成护盾时设计稿「其余部分保持不变」）。
- 【惊惧】`hex_dread`（1 阶）：改为**己方地面干员开启技能时**，其**周围八格**内的敌人战栗 3 秒。
- 【装甲破坏】`hex_armorbreak`（2 阶）：每次物理伤害的防御削减 −20 → **−80**。
- 【先锋之势】`hex_vanguard`（2 阶）：先锋首次击杀的 4 资金保留；首次攻击的 +30% 攻击力改为
  **每名己方先锋的第一次攻击直接秒杀目标**（ELITE / BOSS 无效；击杀仍记在先锋身上，所以加钱照常）。
- 设计口径与 [ASSUMED] 清单见 `04-文档/协议源石-死亡之舞与四张卡调整-设计稿-20261031.md`（工作区级）。

## 协议源石：七张卡调整（2026-10-31，业主裁定）

- 【重量级打击手】`hex_heavyhitter`（1 阶）：额外法术伤害 10% → **20%** 最大生命。
- 【残光】`hex_canlight`（2 阶）的装备：新增**锁血 5 秒、每场一次**——装备者本人受到致命伤害时 `fatal` 免死并开
  5 秒窗口（窗口内再致命只免死不续窗；窗口后正常阵亡；流失不算「受到伤害」）。
- 【蛋白粉奶昔】`hex_proteinshake`（3 阶）：每 100 最大生命再加 **+2% 受到的治疗量**（与 +10 防御 / +0.1 法抗同档位，
  `healingTakenMul`）。
- 【锻炉】`hex_forge`（2 阶）：融合时组件若有进阶形态**自动进阶**（`merged` 写 golden id），**已融合的百变也追溯进阶**。
- 【赌狗大师】`hex_mastergamble`（2 阶）：获得后第 3、6、9… 个回合开始时再给 1 件【拟态物质】
  （`onRoundStart` + `everyRounds: 3` + `skipFirst`）。
- 【紧急拨款】`hex_emergencygrant`（2 阶）：精锐干员出售资金 2 → **3**。
- 【群蛇形态】`hex_serpentform`（3 阶）：**替换**旧机制——本回合每卖 1 名干员，下一场敌人出场时最大生命 **−10%**
  （封顶 −50%，回合开始清零）；`serpentHpLossPct` 由备战写进 ref、战斗侧在开场与每次 `enemySpawn` 时压缩敌人最大生命
  （BOSS / 部位 / 领袖共享池跳过）。
- 设计口径与 [ASSUMED] 清单见 `04-文档/协议源石-七张卡调整-设计稿-20261031.md`（工作区级）。

## 协议源石：第 6 回合的「点卡刷新」（2026-10-30 定规则；2026-10-31 改成点卡界面，业主裁定）

**第 6 回合多给一次换牌机会**：业主 2026-10-30「在第6回合玩家可以舍弃1-2个协议源石随机获得相同数量的协议源石」，
2026-10-31「不要按钮形式，你就搞个界面把有的协议源石放上去点击刷新」「就是选完协议源石，这面板直接出现，用协议源石的界面也行」。
第 6 回合的 3 选 1 **照常**（`format.rounds` 不动），换牌是**另外**给的一手。

- **口径**：免费；**每局 2 张**（`shared/hextech.js HEX_RECYCLE_BUDGET`）—— 点一次花一次，可以点同一张两次，也可以点两张
  各一次；换回**相同数量**的随机源石，走正常抽取的 1/2/3 阶权重（`gd.hexWeights()`，当前 0.46/0.38/0.16）；被换掉那张
  **已经给过的一次性收益不回收**（加的钱 / 部署位 / 装备 / 干员留在原地，与测试场 `g.testHexClear` 同一条口径）。
- **界面**：`ui/hexOverlay.js` 的 `HexRecyclePanel` —— 复用抽卡那套 `.spov` 外壳 + `HexCard`，把已拥有的源石铺成卡，
  **点哪张刷哪张**（无确认、无多选），头部「剩 n 次」，底部「完成」；窗口一开**自动弹出**，不靠角落按钮。**同名的两张铺两个槽**
  （业主 2026-11-02「相同的海克斯，在刷新回合会被当成一个海克斯」）：面板读服务端行上的 `hexRefs`（**带重复**的卡 id，
  只在「有卡被拥有多于一次」时才出现；没有它的行照旧退回去重的 `hexes`），「在飞 / 新卡入场」按**槽键** `idx:id` 而不是卡 id，
  所以两张同名卡不会互相吞掉
  （2026-10-31 业主「不要按钮形式」）。`ui/gameActions.js hexRecycle` 是唯一发送点；文案进四个 `public/i18n/*.json`。
- **窗口（服务端权威）**：`server/match/match/hexDraft.js _hexRecycleGate` —— 存活 + 第 6 回合 + 余量 > 0 + 至少拥有 1 张，
  且是下面之一：**抽卡阶段里自己已经选完**（`picks[pid]` 已落下、没有欠的额外选牌 —— 「选完协议源石，这面板直接出现」），
  或**休整期且未准备**（与其它备战期动作同一条闸门）。换牌只摘自己身上的 `hex:<id>` ref，**`offers` / `picks` 一个字节都不动**。
  客户端另有一条纯表现上的让步：**同回合还有机变的难度**（`spRounds` 含 6 的标准 / 同盟标准）里，抽卡结束紧接着就是机变的
  整屏界面，这时不弹面板（会闪一下、还会盖住机变），等休整期再弹 —— 仍是同一回合、仍在选完之后（`hexRecycleWindow` 读
  `m.public.spRound`）。
- **意图**：`g.hexRecycle { ids }`（`shared/protocol.js`，1–2 个互不相同的已拥有 id；界面点一次只发一张）。落点
  `hexDraft.js recycleHex`，由 `server/match/match/intents.js` 路由。**`PROTOCOL_VERSION` 不动**（先例 `records.mine` /
  `g.unequip`）：老客户端不发它，一切照旧。余数只在**第 6 回合**的 `m.public.players[]` 行上写成 `hexRecycleLeft`（0–2）；
  其它回合不写这个键，所以没走到第 6 回合的对局帧逐字节不变（`server/match/match/views.js publicPlayerView`）。
  行上另有 `hexRefs`（**带重复**的卡 id，`ps.effects` 顺序）**只在有卡被拥有多于一次时才出现**，供点卡刷新面板铺出两个槽；
  `hexes` 仍是去重的拥有列表（抽卡池 / 潘多拉 / 战斗标记都读它），一个字节都没改。
- **拒绝码**：`WRONG_PHASE`（阶段 / 回合 / 已准备 / 还没选完，`detail` 点名是哪一条）、`ALREADY`（余量为 0）、
  `BAD_TARGET`（张数不对 / 超过余量 / 不是自己的牌 / 池子凑不出同样数量）。被拒绝的请求**一张牌都不动、余量也不扣**。
- **池子与随机流**：`_hexPoolFor(ps)`（禁用 + 未激活盟约的专属卡照旧收窄；第 7 回合的 exclusive 收窄只对第 7 回合生效）
  + 本局种子流 `rngHex`（`rollOffers`），所以重放确定性。换回的牌**排除「仍拥有的」与「刚换掉的」** —— 与刷新同一条
  「不会立刻回到手上」规则。**池子凑不出同样数量时直接拒绝**（`BAD_TARGET` / `detail: 'pool exhausted'`）：
  「随机获得相同数量」是这条规则的原话，宁可不让用也不发半份。
- **换牌 = 只摘 `hex:<id>` EffectRef，一次一张**（业主 2026-11-02：同名的两张就是两张 —— 每个请求 id 只摘**第一个**匹配的 ref，
  `hex:<id>#<n>` 副本按它自己的一张算，不再跟着一起走），持续 / 战斗那一半随之消失；换回的牌走正式发牌
  路径 `applyHex`（`onPick` 立即生效、持续 ref、战斗半段、镜像协议 / 二次抽取这类额外都照常）。[ASSUMED] 队友身上的
  **同名团队卡**副本不动 —— 那是他们自己的 ref，来源无法区分，摘掉会误伤独立抽到同一张的队友；[ASSUMED] 能换的是
  **此刻拥有的一切**，包括本回合刚抽到的那张（每局只 2 张，不会变成无限刷新）。**AI 座位不用它**（bot 从不发意图，
  规则里也没有给它们的自动版本）。
- **顺带修掉的卡死**（fuzz 新增意图后 seed 27 暴露，**旧代码就有的 bug**）：整批刷新（`g.hexReroll` 不带 `idx`）在
  「已拥有 + 当前这一批」把池子占满时抽到**空数组**，会把手里还有牌的 offer 清空 —— 限时的局靠超时兜底，单人 / 单人不限时
  的局没有 deadline，整局永远卡在 `HEX_DRAFT`（第 7 回合的专属池只有 1–2 张，最容易占满）。现在：抽不出新的一批就**保留原来
  那一批**（与单张刷新 `|| next[idx]` 同口径），并且**空 offer 不再算「欠一次选牌」**（`_hexPicksLeft` 返回 0，phase 照常
  往下走）。回归：`test/match/hex-exclusive.test.js`。
- **回归**：`test/match/hex-recycle.test.js`（抽卡阶段换 / 休整期换 / 一次 2 张 / 各条拒绝 / 不回收一次性收益 / 同种子同结果）、
  `test/ui/hexRecycle.test.js`（客户端纯函数与面板）、`test/match/fuzz.test.js`（新意图进 `GAME` 后的随机序列）。
  **golden 不移动**：这是备战层的规则，不进战斗模拟。

## 协议源石与首领：十条 bug / 增强（2026-11-01，业主裁定）

- **首领【伤心的大锁】**（boss_13）：受击反击（每 20 次受击 → 全场 100% 攻击力法术溅射）的计数只算**「可触发受击
  回复」的伤害** —— 生命流失 / 反伤 / `noSp` 的持续伤害不再推进计数（PRTS「每受到20次可触发受击回复的伤害后」，引擎
  自己的判据就是 `applyHpLoss` 里那行 `!dmg.noSp && dmg.type !== 'element'`）。另外**有意偏离官方**（业主 2026-11-01
  拍板）：溅射加**最小间隔 4 秒**（`aoetrigger.min_interval`，缺省取大锁自己的攻击间隔，0 = 关闸回到官方口径）——
  本模式 8–12 人全在打一个静止、全场射程的领袖，20 次受击 1–3 秒就攒满，官方口径下会变成每 1–2 秒一发全场溅射。
  攒满后被闸压住**不丢计数**，到点立刻打出。「无视不屈」不复现：不屈只保**地面**干员（官方口径），同一次溅射里高台
  干员本来就不会被拉回；`fatal.prevented` 免死也照常生效。
- **【困毙之雪】**`hex_kjerag_frostdeath`（2 阶；业主 2026-11-01 **又改了一次口径**，卡面、参数与实现按最终口径）：
  ① **霜寒上限 5 → 10 层**（每层仍是 防御 +5% / 攻速 −5，10 层 = +50% / −50%），10 层消耗清零进入「冰封」5 秒；
  「每 5 秒获得 1 层霜寒」是**完全无条件**的基础效果（不看在场人数、不看有没有敌人被冻结 —— 原来的 `idleFrostUnconditional`
  开关已删除）；② <在场3名> 整段替换为两条：敌人被冻结时（**来源不限**）所有【谢拉格】干员 +1 层霜寒，
  冰封干员**周围八格**内的敌人每秒受 100 + 40×谢拉格层数 真伤、**被该真伤杀死**的敌人使【谢拉格】层数 +1；
  ③ <在场6名>：谢拉格干员死亡冻结全场 5 秒 + 全体移除 **4 层**霜寒（原 2 层），全员冰封时的真伤窗口 15 秒 → **5 秒**
  （仍是进入冰封那一刻**事件驱动触发** + **绝对截止时刻**，不再因为「全员冰封的重叠窗口短于轮询间隔」整段丢掉），
  窗口内每秒 100 + 50×谢拉格层数 真伤 + 寒冷，**被该真伤杀死**的敌人使【谢拉格】层数 **+2**；
  ④ **已删除**：每层霜寒 30% 概率施寒（`coldChancePerStack` / `coldSec`）、解冻未死则半径 1.5 内回层（`freezeEndRadius`）、
  「无冻结敌人每 5 秒叠 1 层」旧分支、冰封干员**阻挡的**敌人真伤（`sealedBlockDmg` / `sealedBlockDmgPerLayer`）；
  新参数见卡面 `params.kjeragFrostDeath`（`frostMax: 10`、`sealedAuraDmg` 100 + 40/层、`sealedAuraRadius: 1`、
  `sealedAuraKillLayers: 1`、`deathRemoveStacks: 4`、`allSealedSec: 5`、`allSealedKillLayers: 2`）。
- **【炎百兽】**`hex_yan_beasts`（2 阶）：① 生命共享改成**双向** —— 干员被治疗时炎佑按同数值回血（`shareHealPct: 100`，
  自我回复形式，绕开「友方召唤物收不到别人治疗」的引擎规则；超量治疗不凭空造血，标记防递归）；② 炎佑**100% 继承**
  对应干员的防御力与法术抗性（`inheritDefPct` / `inheritResPct`，替换模板值；比例 0 = 关掉）。
- **【突破极限】**`hex_break_limit`（3 阶）：**拥有者在联防（unite）战斗中也能叠层**。联防 spec 仍是整场
  `layerGainsEnabled: false`，另加**每玩家** `flags.layerGainsByPlayer`（只点名拥有者，`uniteLayers: true` 为判据）；
  唯一读法 `Battle.layerGainsOn(playerId)`，消费方 5 处：sim `addLayers`、`support.gainLayers`、结算（非拥有者战报里的
  层数丢弃）、`fields.js` 客户端战报校验、`runner.js` 盟约条显示。没有拥有者时**不写这个键**，spec 逐字节不变。
- **赤刃明霄陈 S3 剑气 vs 木桩**：剑气「每段直行命中一次」被 `w.hit.clear()` 每帧清空破坏 —— 被墙角卡住时一帧转 4 次、
  位置不动，同一目标**每 tick 命中一次（30 次/秒）**、每次 6% 当前生命。改成「转向 **且** 这一帧确实在走 **且** 方向与
  当前直行不同」才清空命中表（PRTS「转向后忘记打过的敌人」保留）。木桩锁血未被绕过（同 tick 30 发致死仍停在 1 血），
  百分比伤害**不封顶**（6% 是 PRTS 的 `hp_ratio`）。
- **【特限恢复】**`hex_mode_modules`（2 阶）：有特限模组（ISW / SO / RA）的干员购买价格 **−2（最低 1）**。卡面
  `onPrice.specialLimitDiscount { delta, min, types }`，读取点 `economy.js priceOf`（商店显示 / 购买扣款 / 测试场选人
  同一处），判据读 `gd.chess().modules[].typeName` 前缀，不新造数据源；复制第二份 ref 不会叠成 −4。
- **协议源石发的钱不计入 n19「一回合最多 30 资金」**：`addFunds` 加 reason 前缀约定（`hex` 开头 = 协议源石来源，全额
  豁免且不占额度；`applySpec` 的每一笔钱本来就写 `'hex'`，债务写 `'hex_debt'`）；结算到下回合的钱由
  `ctx.addPendingFunds` 记 `ps.pendingHexFunds`，回合开始那笔 `income` 按它豁免；走悬赏通道的过路费与骑士金神金币
  （`addCoins(..., { hex: true })` → `coinsHex`）也在 `settle.js` 记进 `pendingHexFunds`。回合收入 / 卖出 / 真悬赏照旧受限。
- **【战争机器】**`hex_warmachine`（3 阶）被【复制】复制时，**逐目标**发放（复制者 + 所有存活队友各跑自己的
  `onHexPick` + `onPick.lp`），不再只给复制者；`applyCopiedHex()` 与 `applyHex()` 同一口径，复制 / 策略「管理员」两条
  复制路共用。
- **【复制】**`hex_replicate`（2 阶）：业主 2026-11-01「协议『复制』加个第一个时保留效果」—— 获得时手上**没有别的**
  协议源石可复制（它是你的第一枚）时，【复制】**不消失**，留在收藏里等；之后你每获得一枚协议源石，就用它复制
  **刚到手的那一枚**，然后它才消失（`server/match/hextech.js resolveWaitingReplicate`；每个「获得」只兑现一枚，
  复制出来的副本那次「获得」同样算）。有对象可复制时的旧口径不变：随机复制一张你已拥有的卡（第二个 EffectRef），
  随后自身消失。
- **【绿洲】**`hex_sargon_oasis`（3 阶）的层数里程碑（60 层【缇缇】/ 325 层【黄沙罗盘】）：`runOnPick` 原本是死代码
  （`onHexPick` 派发的是 `effect.onPick`，不含 `onLayers`），所以「拿到卡时该盟约已 ≥60 层」要等下一回合才补发。现在
  获得时用**当前层数回放**这张卡自己的 `onLayers`（`replayLayerGift`），并让一张卡的所有 ref 共用计数器
  （`data.sharedCounters`），复制不会发两只。
- **【量产线】**`hex_massprod`（2 阶）：获得时**立即**得到 1 名当前等级阶的干员（`onPick.chess` 与每回合那条同一个
  tier 口径）。
- 设计口径与 [ASSUMED] 清单见 `04-文档/协议源石-十条bug与增强-设计稿-20261101.md`（工作区级）。

## 协议源石与装备：三条调整（2026-11-01，业主裁定）

三条互不相关，同日同一批：一张 2 阶普通卡的范围加强、一件 4 阶装备的盟约标记、一张 3 阶卡的抽卡权重。

| 对象 | 业主原话 | 改法 |
|---|---|---|
| 【特质扩散】`hex_traitspread`（2 阶） | 「特质扩散加强成给右边和上面」 | 收益者从「**最近**的干员（优先右边）」改成**两名**：`src` **右边最近**的己方干员 + **上面最近**的己方干员（不要求相邻；某方向没有干员 ⇒ 那个方向没有；两个方向落到同一人 ⇒ 只复制一次）。复制仍是追加去重（目标保留自己的特质），起点规则、「最靠左（同列更靠下）」与「没有这张卡就不跑」不变 |
| 装备【有限加速器】`chess_item_4_03_e_a` / `_b`（4 阶） | 「让装备有限加速器能被同构体识别成灵巧装备，让人增加灵巧盟约」 | `giveBondId` 由官方空值补成 **`skillfulShip`**（`tools/build-data.mjs` 的 `ITEM_BOND_GRANTS` 作者声明表，`_a`/`_b` 同吃）⇒ 与【变形同构体】同穿时 `grantedBondsByMorph` 授予【灵巧】，干员算作灵巧成员、计入灵巧人数与层数。天赋栏的配对列表由官方 14 行变 **15 行** |
| 【不屈余烬】`hex_indomember`（3 阶） | 「抽到不屈余烬的概率增加」/「不屈叠层超 200 后增加出现不屈余烬机会增加 20%」 | 卡面新增 `effect.drawBoost { bond: 'indomShip', fromLayers: 200, pct: 20 }`：该玩家【不屈】**实时层数 > 200** 时，这张卡在**同阶位内**被抽中的权重 ×1.2。判据 `hexDrawWeight`（`server/match/hextech.js`）+ `rollOffers(..., weightOf)`（`shared/hextech.js`），接线 7 处：首抽 / 单张刷新 / 整批刷新 / 管理员额外选牌重发 / 换牌 `recycleHex` / 二次抽取 / 无私奉献（用**目标玩家**自己的层数） |

- **权重不是准入**：`drawBoost` 只改「抽中的相对概率」，与 `requiresBond`（只在盟约激活时才可能出现）是两条独立的池子规则；层数读**存储层数**，不读【圣约回响】的里程碑视图。
- **阶梯没动**：【不屈余烬】的装备发放仍是 `indomEmberGift { base: 200, step: 150 }`（超 200 层后每 150 层再发一件），这次只动抽卡。
- **没接权重的三条路径**（有意）：管理员2 的 `_rollBandHex`（按 id 排序后均匀、「完全随机授予」）、潘多拉魔盒（固定 3 阶，没有同阶位概念）、镜像协议（复制队友**已拥有**的卡，不是池子抽取）。
- **商店副作用**（数据驱动的自然结果）：`behaviour.shopBias = bondBias` 读的也是 `giveBondId`，所以【灵巧】激活时装备槽会开始偏向抽到【有限加速器】—— 只偏置、不授予。
- **确定性**：`rollOffers` 不传 `weightOf` 时路径逐字不变（同样只消耗 1 次 `rng()`），所以没有 >200 层不屈坐席的既有对局与 golden 一字不动；传了权重且全部为 1 时选出的小标也与均匀抽一致。
