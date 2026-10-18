# 来源说明（PROVENANCE）· clemnt-addition v2.0.0

## 1 原作者
干员「克莱门莎」的原设、数值与素材方为鹰角网络（Hypergryph）/ Yostar；线上构建未署名具体个人作者（原件未署名）。切片与打包：jingjiangze。

## 2 许可
本包代码与切片 GPL-3.0-or-later；数据 / 立绘 / 语音为《明日方舟》官方导出物，© Hypergryph / Yostar（pack.json 记 license 原文，含官方素材）。

## 3 兼容改写者
jingjiangze（本包即投稿人自制，非二次改写他人 mod）。

## 4 来源
线上构建 https://weishuxieyi.icu/_build/f638115c25cd-20/（build f638115c25cd-20 / app 0.2.1）的 data/chess.json、data/garrisons.json、data/bonds.json、data/assets.json 与 assets/ 素材树，逐 key 提取。

## 5 改了什么
- 1) 切出 chess_char_4_27_a / _b 两条棋子（引擎 0.18.3 的 chess 表实测 266 条、无这两条；线上 268 条）。数值未改。
- 2) 切出 garrison_4231_a / _b 两条驻守特质（引擎 249 条、线上 251 条）。层数门槛（常态每 3 杀 / 精英每 2 杀）未改。
- 3) 新增：以 overrides 声明 bonds:egirShip / swiftShip / indomShip 三条，随包带上「线上完整 members / visibleMembers 数组」（= 引擎的 9 条 + chess_char_4_27_a）。
-    注意：members 是数组 ⇒ 覆盖时整块替换。引擎后续若再往这三条盟约里加成员，本包会把那部分顶掉，需随版本重切。
- 4) 新增：头像 / 立绘（+精英二阶段立绘）/ Spine 正面背面三件套 / 3 个技能图标 / 14 条日语语音（voices，默认语）/ 14 条国语语音（voiceLangs.cn）。
- 5) 仍缺：effectKey = custom_gar_allied_kills 在引擎 0.18.3 全仓 0 命中（server/sim 与 data/effects.json 都没有），
-    ⇒ 驻守特质本身能装载、但不产生任何层数变化。引擎的 §28.49 trait.grantsBonds 是「固定映射发层」，不是「按击杀计数叠层」，
-    不能替代该效果；要真的生效需要引擎侧实现计数通道或维护方改写。本包不假装它已生效。
- 6) 取代同 packId 的旧投稿 620717717bdd（v1 只有 4 条数据、无素材、无盟约归属）。

## 6 自带素材来源（逐条清点）
- 共 3,384,920 B / 40 个文件（含官方素材）
- op/char_4231_clemnt/：avatar.png、portrait.png、portrait_e2.png、front/{skel,atlas,png}、back/{skel,atlas,png}
- skill/skchr_clemnt_{1,2,3}.png
- voice/{cn,jp}/char_4231_clemnt/cn_019…cn_032.mp3（各 14 条）
- 以上全部来自线上构建的 assets/ 目录，未做任何裁剪、转码、改名以外的处理（仅重排目录以匹配 pack 内布局）

---
非商业声明：本包与其内含的《明日方舟》相关数据、美术、音频素材版权归鹰角网络 / Yostar 所有，
本包与其无任何关联，不主张任何权利，仅供非商业的学习与个人娱乐使用，请勿用于任何商业场景。
提取与打包：jingjiangze，2026-10-13。目标引擎口径：Stronghold-Protocol-Forge 0.18.3（上游 0.2.5）/ MOD API 1。
线上来源：https://weishuxieyi.icu/_build/f638115c25cd-20/（build f638115c25cd-20 / app 0.2.1）
