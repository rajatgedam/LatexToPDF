#!/bin/sh
# Double-click launcher for a source checkout (needs Node 22+). First run installs the engine and builds the UI.
cd "$(dirname "$0")" || exit 1
[ -x vendor/tectonic/tectonic ] && [ -f web/dist/index.html ] || npm run setup || exit 1
exec node bin/latex2pdf-ui.mjs
