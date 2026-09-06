#!/usr/bin/env bash
# 从 starflow 重新构建并拉取引擎单文件；把 DESIGN.md 同步到各副本位置。
set -euo pipefail
here="$(cd "$(dirname "$0")/.." && pwd)"
starflow="${STARFLOW_DIR:-$here/../starflow}"
(cd "$starflow" && npm run build:lib)
cp "$starflow/lib/starflow.js" "$here/assets/starflow.js"
cp "$here/design-systems/openai-astra/DESIGN.md" "$here/references/DESIGN.md"
cp "$here/design-systems/openai-astra/DESIGN.md" "$here/catalog/awesome-design-md/openai-astra/DESIGN.md"
cp "$here/catalog/awesome-design-md/openai-astra/preview.html" "$here/catalog/awesome-design-md/openai-astra/preview-dark.html"
echo "synced: assets/starflow.js, references/DESIGN.md, catalog copies"
