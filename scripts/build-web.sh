#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
WEB_DIR="${ROOT_DIR}/web"
ACP_WEB_OUT_DIR="${ACP_WEB_OUT_DIR:-/opt/acp-web/dist-web}"

cd "${WEB_DIR}"
if [[ ! -d "${WEB_DIR}/node_modules" ]]; then
    npm ci
fi
npm run typecheck
npm run build

mkdir -p "${ACP_WEB_OUT_DIR}"
rm -rf "${ACP_WEB_OUT_DIR:?}/"*
cp -r "${WEB_DIR}/dist/." "${ACP_WEB_OUT_DIR}/"
