#!/usr/bin/env bash
# 从 starflow 重新构建并拉取引擎单文件；用 tokens.css 重建 components.html；同步 DESIGN.md 副本。
# 可选：OD_REPO=/path/to/open-design 时用上游的提取器重新生成 components.manifest.json。
set -euo pipefail
here="$(cd "$(dirname "$0")/.." && pwd)"
starflow="${STARFLOW_DIR:-$here/../starflow}"
pkg="$here/design-systems/openai-astra"

(cd "$starflow" && npm run build:lib)
cp "$starflow/lib/starflow.js" "$here/assets/starflow.js"

# components.html 的第一个 :root 必须与 tokens.css 逐条一致（open-design 的 token-fixture sync 校验）
python3 - "$pkg" "$here/scripts/components.src.html" <<'PY'
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

cp "$pkg/DESIGN.md" "$here/references/DESIGN.md"
cp "$pkg/DESIGN.md" "$here/catalog/awesome-design-md/openai-astra/DESIGN.md"
cp "$here/catalog/awesome-design-md/openai-astra/preview.html" "$here/catalog/awesome-design-md/openai-astra/preview-dark.html"
echo "synced: assets/starflow.js, components.html, references/DESIGN.md, catalog copies"
