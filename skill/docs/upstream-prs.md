# 往上游目录投稿

两个目标，各自一个 PR。都不要把 skill 本体投进去（上游会按「品牌绑定、范围过窄」拒掉），skill 走外部插件安装。

## 1. nexu-io/open-design（设计系统包）

**已提交：<https://github.com/nexu-io/open-design/pull/7806>（2026-09-06，`pnpm guard` 与 `pnpm typecheck` 均通过）。** 后续如需改动，在 fork `Win-Hao/open-design` 的 `add-openai-astra-design-system` 分支上继续提交即可。

要求（CONTRIBUTING.md）：`design-systems/<slug>/` 下 `manifest.json` + `DESIGN.md`（≥7 个实质 H2）+ `tokens.css`；slug = `manifest.id`；DESIGN.md 里的颜色、字体、间距、动效要和 tokens.css 一致；一个 PR 一件事；提交前 `pnpm typecheck`。

```bash
gh repo fork nexu-io/open-design --clone
cd open-design
git checkout -b add-openai-astra-design-system
cp -R ../starflow-skill/design-systems/openai-astra design-systems/openai-astra
pnpm install
pnpm typecheck
pnpm guard            # 校验 manifest 和 token 合约
git add design-systems/openai-astra
git commit -m "add openai-astra design system"
gh pr create --title "add openai-astra design system" --body-file ../starflow-skill/docs/pr-open-design.md
```

PR 描述要点（`docs/pr-open-design.md`）：

- 和现有 `openai` 的区别一句话：`openai` 是 openai.com 的白底编辑风；`openai-astra` 是 GPT-6 Astra 发布页的暗色、粒子、滚动编排风，两者互斥（前者明确「不要视差」）。
- 证据来源：2026-09-05 抓取的公开页面 CSS；粒子编排数值经 Starflow 引擎测得；不含字体、logo、图片、脚本。
- 包含：manifest / DESIGN.md（10 节）/ tokens.css（全部 schema token，无品牌扩展）/ USAGE.md / components.html / 三个 preview / source/evidence.md。
- 未包含：`components.manifest.json`、`design-tokens.json`、`tailwind-v4.css`（派生文件，留给维护者的生成脚本）。

可选第二个 PR：把 skill 登记到社区插件表 `plugins/registry/community/open-design-marketplace.json`，加一条：

```json
{
  "name": "community/starflow-launch",
  "title": "Starflow launch page",
  "version": "0.1.0",
  "source": "github:Win-Hao/starflow-skill@main",
  "publisher": { "id": "win-hao", "github": "Win-Hao", "url": "https://github.com/Win-Hao" },
  "homepage": "https://github.com/Win-Hao/starflow-skill",
  "license": "MIT",
  "capabilitiesSummary": ["prompt:inject", "fs:write"],
  "tags": ["landing", "launch", "hero", "particles", "three.js", "dark"],
  "description": "Astra-style dark launch page or hero with a bundled three.js galaxy that tilts, scatters and re-forms into shapes on scroll."
}
```

## 2. VoltAgent/awesome-design-md（DESIGN.md 目录）

**2026-09 核对：它的 CONTRIBUTING.md 写明「We cannot accept DESIGN.md pull requests to maintain the quality of the existing collection」，只接受对现有条目的修正。** 所以新条目不要投 PR；`catalog/awesome-design-md/openai-astra/` 保留为该目录格式的成品（DESIGN.md + preview.html + preview-dark.html），等它们开放收录或有人在 issue 里要时再用。下面的命令仅在政策变化后使用。

```bash
gh issue create --repo VoltAgent/awesome-design-md \
  --title "Add openai-astra (GPT-6 Astra launch page, dark)" \
  --body "Proposing a dark launch-page system distilled from the GPT-6 Astra page: black canvas, particle galaxy choreography, OpenAI Sans at 500, monochrome pills. Distinct from the light openai.com surface (there is no openai entry yet). Files ready: DESIGN.md (10 sections), preview.html, preview-dark.html. Source: public CSS captured 2026-09-05; no fonts/logos/images."
# 等 issue 回复后：
gh repo fork VoltAgent/awesome-design-md --clone
cd awesome-design-md
git checkout -b add-openai-astra
mkdir -p design-md/openai-astra
cp ../starflow-skill/catalog/awesome-design-md/openai-astra/* design-md/openai-astra/
git add design-md/openai-astra
git commit -m "Add openai-astra DESIGN.md"
gh pr create --title "Add openai-astra DESIGN.md" --body "Closes #<issue>. Dark launch-page system from the GPT-6 Astra page. See DESIGN.md for the 10 sections and preview.html for the catalogue page."
```

## 3. 发布 starflow 到 npm（可选，让 skill 之外的人也能 `npm i starflow`）

```bash
cd starflow
npm login
npm publish --access public
```

发布前 `prepublishOnly` 会自动跑 `build:lib`。
