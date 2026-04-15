#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
IMAGE_NAME="${E2E_ACT_IMAGE:-setup-snx-rs-vpn-e2e:local}"
SECRETS_FILE="${E2E_SECRETS_FILE:-${ROOT_DIR}/e2e/secrets.env}"
WORKFLOW_PATH="${ROOT_DIR}/.github/workflows/e2e.yml"
ACT_HOME="${E2E_ACT_HOME:-/tmp/act-home}"
ACT_CACHE_HOME="${E2E_ACT_CACHE_HOME:-/tmp/act-cache}"

if ! command -v docker >/dev/null 2>&1; then
  echo "docker is required" >&2
  exit 1
fi

if ! command -v act >/dev/null 2>&1; then
  echo "act is required" >&2
  exit 1
fi

if [[ ! -f "${SECRETS_FILE}" ]]; then
  echo "Missing secrets file: ${SECRETS_FILE}" >&2
  echo "Copy e2e/secrets.env.example to e2e/secrets.env and fill in real values." >&2
  exit 1
fi

docker build -t "${IMAGE_NAME}" -f "${ROOT_DIR}/e2e/runner/Dockerfile" "${ROOT_DIR}"

mkdir -p "${ACT_HOME}" "${ACT_CACHE_HOME}"

export HOME="${ACT_HOME}"
export XDG_CACHE_HOME="${ACT_CACHE_HOME}"

exec act workflow_dispatch \
  --workflows "${WORKFLOW_PATH}" \
  --secret-file "${SECRETS_FILE}" \
  --pull=false \
  --container-options "--privileged --cap-add=NET_ADMIN --cap-add=NET_RAW" \
  -P "ubuntu-latest=${IMAGE_NAME}" \
  "$@"
