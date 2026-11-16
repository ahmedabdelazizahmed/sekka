#!/usr/bin/env bash
# Rebuilds the demo, records both videos from a fresh demo state and encodes them to MP4.  Needs ffmpeg + Playwright chromium.
set -e
cd "$(dirname "$0")/.."
npm run demo:build >/dev/null
for mode in h v; do
  pkill -f "dev/server.mjs" 2>/dev/null || true; sleep 1
  node dev/server.mjs >/tmp/sekka-server.log 2>&1 &
  until curl -sf localhost:4173/ >/dev/null; do sleep 1; done
  node dev/record.mjs $mode
  ffmpeg -y -loglevel error -f concat -safe 0 -i out/frames/$mode/list.txt -vf "fps=30,format=yuv420p" -c:v libx264 -preset veryfast -crf 22 -movflags +faststart out/$mode.mp4
done
pkill -f "dev/server.mjs" || true
