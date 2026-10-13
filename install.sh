#!/usr/bin/env sh
# ==============================================================================
# CyberVPS SPACE STATION - Universal Zero-Friction Bootstrap Installer
# Cross-Platform: Ubuntu, Debian, Linux VPS, Termux, Non-Root SSH, Daytona
# Official Repository: https://github.com/cyberdrivepro/cybervps-space-station
# ==============================================================================

set -e

REPO_URL="https://github.com/cyberdrivepro/cybervps-space-station.git"
TARBALL_URL="https://github.com/cyberdrivepro/cybervps-space-station/archive/refs/heads/main.tar.gz"
INSTALL_BASE="${HOME}/.cybervps"
INSTALL_DIR="${INSTALL_BASE}/space-station"
BIN_DIR="${INSTALL_BASE}/bin"

echo "================================================================"
echo "🛰️  CYBERVPS SPACE STATION UNIVERSAL INSTALLER"
echo "================================================================"

# 1. Environment & Architecture Detection
OS="$(uname -s 2>/dev/null || echo 'Unknown')"
ARCH="$(uname -m 2>/dev/null || echo 'Unknown')"
USER_NAME="$(whoami 2>/dev/null || echo 'user')"

echo "[*] Detected OS: ${OS} (${ARCH}) | User: ${USER_NAME}"

# Detect Termux
IS_TERMUX=0
if [ -n "${TERMUX_VERSION}" ] || [ -d "/data/data/com.termux" ]; then
  IS_TERMUX=1
  echo "[*] Termux environment detected."
fi

# Detect Daytona Sandbox
if [ -n "${DAYTONA_SANDBOX_ID}" ]; then
  echo "[*] Daytona Cloud Sandbox detected (${DAYTONA_SANDBOX_ID})."
fi

# 2. Check Download Tools (curl / wget)
DOWNLOAD_TOOL=""
if command -v curl >/dev/null 2>&1; then
  DOWNLOAD_TOOL="curl"
elif command -v wget >/dev/null 2>&1; then
  DOWNLOAD_TOOL="wget"
else
  echo "❌ Error: Neither 'curl' nor 'wget' is available on this system."
  echo "👉 Please install curl (e.g. 'sudo apt-get install -y curl' or 'pkg install curl') and retry."
  exit 1
fi

fetch_file() {
  url="$1"
  dest="$2"
  if [ "$DOWNLOAD_TOOL" = "curl" ]; then
    curl -fsSL -o "$dest" "$url"
  else
    wget -qO "$dest" "$url"
  fi
}

# 3. Create Installation Folders (Safe non-root user space)
mkdir -p "${INSTALL_BASE}" "${BIN_DIR}" "${INSTALL_BASE}/run" "${INSTALL_BASE}/logs"

# 4. Fetch CyberVPS Space Station Codebase
if [ -d "${INSTALL_DIR}/.git" ]; then
  echo "[*] Existing installation found in ${INSTALL_DIR}. Updating..."
  cd "${INSTALL_DIR}"
  git fetch origin main || true
  git reset --hard origin/main || true
elif command -v git >/dev/null 2>&1; then
  echo "[*] Cloning repository via Git..."
  rm -rf "${INSTALL_DIR}"
  if ! git clone --depth 1 "${REPO_URL}" "${INSTALL_DIR}"; then
    echo "❌ Git clone failed. Stopping installation; no project commands were executed."
    exit 1
  fi
  cd "${INSTALL_DIR}"
else
  echo "[*] Git not found. Downloading repository tarball from GitHub..."
  rm -rf "${INSTALL_DIR}"
  mkdir -p "${INSTALL_DIR}"
  TAR_FILE="${INSTALL_BASE}/cybervps.tar.gz"
  if ! fetch_file "${TARBALL_URL}" "${TAR_FILE}"; then
    echo "❌ Failed to download repository package from GitHub."
    echo "👉 Please verify network connectivity and repository access."
    exit 1
  fi
  tar -xzf "${TAR_FILE}" -C "${INSTALL_DIR}" --strip-components=1
  rm -f "${TAR_FILE}"
  cd "${INSTALL_DIR}"
fi

# Verify expected files exist before running any build commands
if [ ! -f "${INSTALL_DIR}/package.json" ] || [ ! -f "${INSTALL_DIR}/services/server.js" ]; then
  echo "❌ Verification failed: Application files missing in ${INSTALL_DIR}."
  exit 1
fi

# 5. Check Node.js Runtime
if ! command -v node >/dev/null 2>&1; then
  echo "[!] Node.js runtime not found in PATH."
  if [ "${IS_TERMUX}" = "1" ]; then
    echo "[*] Attempting Termux package installation for nodejs..."
    pkg install -y nodejs || true
  fi

  if ! command -v node >/dev/null 2>&1; then
    echo "❌ Error: Node.js (v18+) is required to run CyberVPS Space Station."
    echo "👉 Install Node.js via:"
    echo "   Ubuntu/Debian: sudo apt-get update && sudo apt-get install -y nodejs npm"
    echo "   Termux:        pkg install nodejs"
    echo "   Or NVM:        curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash"
    exit 1
  fi
fi

NODE_VERSION="$(node -v)"
echo "[*] Active Node.js runtime: ${NODE_VERSION}"

# 6. Install Dependencies safely inside the application directory
echo "[*] Verifying production dependencies..."
if command -v npm >/dev/null 2>&1; then
  npm install --omit=dev --no-audit --no-fund >/dev/null 2>&1 || true
fi

# 7. Setup CLI Executable in PATH
chmod +x "${INSTALL_DIR}/bin/cybervps"
ln -sf "${INSTALL_DIR}/bin/cybervps" "${BIN_DIR}/cybervps"

# Try user-local bin link
if [ -d "${HOME}/.local/bin" ]; then
  ln -sf "${INSTALL_DIR}/bin/cybervps" "${HOME}/.local/bin/cybervps" 2>/dev/null || true
fi

# Configure PATH in shell rc if needed
SHELL_RC=""
if [ -f "${HOME}/.bashrc" ]; then
  SHELL_RC="${HOME}/.bashrc"
elif [ -f "${HOME}/.zshrc" ]; then
  SHELL_RC="${HOME}/.zshrc"
elif [ -f "${HOME}/.profile" ]; then
  SHELL_RC="${HOME}/.profile"
fi

if [ -n "${SHELL_RC}" ]; then
  if ! grep -q "${BIN_DIR}" "${SHELL_RC}" 2>/dev/null; then
    echo "export PATH=\"${BIN_DIR}:\$PATH\"" >> "${SHELL_RC}"
  fi
fi
export PATH="${BIN_DIR}:${PATH}"

# 8. Run Self-Diagnostics
echo ""
echo "[*] Executing system health check..."
node "${INSTALL_DIR}/bin/cybervps" doctor || true

echo ""
echo "================================================================"
echo "🎉 CYBERVPS SPACE STATION INSTALLED SUCCESSFULLY!"
echo "================================================================"
echo "👉 Start Space Station (Interactive):"
echo "   cybervps start"
echo ""
echo "👉 Start in Background (Daemon):"
echo "   cybervps start --daemon"
echo ""
echo "👉 Check Status & Live URLs:"
echo "   cybervps status"
echo "================================================================"
