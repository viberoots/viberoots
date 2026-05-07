{ pkgs, buck2Input }:
let
  zx-wrapper = import ./lib/zx-wrapper.nix { inherit pkgs; };
  agent-safehouse = pkgs.stdenvNoCC.mkDerivation {
    pname = "agent-safehouse";
    version = "0.9.0";
    src = pkgs.fetchurl {
      url = "https://github.com/eugene1g/agent-safehouse/releases/download/v0.9.0/safehouse.sh";
      sha256 = "15w65bms7y6qwxqrgnj8xikyfyf61h2wy4yb8aa0iy9yw4ggghk1";
    };
    dontUnpack = true;
    dontPatchShebangs = true;
    installPhase = ''
      mkdir -p "$out/bin"
      sed '1s|.*|#!/bin/bash|' "$src" > "$out/bin/safehouse"
      chmod 755 "$out/bin/safehouse"
    '';
  };
in {
  default = pkgs.mkShell {
    shellHook = ''
      dev_root="$PWD"
      if [ ! -f "$dev_root/flake.nix" ]; then
        search_root="$dev_root"
        while [ "$search_root" != "/" ] && [ ! -f "$search_root/flake.nix" ]; do
          search_root="$(dirname "$search_root")"
        done
        if [ -f "$search_root/flake.nix" ]; then
          dev_root="$search_root"
        fi
      fi
      # Guard against recursive shell hook invocation only when this root is already wired.
      if [ -n "''${_BUCKNIX_DEVSHELL_ACTIVE:-}" ] && [ "''${_BUCKNIX_DEVSHELL_ROOT:-}" = "$dev_root" ]; then
        if command -v i >/dev/null 2>&1; then
          return 0
        fi
      fi
      export _BUCKNIX_DEVSHELL_ACTIVE=1
      export _BUCKNIX_DEVSHELL_ROOT="$dev_root"
      is_interactive=0
      case "$-" in
        *i*) is_interactive=1 ;;
      esac

      cd "$dev_root"

      link_script="$PWD/build-tools/tools/dev/devshell-link-node-modules.ts"
      if [ -f "$link_script" ]; then
        if [ -e node_modules ] && [ ! -L node_modules ]; then
          echo "(devShell) existing non-symlink node_modules detected; not overwriting" >&2 || true
        else
          zx-wrapper "$link_script" || true
        fi
      fi

      if [ -d "$PWD/build-tools/tools/bin" ]; then
        mkdir -p "$PWD/.direnv/bin" 2>/dev/null || true
        if [ "$(uname -s 2>/dev/null || true)" = "Darwin" ]; then
          if [ ! -x "$PWD/.direnv/bin/apfs-clone-checker" ] && command -v clang >/dev/null 2>&1; then
            cat > "$PWD/.direnv/bin/apfs-clone-checker.c" <<'EOF'
#include <sys/attr.h>
#include <stdio.h>
#include <stdint.h>
#include <string.h>
#include <unistd.h>

typedef struct __attribute__((packed)) {
  uint32_t length;
  attribute_set_t returned;
  uint64_t cloneid;
} clone_attrs_t;

static int clone_id(const char *path, uint64_t *out) {
  struct attrlist attrs;
  memset(&attrs, 0, sizeof(attrs));
  attrs.bitmapcount = ATTR_BIT_MAP_COUNT;
  attrs.commonattr = ATTR_CMN_RETURNED_ATTRS;
  attrs.forkattr = ATTR_CMNEXT_CLONEID;

  clone_attrs_t buf;
  memset(&buf, 0, sizeof(buf));
  if (getattrlist(path, &attrs, &buf, sizeof(buf), FSOPT_ATTR_CMN_EXTENDED) != 0) {
    perror(path);
    return 2;
  }
  if ((buf.returned.forkattr & ATTR_CMNEXT_CLONEID) == 0) {
    fprintf(stderr, "%s: ATTR_CMNEXT_CLONEID unavailable\n", path);
    return 3;
  }
  *out = buf.cloneid;
  return 0;
}

int main(int argc, char **argv) {
  if (argc != 3) {
    fprintf(stderr, "usage: %s SOURCE CLONE\n", argv[0]);
    return 2;
  }
  uint64_t a = 0, b = 0;
  int rc = clone_id(argv[1], &a);
  if (rc != 0) return rc;
  rc = clone_id(argv[2], &b);
  if (rc != 0) return rc;
  puts((a != 0 && a == b) ? "1" : "0");
  return 0;
}
EOF
            clang -Wall -Wextra -O2 -o "$PWD/.direnv/bin/apfs-clone-checker" "$PWD/.direnv/bin/apfs-clone-checker.c" >/dev/null 2>&1 || rm -f "$PWD/.direnv/bin/apfs-clone-checker"
          fi
        fi
        export PATH="$PWD/build-tools/tools/bin:$PWD/.direnv/bin:$PWD/node_modules/.bin:$PATH"
      fi
      # Ensure wrapper scripts on PATH are used even if stale aliases linger
      # from an older shellHook revision.
      unalias i b v t >/dev/null 2>&1 || true
      
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
_bnx_update_path() {
  local d="$PWD"
  while [[ "$d" != "/" ]]; do
    if [[ -f "$d/flake.nix" && -d "$d/build-tools/tools/bin" ]]; then
      case ":$PATH:" in
        *":$d/build-tools/tools/bin:"*) ;;
        *) export PATH="$d/build-tools/tools/bin:$d/node_modules/.bin:$PATH" ;;
      esac
      return
    fi
    d="$(dirname "$d")"
  done
}
_bnx_update_path
autoload -Uz add-zsh-hook
add-zsh-hook chpwd _bnx_update_path
autoload -Uz compinit
compinit -i
if command -v scaf >/dev/null 2>&1; then
  eval "$(scaf completions zsh)"
fi
EOF

      if [ -n "$BASH_VERSION" ] && [ "$is_interactive" = "1" ]; then
        export PS1="\n\033[32m[nix-shell]\033[0m \h:\w$ "
        if [ -d "node_modules/zx" ]; then
          eval "$(scaf completions bash)"
        fi
      fi

      if [ -n "$ZSH_VERSION" ] && [ "$is_interactive" = "1" ]; then
        autoload -Uz compinit
        compinit -i
        if command -v scaf >/dev/null 2>&1; then
          eval "$(scaf completions zsh)"
        fi
      fi

      # Symlink prelude from flake output for local dev. Validate the actual
      # Buck entrypoint so stale/broken symlinks are repaired, not just present.
      if [ ! -f prelude/prelude.bzl ]; then
        pre_cache="$cache_dir/prelude-path$lock_suffix"
        pre_cached=""
        pre_target=""
        if [ -f "$pre_cache" ]; then
          pre_cached="$(cat "$pre_cache" 2>/dev/null || true)"
        fi
        if [ -n "$pre_cached" ] && [ -f "$pre_cached/prelude/prelude.bzl" ]; then
          pre_target="$pre_cached/prelude"
        else
          pre_out=$(nix build .#buck2-prelude --no-link --accept-flake-config --print-out-paths 2>/dev/null || true)
          if [ -z "$pre_out" ]; then
            pre_out="$(${pkgs.nix}/bin/nix eval --raw .#inputs.buck2.outPath 2>/dev/null || true)"
          fi
          if [ -n "$pre_out" ] && [ -f "$pre_out/prelude/prelude.bzl" ]; then
            pre_target="$pre_out/prelude"
            printf "%s\n" "$pre_out" > "$pre_cache" 2>/dev/null || true
          fi
        fi
        if [ -n "$pre_target" ]; then
          if [ -L prelude ] || [ ! -e prelude ]; then
            rm -f prelude
            ln -s "$pre_target" prelude
          else
            echo "(devShell) prelude exists but is not a valid symlink; expected prelude/prelude.bzl" >&2
          fi
        fi
      fi
      if [ -f .buckconfig ] && [ ! -f prelude/prelude.bzl ]; then
        echo "(devShell) failed to materialize Buck prelude at prelude/prelude.bzl" >&2
      fi
    '';
    buildInputs = [
      pkgs.git pkgs.buck2 pkgs.go pkgs.pnpm pkgs.nodejs_22 zx-wrapper pkgs.jq pkgs.rsync pkgs.copier pkgs.yq
      pkgs.secretspec pkgs.jc pkgs.coreutils pkgs.gomod2nix pkgs.opentofu
    ] ++ (if pkgs.stdenv.isDarwin then [ agent-safehouse ] else [])
      ++ (if pkgs.stdenv.isLinux then [ pkgs.fuse-overlayfs pkgs.xdg-utils ] else []);
  };
}
