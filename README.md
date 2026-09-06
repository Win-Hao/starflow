# 星流发布页 · Starflow launch skill

中文 · [English](#english)

一个给 coding agent 用的 skill：让它直接做出 GPT-6 Astra 发布页那种「星系随滚动翻转、散成星轨、聚成光标和 logo」的暗色发布页。引擎是 [星流 Starflow](https://github.com/Win-Hao/starflow)（three.js，MIT），已经打成单文件放在 `assets/`；agent 只负责接线、排版和写文案，不用重造粒子系统。

同时附带 `design-systems/openai-astra/`：一份按 Open Design 项目规范写的 DESIGN.md 设计系统包（颜色、字阶、版式、动效、禁忌），可以单独丢进任何项目让 Claude Code / Cursor / Codex 生成同风格界面。

## 装法

| 环境 | 做法 |
|---|---|
| Open Design | 应用内「安装 skill」填 `github:Win-Hao/starflow-skill`，或命令行 `od plugin install github:Win-Hao/starflow-skill`。设计系统在顶栏下拉里选 `openai-astra`。 |
| Claude Code / Codex / Cursor | 把仓库 clone 到 agent 的 skills 目录（例如 `~/.claude/skills/starflow-launch/`），对 agent 说「用 starflow 做一个发布页」。 |
| 只要设计系统 | 把 `design-systems/openai-astra/DESIGN.md` 复制到项目根目录。 |
| 只要效果 | 打开 `assets/template.html` 或 `assets/hero.html`，把 `assets/starflow.js` 一起拷走。 |

## 仓库结构

```
SKILL.md                         skill 本体（工作流、规则、反模式）
open-design.json                 Open Design 插件清单
assets/starflow.js               引擎单文件（three + postprocessing 已打包）
assets/template.html             发布页骨架：首屏 chrome、标题段、文案段、两个形状 cue、结尾
assets/hero.html                 纯首屏：?shape= ?text= ?icon= 切形状
references/DESIGN.md             设计系统（同 design-systems 里那份）
references/engine-api.md         引擎 API 与参数
references/choreography.md       四段滚动编排的阈值与几何
design-systems/openai-astra/     Open Design 设计系统包：manifest / DESIGN.md / tokens.css / components / preview / evidence
catalog/awesome-design-md/       投给 VoltAgent/awesome-design-md 用的目录（DESIGN.md + preview）
docs/upstream-prs.md             往两个上游目录投稿的步骤和 PR 文案
scripts/sync.sh                  从 starflow 拉最新引擎、同步 DESIGN.md 副本
```

## 本地预览

```bash
python3 -m http.server 8080
# http://localhost:8080/assets/template.html
# http://localhost:8080/assets/hero.html?shape=openai-knot
# http://localhost:8080/design-systems/openai-astra/components.html
```

## 说明

- 设计系统是对公开页面 CSS 的独立提炼，不含 OpenAI 的字体、logo、图片和脚本，与 OpenAI 无关。
- `openai-knot` 预设是引擎里的一组路径；给别的品牌做页时换成对方的 logo 路径或光标。
- 协议 MIT。

---

## English

A skill for coding agents that builds Astra-style dark launch pages: a galaxy that tilts on scroll, scatters into side rails, and re-forms into a cursor or your logo. The engine is [Starflow](https://github.com/Win-Hao/starflow) (three.js, MIT), bundled as one file in `assets/`; the agent wires it, lays out the page and writes the copy instead of re-inventing the particle system.

It also ships `design-systems/openai-astra/`, a DESIGN.md design-system package in the Open Design project shape (colours, type, layout, motion, anti-patterns) that works on its own in any project with Claude Code, Cursor or Codex.

### Install

| Where | How |
|---|---|
| Open Design | "Install skill" with `github:Win-Hao/starflow-skill`, or `od plugin install github:Win-Hao/starflow-skill`. Pick `openai-astra` in the design-system dropdown. |
| Claude Code / Codex / Cursor | Clone into the agent's skills folder (e.g. `~/.claude/skills/starflow-launch/`) and ask for "a launch page with starflow". |
| Design system only | Copy `design-systems/openai-astra/DESIGN.md` to your project root. |
| Effect only | Open `assets/template.html` or `assets/hero.html` and take `assets/starflow.js` with it. |

### Preview locally

```bash
python3 -m http.server 8080
# http://localhost:8080/assets/template.html
```

### Notes

The design system is an independent distillation of public CSS; no fonts, logos, images or scripts from openai.com are included and the project is not affiliated with OpenAI. MIT licensed.
