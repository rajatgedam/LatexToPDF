#!/bin/sh
# Double-click launcher for a source checkout (needs Node 22+). First run installs the engines and builds the web app.
cd "$(dirname "$0")" || exit 1
[ -d vendor ] && [ -f web/dist/index.html ] || npm run setup || exit 1
exec node bin/toolmaster.mjs ui
