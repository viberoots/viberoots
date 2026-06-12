#!/bin/sh
set -eu

direnvrc_line='source $HOME/.nix-profile/share/nix-direnv/direnvrc'
zshrc_line='eval "$(direnv hook zsh)"'
direnvrc_path="${HOME}/.config/direnv/direnvrc"
zshrc_path="${HOME}/.zshrc"
nix_direnv_path="${HOME}/.nix-profile/share/nix-direnv/direnvrc"

if [ "$(uname -s)" != "Darwin" ]; then
  echo "error: this bootstrap helper is intended for macOS." >&2
  exit 1
fi

if ! command -v nix >/dev/null 2>&1; then
  echo "error: nix is required. Install Determinate Nix first:" >&2
  echo "  https://determinate.systems/nix-installer/" >&2
  exit 1
fi

if ! command -v direnv >/dev/null 2>&1; then
  nix profile install nixpkgs#direnv
fi

if [ ! -f "${nix_direnv_path}" ]; then
  nix profile install nixpkgs#nix-direnv
fi

mkdir -p "$(dirname "${direnvrc_path}")"
touch "${direnvrc_path}"
if ! grep -qxF "${direnvrc_line}" "${direnvrc_path}"; then
  printf '%s\n' "${direnvrc_line}" >> "${direnvrc_path}"
fi

touch "${zshrc_path}"
if ! grep -qxF "${zshrc_line}" "${zshrc_path}"; then
  printf '%s\n' "${zshrc_line}" >> "${zshrc_path}"
fi

echo "macOS direnv setup complete."
echo "Restart zsh or run: source ~/.zshrc"
