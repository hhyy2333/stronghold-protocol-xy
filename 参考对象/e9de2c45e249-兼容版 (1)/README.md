# CDN 源选择（最快镜像）· cdn-source

读取**发布源排名**（`https://speedcdn.jiangjiangze.icu/cdn/v1/rank.json`，一天四次由实测任务更新），
在根浮层里列出各素材镜像、可现场测速、可把偏好存进本机。

## 它做什么 / 不做什么

- **做**：展示排名（含发布时的内地实测延迟）、浏览器内现场测速（Resource Timing）、把玩家选择的源
  存成偏好（`ctx.session.setPref('source', <id>)`）。
- **不做**：不改素材清单的加载源。管理器 0.13.0 的客户端表面只有 `client.panels` / `theme` /
  `requires`（`docs/MOD-SURFACE.md` 74–81 行），面板拿到的是**只读**快照，没有「改清单 / 拦截网络」的钩子。

## 提案：给引擎加一个 `sources(ctx)` 表面（同 0.13.0 的 appearance 提供者）

形状照 0.13.0 已落地的外观提供者：进程内最多一个提供者，引擎在解析素材 URL 时问它一次：

```js
// 包侧
export function sources(ctx) {
  return { pick(pathname) { /* 返回 { origin } 或 null，null = 用引擎默认 */ } };
}
```

引擎侧只需在素材 URL 解析处加一步（与 `portraitChain.js` 的第 4 步同构）。有了它，本包就能把
`/assets/...` 解析到排名第一的镜像，并在失败时沿排名回退——**这正是"拉清单动态更新 + 选最快源"的落点**。

## 排名从哪来

`rank.json` 由 CDN 仓的 `src/rank.mjs` 生成（一天四次），排序以内地三运营商实测为准，
`liveMs` 是 CI 的即时探测（仅证据）；被排除/不可用的源会被标掉。

## 安装

把本目录打包成 zip（`pack.json` 在根）→ 管理器安装。面板挂在 `root.overlays`（常驻）。

## 兼容性与边界（不兼容的地方写清楚）

| 项 | 要求 / 结论 |
|---|---|
| 管理器版本 | **需要 Forge ≥ 0.13.0**（`client.panels` + `client.requires` 表面）。0.12 及以下**没有面板表面 → 本包不兼容**（装了也不会挂载）。 |
| 浏览器能力 | 需要 `fetch` 与 `PerformanceObserver`；已在 `client.requires` 声明 → 不满足时管理器报「浏览器不支持」，**不会静默不工作**。 |
| **改素材加载源** | **不做，也做不到**：0.13.0 的面板数据是只读快照，没有改清单/拦截网络的钩子。本包只做「排名展示 + 现场测速 + 存偏好」。要真正改源，需引擎加 `sources(ctx)` 表面（提案见上）或走 overlay/extras 的 fetch 重写。 |
| 槽位 | 挂在 `root.overlays`（常驻）。若同槽已有其它包的面板，两者**并列显示**（互不覆盖）。 |
| 与其它包 | 与 `skin-picker` / `skin-catalogue` 无冲突：不注册外观提供者、不写全局、不占用它们的槽位。 |
| 网络 | 只读两个公开 JSON（rank.json / mirrors.json）；探针走各源自己的 `/probe/cdn-probe.bin`；无凭据、无写入。 |
| 离线 | 取不到排名时面板显示「排名取不到」，不抛错、不影响游戏。 |
