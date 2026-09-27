#!/usr/bin/env bash
# Capture desktop + mobile screenshots of the running game.
set -euo pipefail
cd "$(dirname "$0")"
/usr/bin/time -p test -f capture-run.mjs
: "${CAPTURE_URL:?Set CAPTURE_URL}"
: "${CAPTURE_DIR:?Set CAPTURE_DIR}"
/usr/bin/time -p mkdir -p "$CAPTURE_DIR"
/usr/bin/time -p node --version
/usr/bin/time -p node capture-run.mjs
/usr/bin/time -p ls -la "$CAPTURE_DIR"
/usr/bin/time -p node -e 'const fs=require("fs"),p=require("path");for(const n of ["final-desktop.png","final-mobile.png"]){const f=p.join(process.env.CAPTURE_DIR,n);const b=fs.readFileSync(f);if(b.length<24||b.subarray(0,8).toString("hex")!=="89504e470d0a1a0a"){console.error("not a PNG: "+n);process.exit(1)}console.log(n,b.length+" bytes")}'
