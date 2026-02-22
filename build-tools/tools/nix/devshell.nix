{ pkgs, buck2Input }:
let
  zx-wrapper = pkgs.writeShellScriptBin "zx-wrapper" ''
    set -euo pipefail
    exec ${pkgs.nodejs_22}/bin/node \
      --experimental-strip-types \
      --experimental-top-level-await \
      --disable-warning=ExperimentalWarning \
      --import="${pkgs.nodePackages.zx}/lib/node_modules/zx/build/globals.js" \
      "$@"
  '';
in {
  default = pkgs.mkShell {
    shellHook = ''
      # Guard against recursive shell hook invocation
      if [ -n "''${_BUCKNIX_DEVSHELL_ACTIVE:-}" ]; then
        return 0
      fi
      export _BUCKNIX_DEVSHELL_ACTIVE=1
      is_interactive=0
      case "$-" in
        *i*) is_interactive=1 ;;
      esac
      
      if [ -e node_modules ] && [ ! -L node_modules ]; then
        echo "(devShell) existing non-symlink node_modules detected; not overwriting" >&2 || true
      else
        zx-wrapper "$PWD/build-tools/tools/dev/devshell-link-node-modules.ts" || true
      fi

      export PATH="$PWD/build-tools/tools/bin:$PWD/node_modules/.bin:$PATH"
      
      cache_dir="$PWD/buck-out/tmp/devshell-cache"
      mkdir -p "$cache_dir" 2>/dev/null || true
      lock_hash=""
      if [ -f flake.lock ]; then
        if command -v shasum >/dev/null 2>&1; then
          lock_hash="$(shasum -a 256 flake.lock 2>/dev/null | awk '{print $1}')"
        elif command -v sha256sum >/dev/null 2>&1; then
          lock_hash="$(sha256sum flake.lock 2>/dev/null | awk '{print $1}')"
        fi
      fi
      if [ -n "$lock_hash" ]; then
        lock_suffix="-$lock_hash"
      else
        lock_suffix=""
      fi

      # Prefer upstream buck2 binary on PATH (fallback to flake buck2)
      buck_cache="$cache_dir/buck2-path$lock_suffix"
      buck_cached=""
      if [ -f "$buck_cache" ]; then
        buck_cached="$(cat "$buck_cache" 2>/dev/null || true)"
      fi
      if [ -n "$buck_cached" ] && [ -x "$buck_cached/bin/buck2" ]; then
        export PATH="$buck_cached/bin:$PATH"
      else
        if command -v buck2 >/dev/null 2>&1; then
          buck_bin="$(command -v buck2)"
          buck_root="$(cd "$(dirname "$buck_bin")/.." && pwd)"
          if [ -x "$buck_root/bin/buck2" ]; then
            export PATH="$buck_root/bin:$PATH"
            printf "%s\n" "$buck_root" > "$buck_cache" 2>/dev/null || true
          fi
        fi
      fi

      # Prepare zsh/bash env for completions and aliases
      mkdir -p .nix-zsh
      cat > .nix-zsh/.zshenv <<'EOF'
if [[ -o interactive ]]; then
  PROMPT='%F{green}[nix-shell]%f %m:%~$ '
  autoload -Uz compinit
  compinit -i
  if command -v scaf >/dev/null 2>&1; then
    eval "$(scaf completions zsh)"
  fi
fi
EOF
      export ZDOTDIR="$PWD/.nix-zsh"
      cat > .nix-zsh/.zshrc <<'EOF'
PROMPT='%F{green}[nix-shell]%f %m:%~$ '
autoload -Uz compinit
compinit -i
alias b=build
alias v=verify
alias i='bash build-tools/tools/bin/install-deps'
alias t=verify
if command -v scaf >/dev/null 2>&1; then
  eval "$(scaf completions zsh)"
fi
EOF

      if [ -n "$BASH_VERSION" ] && [ "$is_interactive" = "1" ]; then
        export PS1="\n\033[32m[nix-shell]\033[0m \h:\w$ "
        if [ -d "node_modules/zx" ]; then
          eval "$(scaf completions bash)"
        fi
        alias b=build
        alias v=verify
        alias i='bash build-tools/tools/bin/install-deps'
        alias t=verify
      fi

      if [ -n "$ZSH_VERSION" ] && [ "$is_interactive" = "1" ]; then
        autoload -Uz compinit
        compinit -i
        if command -v scaf >/dev/null 2>&1; then
          eval "$(scaf completions zsh)"
        fi
        alias b=build
        alias v=verify
        alias i='bash build-tools/tools/bin/install-deps'
        alias t=verify
      fi

      # Symlink prelude from flake output for local dev if missing; do not edit .buckconfig here
      if [ ! -e prelude ]; then
        pre_cache="$cache_dir/prelude-path$lock_suffix"
        pre_cached=""
        if [ -f "$pre_cache" ]; then
          pre_cached="$(cat "$pre_cache" 2>/dev/null || true)"
        fi
        if [ -n "$pre_cached" ] && [ -d "$pre_cached/prelude" ]; then
          ln -s "$pre_cached/prelude" prelude 2>/dev/null || true
        else
          pre_out=$(nix build .#buck2-prelude --no-link --accept-flake-config --print-out-paths 2>/dev/null || true)
          if [ -z "$pre_out" ]; then
            pre_out="${pkgs.nix}/bin/nix eval --raw .#inputs.buck2.outPath 2>/dev/null || true"
          fi
          if [ -n "$pre_out" ] && [ -d "$pre_out/prelude" ]; then
            ln -s "$pre_out/prelude" prelude 2>/dev/null || true
            printf "%s\n" "$pre_out" > "$pre_cache" 2>/dev/null || true
          fi
        fi
      fi
    '';
    buildInputs = [
      pkgs.git pkgs.buck2 pkgs.go pkgs.pnpm pkgs.nodejs_22 zx-wrapper pkgs.jq pkgs.rsync pkgs.copier pkgs.yq
      pkgs.secretspec pkgs.jc pkgs.coreutils pkgs.gomod2nix
    ] ++ (if pkgs.stdenv.isLinux then [ pkgs.fuse-overlayfs pkgs.xdg-utils ] else []);
  };
}


