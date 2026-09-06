# starflow-launch · 星流发布页 skill

中文 · [English](#english)

给 coding agent 用的 skill：直接做出 GPT-6 Astra 发布页那种「星系随滚动翻转、散成星轨、聚成光标和 logo」的暗色发布页。引擎就是本仓库的 [星流 Starflow](../README.md)，已打成单文件放在 `assets/`；agent 只负责接线、排版和写文案。

这个目录是自包含的：`assets/starflow.js` 由 `npm run build:lib` 自动写入，`references/DESIGN.md` 是仓库根 [`design-systems/openai-astra/`](../design-systems/openai-astra/) 的副本（`scripts/sync-skill.sh` 同步）。

## 装法

| 环境 | 做法 |
|---|---|
| Open Design | 应用内「安装 skill」填 `github:Win-Hao/starflow@main/skill`，或 `od plugin install github:Win-Hao/starflow@main/skill`。设计系统在顶栏下拉里选 `openai-astra`（把 `design-systems/openai-astra/` 放进它的 `data/design-systems/`）。 |
| Claude Code / Codex / Cursor | 把本目录拷到 agent 的 skills 目录（例如 `~/.claude/skills/starflow-launch/`），对 agent 说「用 starflow 做一个发布页」。 |
| 只要效果 | 打开 `assets/template.html` 或 `assets/hero.html`，把 `assets/starflow.js` 一起拷走。 |

## 文件

```
SKILL.md                   skill 本体（工作流、规则、反模式）
open-design.json           Open Design 插件清单
assets/starflow.js         引擎单文件（three + postprocessing 已打包）
assets/template.html       发布页骨架：首屏 chrome、标题段、文案段、两个形状 cue、结尾
assets/hero.html           纯首屏：?shape= ?text= ?icon= 切形状
references/DESIGN.md       设计系统副本
references/engine-api.md   引擎 API 与参数
references/choreography.md 四段滚动编排的阈值与几何
```

---

## English

A skill for coding agents that builds Astra-style dark launch pages: a galaxy that tilts on scroll, scatters into side rails and re-forms into a cursor or your logo. The engine is [Starflow](../README.en.md) in this repository, bundled as one file in `assets/`.

This folder is self-contained: `assets/starflow.js` is written by `npm run build:lib`; `references/DESIGN.md` is a copy of [`design-systems/openai-astra/`](../design-systems/openai-astra/) at the repo root.

### Install

| Where | How |
|---|---|
| Open Design | "Install skill" with `github:Win-Hao/starflow@main/skill`, or `od plugin install github:Win-Hao/starflow@main/skill`. Pick `openai-astra` in the design-system dropdown after dropping `design-systems/openai-astra/` into its `data/design-systems/`. |
| Claude Code / Codex / Cursor | Copy this folder into the agent's skills directory (e.g. `~/.claude/skills/starflow-launch/`) and ask for "a launch page with starflow". |
| Effect only | Open `assets/template.html` or `assets/hero.html` and take `assets/starflow.js` with it. |
