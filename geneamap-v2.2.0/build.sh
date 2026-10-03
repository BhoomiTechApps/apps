#!/usr/bin/env sh
# Rebuild the production files in this folder from dev/ sources.
# Requires Node.js (uses npx terser + clean-css-cli).
set -e
cd "$(dirname "$0")"
# drop_debugger=false keeps the developer-tools check; the closure lets terser mangle every name
npx --yes terser dev/code.js --compress passes=2,drop_debugger=false --mangle --ecma 2020 -o code.min.js
npx --yes clean-css-cli -O1 -o style.min.css dev/style.css
# fonts are referenced from dev/ as ../assets/… — at the root they are assets/…
sed -i 's#\.\./assets/#assets/#g' style.min.css
sed -e 's#href="\.\./#href="#g' \
    -e 's#href="style\.css"#href="style.min.css"#' \
    -e 's#src="code\.js"#src="code.min.js"#' \
    dev/index.html > index.html
# bump the service-worker cache name so installed apps fetch the new build
sed -i "s/const VERSION = 'geneamap-v[0-9]*'/const VERSION = 'geneamap-v$(date +%Y%m%d%H%M)'/" sw.js
echo "Built: code.min.js style.min.css index.html"
