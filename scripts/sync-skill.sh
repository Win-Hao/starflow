#!/usr/bin/env bash
# 重建 design-systems/openai-astra/components.html（把 tokens.css 的 :root 注入 scripts/components.src.html），
# 并把 DESIGN.md 同步到 skill/references 与 docs/awesome-design-md 两个副本。
# 引擎单文件不在这里处理：npm run build:lib 会直接把 lib/starflow.js 写进 skill/assets/。
# 可选：OD_REPO=/path/to/open-design 时用上游自己的提取器重新生成 components.manifest.json。
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
pkg="$root/design-systems/openai-astra"

python3 - "$pkg" "$root/scripts/components.src.html" <<'PY'
import re, sys
pkg, src = sys.argv[1], sys.argv[2]
css = re.sub(r"/\*.*?\*/", "", open(f"{pkg}/tokens.css", encoding="utf-8").read(), flags=re.S)
body = re.search(r":root\s*\{(.*?)\n\}", css, re.S).group(1)
decls = [d.strip() for d in body.split(";") if d.strip()]
html = open(src, encoding="utf-8").read().replace("/*__TOKENS__*/", "\n".join(f"        {d};" for d in decls))
open(f"{pkg}/components.html", "w", encoding="utf-8").write(html)
print("components.html rebuilt with", len(decls), "token declarations")
PY

if [ -n "${OD_REPO:-}" ]; then
  cat > "$OD_REPO/gen-manifest.tmp.ts" <<TS
import { readFile, writeFile } from "node:fs/promises";
import { extractComponentsManifest } from "./packages/contracts/src/design-systems/components-manifest.ts";
const [fixtureHtml, tokensCss] = await Promise.all([readFile("$pkg/components.html", "utf8"), readFile("$pkg/tokens.css", "utf8")]);
const m = extractComponentsManifest({ brandId: "openai-astra", fixtureHtml, tokensCss });
await writeFile("$pkg/components.manifest.json", JSON.stringify(m, null, 2) + "\n", "utf8");
console.log("components.manifest.json:", m.fixture.selectorCount, "selectors, undeclared:", m.tokens.undeclaredReferenced);
TS
  (cd "$OD_REPO" && pnpm exec tsx ./gen-manifest.tmp.ts && rm ./gen-manifest.tmp.ts)
fi

cp "$pkg/DESIGN.md" "$root/skill/references/DESIGN.md"
cp "$pkg/DESIGN.md" "$root/docs/awesome-design-md/openai-astra/DESIGN.md"
cp "$root/docs/awesome-design-md/openai-astra/preview.html" "$root/docs/awesome-design-md/openai-astra/preview-dark.html"
echo "synced: components.html, skill/references/DESIGN.md, docs/awesome-design-md copies"
