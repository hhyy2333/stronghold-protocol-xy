# 素材来源与许可

- **包内容**：官方时装的头像（180×180）与半身像（180×360）WebP，共 276 套 / 174 名干员。
- **来源**：社区整合包「卫戍协议融合版 0.3.3」里的外观插件 `plugins/official-skins-273`（`assets.json` + `skins/*.webp`），
  它是官方客户端素材的整理件；版权归 Hypergryph / Yostar，**仅限非商业同人使用**（与本仓 `NOTICE.md` 同一口径）。
- **为什么不进 git**：`AGENTS.md`「No game art in git」—— 美术素材不入库。`assets/` 与 `PROVENANCE.md` 之外的一切
  （`pack.json`）是文本，可以入库；`assets/`（含 `assets/spine/` 那 302.7 MB 战斗模型）已在 `app/.gitignore`
  里单独忽略。
- **包含局内战斗 Spine**：276 套战斗模型（302.7 MB / 1641 个文件：`.skel` + `.atlas` + 贴图），从融合版的
  `plugins/official-skins-models-1/2/3` 转来，落在 `assets/spine/` 下（同样不进 git）。每套的 `art.spine` 带
  `skel` / `atlas` / `textures` 与 `tools/assets/anim-roles.mjs` 解出来的 `anims`（缺 `anims` 时
  `assets.js validSpine()` 会把它当成没有模型）；骨架全部是 Spine 3.8.99。
- **怎么重建（两半，顺序不能反）**：`node .scratch/make-official-skins.mjs [<融合版插件目录>]` 生成头像与半身像，
  再 `node .scratch/make-official-skin-models.mjs` 补战斗模型（26 套属于本仓没有的干员，两侧都会跳过）。
  两个脚本都不进 git，重跑第二遍会自己报「无变化」。图脚本会整份重写 `pack.json`（连 `name` / `version` /
  `description` 一起改回「只有图」的说法）与本节，所以**先图、后模型**。
- **不包含**：语音。
