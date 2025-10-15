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
      
      # link Nix-built node_modules for IDEs/CLIs (read-only)
      # Link only in interactive shells (TTY) and when not explicitly disabled.
      if [ -z "''${NO_NODE_MODULES_LINK:-}" ] && [ -t 1 ]; then
        if [ -e node_modules ] && [ ! -L node_modules ]; then
          echo "(devShell) existing non-symlink node_modules detected; not overwriting" >&2 || true
        else
          out_path=$(node --experimental-strip-types --import "$PWD/tools/dev/zx-init.mjs" "$PWD/tools/dev/node-modules-build.ts" --print-out-paths 2>/dev/null || true)
          if [ -n "$out_path" ]; then
            ln -sfn "$out_path/node_modules" node_modules || true
            if [ -d "$out_path/node_modules/.bin" ]; then
              export PATH="$out_path/node_modules/.bin:$PATH"
            fi
          fi
        fi
      fi

      export PATH="$PWD/tools/bin:$PATH"
      # Prefer upstream buck2 binary on PATH (fallback to flake buck2)
      buck_out=$(nix build github:facebook/buck2#buck2 --no-link --print-out-paths 2>/dev/null || true)
      if [ -n "$buck_out" ] && [ -x "$buck_out/bin/buck2" ]; then
        export PATH="$buck_out/bin:$PATH"
      else
        buck_out_local=$(nix build .#buck2 --no-link --accept-flake-config --print-out-paths 2>/dev/null || true)
        if [ -n "$buck_out_local" ] && [ -x "$buck_out_local/bin/buck2" ]; then
          export PATH="$buck_out_local/bin:$PATH"
        fi
      fi

      # Prepare zsh/bash env for completions and aliases
      mkdir -p .nix-zsh
      cat > .nix-zsh/.zshenv <<'EOF'
if [[ -o interactive ]]; then
  PROMPT='%F{green}[nix-shell]%f %m:%~$ '
  autoload -Uz compinit
  compinit -i
  if [ -d "node_modules/zx" ]; then
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
alias t=verify
if [ -d "node_modules/zx" ]; then
  eval "$(scaf completions zsh)"
fi
EOF

      if [ -n "$BASH_VERSION" ]; then
        export PS1="\n\033[32m[nix-shell]\033[0m \h:\w$ "
        if [ -d "node_modules/zx" ]; then
          eval "$(scaf completions bash)"
        fi
        alias b=build
        alias v=verify
        alias t=verify
      fi

      if [ -n "$ZSH_VERSION" ]; then
        alias b=build
        alias v=verify
        alias t=verify
      fi

      # Symlink prelude from flake output for local dev if missing; do not edit .buckconfig here
      if [ ! -e prelude ]; then
        pre_out=$(nix build .#buck2-prelude --no-link --accept-flake-config --print-out-paths 2>/dev/null || true)
        if [ -z "$pre_out" ]; then
          pre_out="$(${pkgs.nix}/bin/nix eval --raw .#inputs.buck2.outPath 2>/dev/null || true)"
        fi
        if [ -n "$pre_out" ] && [ -d "$pre_out/prelude" ]; then
          ln -s "$pre_out/prelude" prelude 2>/dev/null || true
        fi
      fi
    '';
    buildInputs = [
      pkgs.git pkgs.buck2 pkgs.go pkgs.pnpm pkgs.nodejs_22 zx-wrapper pkgs.jq pkgs.rsync pkgs.copier pkgs.yq
      pkgs.secretspec pkgs.jc pkgs.coreutils
    ] ++ (if pkgs.stdenv.isLinux then [ pkgs.fuse-overlayfs pkgs.xdg-utils ] else []);
  };
}


