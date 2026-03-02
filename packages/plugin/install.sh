#!/usr/bin/env bash
# DevScope Plugin Installer
# Usage: bash <(curl -fsSL https://raw.githubusercontent.com/DowLucas/devscope-plugin/main/install.sh)
set -euo pipefail

DEVSCOPE_VERSION="1.0.0"
GUM_VERSION="0.17.0"
GUM=""
TMPDIR_CLEANUP=""

# ─── Colors (ANSI fallback) ─────────────────────────────────────────────────

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
MAGENTA='\033[0;35m'
CYAN='\033[0;36m'
BOLD='\033[1m'
DIM='\033[2m'
RESET='\033[0m'

# ─── Cleanup ─────────────────────────────────────────────────────────────────

cleanup() {
  if [[ -n "$TMPDIR_CLEANUP" && -d "$TMPDIR_CLEANUP" ]]; then
    rm -rf "$TMPDIR_CLEANUP"
  fi
}
trap cleanup EXIT

# ─── Gum setup ───────────────────────────────────────────────────────────────

setup_gum() {
  # Use system gum if available
  if command -v gum &>/dev/null; then
    GUM="gum"
    return 0
  fi

  # Detect OS and arch
  local os arch
  os="$(uname -s | tr '[:upper:]' '[:lower:]')"
  arch="$(uname -m)"

  case "$os" in
    linux)  os="Linux" ;;
    darwin) os="Darwin" ;;
    *)
      printf '%b\n' "${YELLOW}Unsupported OS for gum auto-download: $os${RESET}"
      return 1
      ;;
  esac

  case "$arch" in
    x86_64)  arch="x86_64" ;;
    aarch64|arm64) arch="arm64" ;;
    *)
      printf '%b\n' "${YELLOW}Unsupported architecture for gum auto-download: $arch${RESET}"
      return 1
      ;;
  esac

  # Download gum to temp dir
  TMPDIR_CLEANUP="$(mktemp -d)"
  local url="https://github.com/charmbracelet/gum/releases/download/v${GUM_VERSION}/gum_${GUM_VERSION}_${os}_${arch}.tar.gz"
  local tarball="${TMPDIR_CLEANUP}/gum.tar.gz"

  printf '%b\n' "${DIM}Downloading gum for interactive UI...${RESET}"
  if curl -fsSL --connect-timeout 10 -o "$tarball" "$url" 2>/dev/null; then
    tar -xzf "$tarball" -C "$TMPDIR_CLEANUP" 2>/dev/null
    # gum binary may be at top level or in a subdirectory
    local gum_bin
    gum_bin="$(find "$TMPDIR_CLEANUP" -name gum -type f -perm -u+x 2>/dev/null | head -1)"
    if [[ -z "$gum_bin" ]]; then
      # Try without perm check (macOS compatibility)
      gum_bin="$(find "$TMPDIR_CLEANUP" -name gum -type f 2>/dev/null | head -1)"
      if [[ -n "$gum_bin" ]]; then
        chmod +x "$gum_bin"
      fi
    fi
    if [[ -n "$gum_bin" ]]; then
      GUM="$gum_bin"
      return 0
    fi
  fi

  printf '%b\n' "${YELLOW}Could not download gum — using basic terminal UI${RESET}"
  return 1
}

# ─── UI wrappers (gum with bash fallback) ────────────────────────────────────

banner() {
  local title="$1"
  local subtitle="${2:-}"

  if [[ -n "$GUM" ]]; then
    if [[ -n "$subtitle" ]]; then
      printf '%s\n%s' "$title" "$subtitle" | $GUM style \
        --border double \
        --border-foreground 212 \
        --padding "1 3" \
        --margin "1 0" \
        --align center \
        --bold
    else
      $GUM style \
        --border double \
        --border-foreground 212 \
        --padding "1 3" \
        --margin "1 0" \
        --align center \
        --bold \
        "$title"
    fi
  else
    printf '\n'
    printf '%b\n' "  ${MAGENTA}╔══════════════════════════════════════════╗${RESET}"
    printf '%b\n' "  ${MAGENTA}║${RESET}  ${BOLD}${title}${RESET}"
    if [[ -n "$subtitle" ]]; then
      printf '%b\n' "  ${MAGENTA}║${RESET}  ${DIM}${subtitle}${RESET}"
    fi
    printf '%b\n' "  ${MAGENTA}╚══════════════════════════════════════════╝${RESET}"
    printf '\n'
  fi
}

info() {
  if [[ -n "$GUM" ]]; then
    $GUM style --foreground 39 "  $1"
  else
    printf '%b\n' "  ${CYAN}$1${RESET}"
  fi
}

success() {
  if [[ -n "$GUM" ]]; then
    $GUM style --foreground 82 "  ✓ $1"
  else
    printf '%b\n' "  ${GREEN}✓ $1${RESET}"
  fi
}

warn() {
  if [[ -n "$GUM" ]]; then
    $GUM style --foreground 214 "  ⚠ $1"
  else
    printf '%b\n' "  ${YELLOW}⚠ $1${RESET}"
  fi
}

fail() {
  if [[ -n "$GUM" ]]; then
    $GUM style --foreground 196 "  ✗ $1"
  else
    printf '%b\n' "  ${RED}✗ $1${RESET}"
  fi
}

spin() {
  local title="$1"
  shift
  if [[ -n "$GUM" ]]; then
    $GUM spin --spinner dot --title "$title" -- "$@"
  else
    printf '%b\n' "  ${DIM}${title}${RESET}"
    "$@"
  fi
}

choose() {
  local header="$1"
  shift
  if [[ -n "$GUM" ]]; then
    $GUM choose --header "$header" "$@"
  else
    printf '\n%b\n' "  ${BOLD}${header}${RESET}" >/dev/tty
    local i=1
    for opt in "$@"; do
      printf '%b\n' "  ${CYAN}${i})${RESET} ${opt}" >/dev/tty
      ((i++))
    done
    local choice
    while true; do
      printf '%b' "  ${BOLD}Enter choice [1-$#]: ${RESET}" >/dev/tty
      read -r choice </dev/tty
      if [[ "$choice" =~ ^[0-9]+$ ]] && (( choice >= 1 && choice <= $# )); then
        local idx=1
        for opt in "$@"; do
          if (( idx == choice )); then
            echo "$opt"
            return 0
          fi
          ((idx++))
        done
      fi
      printf '%b\n' "  ${RED}Invalid choice${RESET}" >/dev/tty
    done
  fi
}

input_prompt() {
  local header="$1"
  local placeholder="${2:-}"
  if [[ -n "$GUM" ]]; then
    $GUM input --header "$header" --placeholder "$placeholder"
  else
    printf '\n%b\n' "  ${BOLD}${header}${RESET}" >/dev/tty
    if [[ -n "$placeholder" ]]; then
      printf '%b\n' "  ${DIM}(${placeholder})${RESET}" >/dev/tty
    fi
    printf '  > ' >/dev/tty
    local value
    read -r value </dev/tty
    echo "$value"
  fi
}

confirm_prompt() {
  local prompt="$1"
  if [[ -n "$GUM" ]]; then
    $GUM confirm "$prompt"
  else
    printf '\n%b' "  ${BOLD}${prompt} [y/N]: ${RESET}" >/dev/tty
    local answer
    read -r answer </dev/tty
    [[ "$answer" =~ ^[Yy]$ ]]
  fi
}

# ─── Main installer ──────────────────────────────────────────────────────────

main() {
  # Step 0: Setup gum (non-fatal)
  setup_gum || true

  # Step 1: Welcome banner
  banner "DevScope Installer" "v${DEVSCOPE_VERSION} — Real-time Claude Code monitoring"

  # Step 2: Check prerequisites
  info "Checking prerequisites..."
  echo ""

  local prereqs_ok=true

  if command -v claude &>/dev/null; then
    success "claude CLI found"
  else
    fail "claude CLI not found"
    fail "Install Claude Code first: https://claude.ai/code"
    prereqs_ok=false
  fi

  if command -v curl &>/dev/null; then
    success "curl found"
  else
    fail "curl not found — required for plugin communication"
    prereqs_ok=false
  fi

  if command -v jq &>/dev/null; then
    success "jq found"
  else
    warn "jq not found — plugin works without it but recommended"
    warn "Install: https://jqlang.github.io/jq/download/"
  fi

  echo ""

  if [[ "$prereqs_ok" == "false" ]]; then
    fail "Missing required prerequisites. Install them and re-run this script."
    exit 1
  fi

  # Step 3: Install plugin
  info "Installing DevScope plugin..."
  echo ""

  local install_ok=true

  # Run claude commands directly (they have their own progress output
  # and conflict with gum spin's terminal handling)
  if claude plugin marketplace add DowLucas/devscope-plugin 2>/dev/null; then
    success "Marketplace added"
  else
    warn "Marketplace add returned non-zero (may already be added)"
  fi

  if claude plugin install devscope 2>/dev/null; then
    success "Plugin installed"
  else
    fail "Plugin installation failed"
    install_ok=false
  fi

  echo ""

  if [[ "$install_ok" == "false" ]]; then
    fail "Plugin installation failed. Check claude CLI output and retry."
    exit 1
  fi

  # Step 4: Configure
  info "Configuring DevScope..."
  echo ""

  local server_url
  local selection
  selection="$(choose "Select your DevScope server:" \
    "https://devscope.sh  (cloud — hosted for you)" \
    "http://localhost:6767  (local development)" \
    "http://localhost  (Docker with Caddy)" \
    "Custom URL")"

  case "$selection" in
    *devscope.sh*)
      server_url="https://devscope.sh"
      ;;
    *localhost:6767*)
      server_url="http://localhost:6767"
      ;;
    *"Docker with Caddy"*)
      server_url="http://localhost"
      ;;
    *)
      server_url="$(input_prompt "Enter your DevScope server URL:" "https://devscope.example.com")"
      if [[ -z "$server_url" ]]; then
        server_url="https://devscope.sh"
        warn "No URL entered — defaulting to $server_url"
      fi
      ;;
  esac

  success "Server URL: $server_url"
  echo ""

  local api_key=""
  if confirm_prompt "Configure an API key? (generate one from Dashboard → Settings)" || false; then
    api_key="$(input_prompt "Enter your API key:" "dsk_...")"
  fi

  # Step 5: Write config
  local config_dir="${XDG_CONFIG_HOME:-$HOME/.config}/devscope"
  local config_file="${config_dir}/config"

  mkdir -p "$config_dir"

  {
    echo "# DevScope plugin configuration"
    echo "# Generated by install.sh on $(date -u +%Y-%m-%dT%H:%M:%SZ)"
    echo "DEVSCOPE_URL=${server_url}"
    if [[ -n "$api_key" ]]; then
      echo "DEVSCOPE_API_KEY=${api_key}"
    fi
  } > "$config_file"

  chmod 600 "$config_file"
  success "Config written to $config_file"
  echo ""

  # Step 6: Test connection
  info "Testing connection to $server_url..."

  local health_url="${server_url}/api/health"
  local http_code
  if http_code="$(curl -fsSL --connect-timeout 5 -o /dev/null -w '%{http_code}' "$health_url" 2>/dev/null)"; then
    if [[ "$http_code" == "200" ]]; then
      success "Server is reachable (HTTP $http_code)"
    else
      warn "Server responded with HTTP $http_code (expected 200)"
    fi
  else
    warn "Could not reach $health_url"
    warn "Make sure your DevScope server is running"
  fi

  echo ""

  # Step 7: Success banner
  banner "DevScope installed!" "Start a Claude Code session to begin monitoring"

  info "Useful commands:"
  printf '%b\n' "  ${DIM}  /devscope:setup    — reconfigure server URL / API key${RESET}"
  printf '%b\n' "  ${DIM}  claude plugin list  — verify plugin is installed${RESET}"
  echo ""
}

main "$@"
