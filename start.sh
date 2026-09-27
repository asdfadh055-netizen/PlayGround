#!/usr/bin/env bash
# Serve the static 3D fighter and publish deployment output for the controller.
set -euo pipefail
cd "$(dirname "$0")"
/usr/bin/time -p test -f index.html
PORT="${PORT:-3000}"
export PORT
PROJECT_DIR="$(/usr/bin/time -p pwd)"
if [[ -n "${OPENCODE_WEB_DIR:-}" ]]; then
  /usr/bin/time -p mkdir -p "$OPENCODE_WEB_DIR"
  /usr/bin/time -p node -e 'const fs=require("fs"),path=require("path");const dir=process.env.OPENCODE_WEB_DIR;const project=process.cwd();fs.writeFileSync(path.join(dir,"deployment-output.json"),JSON.stringify({project,directory:project}))'
  /usr/bin/time -p cat "${OPENCODE_WEB_DIR}/deployment-output.json"
fi
/usr/bin/time -p node --version
echo "Starting Rooftop Clash on PORT=$PORT"
exec node serve.mjs
