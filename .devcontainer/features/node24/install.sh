#!/bin/bash
set -euo pipefail

# Install the official Node.js 24 binary distribution.
#
# Why the tarball rather than apt or nvm:
#   - apt ships whatever the distro has, which for Node 24 depends on this base
#     image's Debian release. That is not something we control or can reproduce.
#   - nvm is present in this image (NVM_DIR=/usr/local/share/nvm) but has no
#     versions installed, so depending on it couples this feature to image state.
# The tarball is version-exact, checksum-verified, and lands in /opt so it cannot
# clobber anything the base image placed under /usr/local.

NODE_MAJOR="${NODE_MAJOR:-24}"
INSTALL_ROOT="/opt/node-${NODE_MAJOR}"

case "$(uname -m)" in
  x86_64 | amd64)
    NODE_ARCH="x64"
    ;;
  aarch64 | arm64)
    NODE_ARCH="arm64"
    ;;
  *)
    echo "❌ Unsupported architecture: $(uname -m)" >&2
    exit 1
    ;;
esac

# "latest-v24.x" tracks the newest patch of that major, so security fixes arrive
# without anyone editing this file.
BASE_URL="https://nodejs.org/dist/latest-v${NODE_MAJOR}.x"

if [ -x "${INSTALL_ROOT}/bin/node" ]; then
  echo "Node.js $( "${INSTALL_ROOT}/bin/node" --version ) already at ${INSTALL_ROOT}. Skipping download."
else
  # Resolve the real filename rather than assuming a patch number.
  FILENAME="$(
    curl -fsSL "${BASE_URL}/SHASUMS256.txt" |
      grep -E "node-v${NODE_MAJOR}\.[0-9]+\.[0-9]+-linux-${NODE_ARCH}\.tar\.gz$" |
      awk '{print $2}' |
      tail -n 1 || true
  )"

  if [ -z "${FILENAME}" ]; then
    echo "❌ No Node.js ${NODE_MAJOR} linux-${NODE_ARCH} tarball at ${BASE_URL}" >&2
    exit 1
  fi

  echo "Installing ${FILENAME} → ${INSTALL_ROOT}"

  WORK="$(mktemp -d)"
  # shellcheck disable=SC2064
  trap "rm -rf '${WORK}'" EXIT

  curl -fsSL -o "${WORK}/${FILENAME}" "${BASE_URL}/${FILENAME}"
  curl -fsSL -o "${WORK}/SHASUMS256.txt" "${BASE_URL}/SHASUMS256.txt"

  # Verify before executing anything from the download.
  (cd "${WORK}" && grep " ${FILENAME}\$" SHASUMS256.txt | sha256sum -c -)

  mkdir -p "${INSTALL_ROOT}"
  tar -xzf "${WORK}/${FILENAME}" -C "${INSTALL_ROOT}" --strip-components=1

  # Symlink rather than relying only on PATH: /usr/local/bin precedes /usr/bin in
  # the default PATH, so this wins over the base image's Node even in shells that
  # never source a profile.
  for bin in node npm npx corepack; do
    if [ -e "${INSTALL_ROOT}/bin/${bin}" ]; then
      ln -sf "${INSTALL_ROOT}/bin/${bin}" "/usr/local/bin/${bin}"
    fi
  done
fi

# Prepend PATH for interactive shells too, so an absolute-path caller and a
# login shell both resolve to the same Node.
cat >/etc/profile.d/nodejs.sh <<EOF
export PATH="${INSTALL_ROOT}/bin:\$PATH"
EOF
chmod 0644 /etc/profile.d/nodejs.sh

echo "✅ Node.js $(node --version) → $(command -v node)"
echo "   npm $(npm --version)"
