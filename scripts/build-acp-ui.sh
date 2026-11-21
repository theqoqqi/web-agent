#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

ACP_UI_REPO="${ACP_UI_REPO:-https://github.com/formulahendry/acp-ui.git}"
ACP_UI_REF="${ACP_UI_REF:-main}"
ACP_UI_WORK_DIR="${ACP_UI_WORK_DIR:-${ROOT_DIR}/.cache/acp-ui}"
ACP_WEB_OUT_DIR="${ACP_WEB_OUT_DIR:-/opt/acp-web/dist-web}"
ACP_AGENT_NAME="${ACP_AGENT_NAME:-Antigravity}"
ACP_WS_PATH="${ACP_WS_PATH:-/ws}"

cd "${ROOT_DIR}"
if [[ ! -d "${ROOT_DIR}/node_modules" ]]; then
    npm ci
fi
npm run build

mkdir -p "$(dirname "${ACP_UI_WORK_DIR}")"
if [[ ! -d "${ACP_UI_WORK_DIR}/.git" ]]; then
    git clone --depth 1 --branch "${ACP_UI_REF}" "${ACP_UI_REPO}" "${ACP_UI_WORK_DIR}"
else
    git -C "${ACP_UI_WORK_DIR}" fetch origin "${ACP_UI_REF}" --depth 1
    git -C "${ACP_UI_WORK_DIR}" checkout -f FETCH_HEAD
fi

cd "${ACP_UI_WORK_DIR}"
npm ci
npm run build:web

mkdir -p "${ACP_WEB_OUT_DIR}"
rm -rf "${ACP_WEB_OUT_DIR:?}/"*
cp -r "${ACP_UI_WORK_DIR}/dist-web/." "${ACP_WEB_OUT_DIR}/"

node "${ROOT_DIR}/dist/patch-acp-ui.js" "${ACP_WEB_OUT_DIR}/index.html" \
    --agent "${ACP_AGENT_NAME}" \
    --ws-path "${ACP_WS_PATH}"
