#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
DIST_ROOT="${ROOT_DIR}/dist"
PACKAGE_NAME="deep-search-agent"
PACKAGE_DIR="${DIST_ROOT}/${PACKAGE_NAME}"
ARCHIVE_PATH="${DIST_ROOT}/${PACKAGE_NAME}.tar.gz"

echo "Preparing clean distributable package..."
rm -rf "${PACKAGE_DIR}" "${ARCHIVE_PATH}"
mkdir -p "${PACKAGE_DIR}"

copy_if_exists() {
  local src="$1"
  local dst="$2"
  if [[ -e "${src}" ]]; then
    cp -R "${src}" "${dst}"
  fi
}

copy_if_exists "${ROOT_DIR}/backend" "${PACKAGE_DIR}/backend"
copy_if_exists "${ROOT_DIR}/frontend" "${PACKAGE_DIR}/frontend"
copy_if_exists "${ROOT_DIR}/docker-compose.yml" "${PACKAGE_DIR}/docker-compose.yml"
copy_if_exists "${ROOT_DIR}/Makefile" "${PACKAGE_DIR}/Makefile"
copy_if_exists "${ROOT_DIR}/README.md" "${PACKAGE_DIR}/README.md"
copy_if_exists "${ROOT_DIR}/requirements.txt" "${PACKAGE_DIR}/requirements.txt"
copy_if_exists "${ROOT_DIR}/pyproject.toml" "${PACKAGE_DIR}/pyproject.toml"
copy_if_exists "${ROOT_DIR}/uv.lock" "${PACKAGE_DIR}/uv.lock"
copy_if_exists "${ROOT_DIR}/.env.example" "${PACKAGE_DIR}/.env.example"
copy_if_exists "${ROOT_DIR}/.dockerignore" "${PACKAGE_DIR}/.dockerignore"
copy_if_exists "${ROOT_DIR}/.gitignore" "${PACKAGE_DIR}/.gitignore"

# Remove local/development artifacts and sensitive files.
rm -rf "${PACKAGE_DIR}/.venv"
rm -rf "${PACKAGE_DIR}/frontend/node_modules" "${PACKAGE_DIR}/frontend/.next"
rm -rf "${PACKAGE_DIR}/chroma_data"
rm -f "${PACKAGE_DIR}/.env" "${PACKAGE_DIR}/frontend/.env.local"

tar -czf "${ARCHIVE_PATH}" -C "${DIST_ROOT}" "${PACKAGE_NAME}"

echo "Done."
echo "Package directory: ${PACKAGE_DIR}"
echo "Archive: ${ARCHIVE_PATH}"
