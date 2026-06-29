{ pkgs, buck2Input, viberootsRoot ? ../../../.., version ? "0.0.0-dev", releaseTag ? "v${version}" }:
let
  zx-wrapper = import ./lib/zx-wrapper.nix { inherit pkgs; };
  viberootsCommand = import ./packages/viberoots-command.nix {
    inherit pkgs zx-wrapper version releaseTag;
    viberootsSrc = viberootsRoot;
  };
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
      entry_cwd="$PWD"
      dev_root="''${WORKSPACE_ROOT:-$PWD}"
      if [ -n "''${WORKSPACE_ROOT:-}" ]; then
        dev_root="$(cd "$WORKSPACE_ROOT" && pwd)"
      fi
      if [ ! -f "$dev_root/flake.nix" ]; then
        search_root="$dev_root"
        while [ "$search_root" != "/" ] && [ ! -f "$search_root/flake.nix" ]; do
          search_root="$(dirname "$search_root")"
        done
        if [ -f "$search_root/flake.nix" ]; then
          dev_root="$search_root"
        fi
      fi
      export _VIBEROOTS_DEVSHELL_ACTIVE=1
      export _VIBEROOTS_DEVSHELL_ROOT="$dev_root"
      is_interactive=0
      case "$-" in
        *i*) is_interactive=1 ;;
      esac

      cd "$dev_root"

      _vbr_filter_host_path() {
        local old_ifs="$IFS"
        local entry
        local out=""
        IFS=':'
        for entry in $1; do
          case "$entry" in
            ""|/opt/homebrew/bin|/opt/homebrew/sbin|/usr/local/Homebrew/*|/usr/local/Cellar/*) ;;
            *) out="''${out:+$out:}$entry" ;;
          esac
        done
        IFS="$old_ifs"
        printf '%s\n' "$out"
      }

      _vbr_apply_dev_path() {
        local vbr_nix_bin="${viberootsCommand}/bin"
        local vbr_tools_bin="$PWD/build-tools/tools/bin"
        local vbr_node_bin="$PWD/node_modules/.bin"
        local vbr_host_nix_bin=""
        if [ -n "''${VBR_NIX_BIN:-}" ] && [ -x "$VBR_NIX_BIN" ]; then
          :
        elif [ -x /nix/var/nix/profiles/default/bin/nix ]; then
          vbr_host_nix_bin="/nix/var/nix/profiles/default/bin"
          export VBR_NIX_BIN="/nix/var/nix/profiles/default/bin/nix"
        elif [ -x "$vbr_nix_bin/nix" ]; then
          export VBR_NIX_BIN="$vbr_nix_bin/nix"
        fi
        if [ ! -d "$vbr_tools_bin" ] && [ -d "$PWD/viberoots/build-tools/tools/bin" ]; then
          vbr_tools_bin="$PWD/viberoots/build-tools/tools/bin"
          vbr_node_bin="$PWD/viberoots/node_modules/.bin"
        fi
        local repo_prefix="$vbr_tools_bin:$PWD/.direnv/bin:$vbr_node_bin"
        local nix_prefix="''${HOST_PATH:-}"
        local host_tail
        host_tail="$(_vbr_filter_host_path "$PATH")"
        export PATH="$repo_prefix:''${vbr_host_nix_bin:+$vbr_host_nix_bin:}$vbr_nix_bin''${nix_prefix:+:$nix_prefix}''${host_tail:+:$host_tail}"
      }

      _vbr_mark_macos_metadata_never_index() {
        local dir="$1"
        [ -n "$dir" ] || return 0
        mkdir -p "$dir" 2>/dev/null || true
        if [ "$(uname -s 2>/dev/null || true)" = "Darwin" ]; then
          : > "$dir/.metadata_never_index" 2>/dev/null || true
        fi
      }

      link_script="$PWD/build-tools/tools/dev/devshell-link-node-modules.ts"
      if [ -f "$link_script" ]; then
        if [ -e node_modules ] && [ ! -L node_modules ]; then
          echo "(devShell) existing non-symlink node_modules detected; not overwriting" >&2 || true
        else
          zx-wrapper "$link_script" || true
        fi
      fi

      vbr_tools_bin="$PWD/build-tools/tools/bin"
      if [ ! -d "$vbr_tools_bin" ] && [ -d "$PWD/viberoots/build-tools/tools/bin" ]; then
        vbr_tools_bin="$PWD/viberoots/build-tools/tools/bin"
      fi

      if [ -d "$vbr_tools_bin" ]; then
        export CMUX_CUSTOM_CLAUDE_PATH="$vbr_tools_bin/claude"
        export CMUX_CUSTOM_CODEX_PATH="$vbr_tools_bin/codex"
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
        _vbr_apply_dev_path
      fi
      # Ensure wrapper scripts on PATH are used even if stale aliases linger
      # from an older shellHook revision.
      unalias i b v t >/dev/null 2>&1 || true
      
      cache_dir="$PWD/.viberoots/workspace/buck/tmp/devshell-cache"
      _vbr_mark_macos_metadata_never_index "$PWD/.viberoots"
      _vbr_mark_macos_metadata_never_index "$PWD/.viberoots/workspace"
      _vbr_mark_macos_metadata_never_index "$PWD/.viberoots/workspace/buck"
      _vbr_mark_macos_metadata_never_index "$PWD/.viberoots/workspace/buck/tmp"
      _vbr_mark_macos_metadata_never_index "$cache_dir"
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
      _vbr_apply_dev_path

      if [ -f flake.nix ] || [ -f viberoots/flake.nix ]; then
        vbr_source="${viberootsRoot}"
        if [ -f "$PWD/build-tools/tools/dev/viberoots.ts" ]; then
          vbr_source="$PWD"
        elif [ -f "$PWD/viberoots/flake.nix" ]; then
          vbr_source="$PWD/viberoots"
          _vbr_mark_macos_metadata_never_index "$PWD/.viberoots"
          _vbr_mark_macos_metadata_never_index "$PWD/.viberoots/workspace"
          if [ "$(readlink "$PWD/.viberoots/current" 2>/dev/null || true)" != "../viberoots" ]; then
            rm -f "$PWD/.viberoots/current"
            ln -s ../viberoots "$PWD/.viberoots/current"
          fi
        fi
        export VIBEROOTS_ROOT="$vbr_source"
        export VIBEROOTS_SOURCE_ROOT="$vbr_source"
        viberoots init-workspace --shell-entry --source "$vbr_source" >/dev/null || {
          echo "(devShell) viberoots workspace activation failed" >&2
          return 1 2>/dev/null || exit 1
        }
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
  if command -v vbr >/dev/null 2>&1; then
    eval "$(vbr completion zsh)"
  fi
fi
EOF
      export ZDOTDIR="$PWD/.nix-zsh"
      cat > .nix-zsh/.zshrc <<'EOF'
PROMPT='%F{green}[nix-shell]%f %m:%~$ '
_vbr_update_path() {
  local vbr_nix_bin="${viberootsCommand}/bin"
  local vbr_host_nix_bin=""
  if [[ -n "''${VBR_NIX_BIN:-}" && -x "$VBR_NIX_BIN" ]]; then
    :
  elif [[ -x /nix/var/nix/profiles/default/bin/nix ]]; then
    vbr_host_nix_bin="/nix/var/nix/profiles/default/bin"
    export VBR_NIX_BIN="/nix/var/nix/profiles/default/bin/nix"
  elif [[ -x "$vbr_nix_bin/nix" ]]; then
    export VBR_NIX_BIN="$vbr_nix_bin/nix"
  fi
  local d="''${WORKSPACE_ROOT:-$PWD}"
  while [[ "$d" != "/" ]]; do
    local vbr_tools_bin="$d/build-tools/tools/bin"
    local vbr_node_bin="$d/node_modules/.bin"
    if [[ ! -d "$vbr_tools_bin" && -d "$d/viberoots/build-tools/tools/bin" ]]; then
      vbr_tools_bin="$d/viberoots/build-tools/tools/bin"
      vbr_node_bin="$d/viberoots/node_modules/.bin"
    fi
    if [[ ( -n "''${WORKSPACE_ROOT:-}" || -f "$d/flake.nix" ) && -d "$vbr_tools_bin" ]]; then
      local old_ifs="$IFS"
      local entry
      local out=""
      IFS=':'
      for entry in $PATH; do
        case "$entry" in
          ""|/opt/homebrew/bin|/opt/homebrew/sbin|/usr/local/Homebrew/*|/usr/local/Cellar/*|"$vbr_host_nix_bin"|"$vbr_nix_bin"|"$vbr_tools_bin"|"$d/.direnv/bin"|"$d/node_modules/.bin"|"$d/viberoots/node_modules/.bin"|"$vbr_node_bin") ;;
          *) out="''${out:+$out:}$entry" ;;
        esac
      done
      IFS="$old_ifs"
      export PATH="$vbr_tools_bin:$d/.direnv/bin:$vbr_node_bin:''${vbr_host_nix_bin:+$vbr_host_nix_bin:}$vbr_nix_bin''${HOST_PATH:+:$HOST_PATH}''${out:+:$out}"
      return
    fi
    d="$(dirname "$d")"
  done
}
_vbr_update_path
autoload -Uz add-zsh-hook
add-zsh-hook chpwd _vbr_update_path
autoload -Uz compinit
compinit -i
if command -v scaf >/dev/null 2>&1; then
  eval "$(scaf completions zsh)"
fi
if command -v vbr >/dev/null 2>&1; then
  eval "$(vbr completion zsh)"
fi
EOF

      if [ -n "$BASH_VERSION" ] && [ "$is_interactive" = "1" ]; then
        export PS1="\n\033[32m[nix-shell]\033[0m \h:\w$ "
        if [ -d "node_modules/zx" ]; then
          eval "$(scaf completions bash)"
        fi
        if command -v vbr >/dev/null 2>&1; then
          eval "$(vbr completion bash)"
        fi
      fi

      if [ -n "$ZSH_VERSION" ] && [ "$is_interactive" = "1" ]; then
        autoload -Uz compinit
        compinit -i
        if command -v scaf >/dev/null 2>&1; then
          eval "$(scaf completions zsh)"
        fi
        if command -v vbr >/dev/null 2>&1; then
          eval "$(vbr completion zsh)"
        fi
      fi
      cd "$entry_cwd"

      # Strict consumer workspaces route the Buck prelude through
      # .viberoots/current/prelude; do not recreate a visible root prelude shim.
    '';
    buildInputs = [
      pkgs.git pkgs.nix pkgs.buck2 pkgs.go pkgs.pnpm pkgs.nodejs_22 pkgs.python3 pkgs.uv zx-wrapper viberootsCommand pkgs.jq pkgs.rsync pkgs.copier pkgs.yq
      pkgs.jc pkgs.bash pkgs.coreutils pkgs.gomod2nix pkgs.opentofu pkgs.infisical pkgs.awscli2 pkgs.dnsutils
      pkgs.openssl pkgs.postgresql_16
    ] ++ (if pkgs.stdenv.isDarwin then [ agent-safehouse ] else [])
      ++ (if pkgs.stdenv.isLinux then [ pkgs.fuse-overlayfs pkgs.xdg-utils ] else []);
  };
}
