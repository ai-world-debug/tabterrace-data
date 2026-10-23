# tabterrace-data

[TabTerrace](https://tabterrace.com) 浏览器扩展用的公开赛程数据。GitHub Actions 每天更新两次，GitHub Pages 发布。

| 文件 | 内容 |
|---|---|
| `sports/index.json` | 当前有哪些赛程文件、更新时间、比赛数 |
| `sports/nba-<赛季>.json` | NBA 一个赛季的赛程（赛季按开始年份，`nba-2026.json` 是 2026-27 赛季） |

每场比赛只有赛程字段：`id`、`start`（UTC 开赛时间，未定时为 `null`）、`date`、`home` / `away`（`abbr` 三字母缩写、`name` 全称）、`postseason`、`state`（`scheduled` / `in_progress` / `final` / `postponed` / `canceled` 等）。不含比分和统计。

数据来自 [balldontlie](https://www.balldontlie.io/)，按其服务条款整理后供 TabTerrace 使用。赛程可能变动，以 NBA 官方为准。

## 维护

- key 存在仓库 Settings → Secrets and variables → Actions 的 `BALLDONTLIE_KEY`，不进代码。
- 手动更新：Actions → 更新 NBA 赛程 → Run workflow，可以填赛季年份。
- 本地试跑：`BALLDONTLIE_KEY=xxx node scripts/fetch-nba.mjs`；测试：`node --test test/*.test.mjs`。
- 拉取失败、一场都没拿到、比赛数骤减一半以上时都不写文件，保留上一份。
