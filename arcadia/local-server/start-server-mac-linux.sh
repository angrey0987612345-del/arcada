#!/usr/bin/env bash
cd "$(dirname "$0")"
command -v node >/dev/null || { echo "Установите Node.js: https://nodejs.org"; exit 1; }
node server.mjs "$@"
