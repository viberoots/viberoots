{ pkgs
, buck2Input
, viberootsRoot ? ../../../..
, version ? "0.0.0-dev"
, releaseTag ? "v${version}"
}:
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
      export SSL_CERT_FILE="${pkgs.cacert}/etc/ssl/certs/ca-bundle.crt"
      export NIX_SSL_CERT_FILE="${pkgs.cacert}/etc/ssl/certs/ca-bundle.crt"
      export NODE_EXTRA_CA_CERTS="${pkgs.cacert}/etc/ssl/certs/ca-bundle.crt"
      export BUCK2_REAL_HOME="''${BUCK2_REAL_HOME:-$dev_root/.viberoots/workspace/buck/home}"
      mkdir -p "$BUCK2_REAL_HOME" 2>/dev/null || true

      _vbr_filter_host_path() {
        local old_ifs="$IFS"
        local entry
        local out=""
        IFS=':'
        for entry in $1; do
          case "$entry" in
            ""|/opt/homebrew/bin|/opt/homebrew/sbin|/usr/local/Homebrew/*|/usr/local/Cellar/*|"$PWD/viberoots/build-tools/tools/bin"|"$PWD/viberoots/node_modules/.bin") ;;
            *) out="''${out:+$out:}$entry" ;;
          esac
        done
        IFS="$old_ifs"
        printf '%s\n' "$out"
      }

      _vbr_apply_dev_path() {
        local vbr_nix_bin="${viberootsCommand}/bin"
        local vbr_tools_bin=""
        local vbr_node_bin=""
        local vbr_host_nix_bin=""
        if [ -n "''${VBR_NIX_BIN:-}" ] && [ -x "$VBR_NIX_BIN" ]; then
          :
        elif [ -x /nix/var/nix/profiles/default/bin/nix ]; then
          vbr_host_nix_bin="/nix/var/nix/profiles/default/bin"
          export VBR_NIX_BIN="/nix/var/nix/profiles/default/bin/nix"
        elif [ -x "$vbr_nix_bin/nix" ]; then
          export VBR_NIX_BIN="$vbr_nix_bin/nix"
        fi
        if [ -f "$PWD/build-tools/tools/dev/viberoots.ts" ]; then
          vbr_tools_bin="$PWD/build-tools/tools/bin"
          vbr_node_bin="$PWD/node_modules/.bin"
        elif [ -d "$PWD/.viberoots/current/build-tools/tools/bin" ]; then
          vbr_tools_bin="$PWD/.viberoots/current/build-tools/tools/bin"
          vbr_node_bin="$PWD/.viberoots/current/node_modules/.bin"
        fi
        local repo_prefix="$vbr_tools_bin:$PWD/.direnv/bin:$vbr_node_bin"
        local host_tail
        host_tail="$(_vbr_filter_host_path "$PATH")"
        export PATH="$repo_prefix:''${vbr_host_nix_bin:+$vbr_host_nix_bin:}$vbr_nix_bin''${host_tail:+:$host_tail}"
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

      _vbr_prepare_tool_helpers() {
        local vbr_tools_bin=""
        if [ -f "$PWD/build-tools/tools/dev/viberoots.ts" ]; then
          vbr_tools_bin="$PWD/build-tools/tools/bin"
        elif [ -d "$PWD/.viberoots/current/build-tools/tools/bin" ]; then
          vbr_tools_bin="$PWD/.viberoots/current/build-tools/tools/bin"
        fi
        [ -d "$vbr_tools_bin" ] || return 0
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
      }

      _vbr_declared_local_input_root() {
        local flake="$PWD/.viberoots/workspace/flake.nix"
        [ -f "$flake" ] || return 1
        local url
        url="$(sed -n 's/^[[:space:]]*viberoots\.url[[:space:]]*=[[:space:]]*"\([^"]*\)".*/\1/p' "$flake" | head -n 1)"
        case "$url" in
          path:*) ;;
          *) return 1 ;;
        esac
        local declared="''${url#path:}"
        local resolved=""
        case "$declared" in
          /*) resolved="$declared" ;;
          *) resolved="$(cd "$(dirname "$flake")" && cd "$declared" && pwd -P 2>/dev/null || true)" ;;
        esac
        [ -n "$resolved" ] || return 1
        [ -f "$resolved/flake.nix" ] || return 1
        printf '%s\n' "$resolved"
      }
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
      if [ -f "$PWD/build-tools/tools/dev/viberoots.ts" ] || [ -f "$PWD/.viberoots/workspace/flake.nix" ] || [ -f "$PWD/flake.nix" ]; then
        if [ -f "$PWD/build-tools/tools/dev/viberoots.ts" ]; then
          export VIBEROOTS_ROOT="$PWD"
          export VIBEROOTS_SOURCE_ROOT="$PWD"
          viberoots init-workspace --shell-entry --source "$PWD" >/dev/null || {
            echo "(devShell) viberoots workspace activation failed" >&2
            return 1 2>/dev/null || exit 1
          }
        else
          vbr_flake_input_root="''${VIBEROOTS_FLAKE_INPUT_ROOT:-}"
          vbr_filtered_input="$PWD/.viberoots/workspace/viberoots-flake-input"
          if [ -n "$vbr_flake_input_root" ] && [ -f "$vbr_flake_input_root/flake.nix" ]; then
            vbr_source_root="''${VIBEROOTS_SOURCE_ROOT:-$vbr_flake_input_root}"
            if [ -d "$PWD/viberoots" ] && [ -d "$vbr_filtered_input" ] && [ "$(cd "$vbr_source_root" 2>/dev/null && pwd -P || true)" = "$(cd "$vbr_filtered_input" 2>/dev/null && pwd -P || true)" ]; then
              vbr_source_root="$PWD/viberoots"
            fi
            if [ ! -f "$vbr_source_root/flake.nix" ]; then
              vbr_source_root="$vbr_flake_input_root"
            fi
            export VIBEROOTS_ROOT="$vbr_source_root"
            export VIBEROOTS_SOURCE_ROOT="$vbr_source_root"
            viberoots init-workspace --shell-entry --source "$vbr_source_root" >/dev/null || {
              echo "(devShell) viberoots workspace activation failed" >&2
              return 1 2>/dev/null || exit 1
            }
          elif vbr_flake_input_root="$(_vbr_declared_local_input_root)"; then
            export VIBEROOTS_FLAKE_INPUT_ROOT="$vbr_flake_input_root"
            export VIBEROOTS_ROOT="$vbr_flake_input_root"
            export VIBEROOTS_SOURCE_ROOT="$vbr_flake_input_root"
            viberoots init-workspace --shell-entry --source "$vbr_flake_input_root" >/dev/null || {
              echo "(devShell) viberoots workspace activation failed" >&2
              return 1 2>/dev/null || exit 1
            }
          else
            unset VIBEROOTS_ROOT
            unset VIBEROOTS_SOURCE_ROOT
            viberoots init-workspace --shell-entry >/dev/null || {
              echo "(devShell) viberoots workspace activation failed" >&2
              return 1 2>/dev/null || exit 1
            }
          fi
          if [ -d "$PWD/.viberoots/current" ]; then
            vbr_source="$(cd "$PWD/.viberoots/current" && pwd -P)"
            if [ -d "$PWD/viberoots" ] && [ -d "$vbr_filtered_input" ] && [ "$vbr_source" = "$(cd "$vbr_filtered_input" 2>/dev/null && pwd -P || true)" ]; then
              ln -sfn ../viberoots "$PWD/.viberoots/current"
              vbr_source="$(cd "$PWD/.viberoots/current" && pwd -P)"
            fi
            export VIBEROOTS_ROOT="$vbr_source"
            export VIBEROOTS_SOURCE_ROOT="$vbr_source"
          fi
          unset vbr_filtered_input
        fi
      fi
      _vbr_prepare_tool_helpers
      _vbr_apply_dev_path

      # Prepare zsh/bash env for completions and aliases
      mkdir -p .nix-zsh
      cat > .nix-zsh/.zshenv <<'EOF'
# Runs first in every zsh (interactive or not). Collapsing PATH/path here lets
# each freshly-spawned shell (e.g. a cmux pane) self-heal any duplicate-laden
# PATH it inherited, so the environment can never overflow ARG_MAX and break
# exec with "Argument list too long".
typeset -gU path PATH
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
  _u() {
    _arguments -S '--upgrade[intentionally upgrade pnpm dependency versions]' '--verbose[show reconciliation steps]' '(-h --help)'{-h,--help}'[show help]'
  }
  compdef _u u
fi
EOF
      export ZDOTDIR="$PWD/.nix-zsh"
      cat > .nix-zsh/.zshrc <<'EOF'
PROMPT='%F{green}[nix-shell]%f %m:%~$ '
# Keep PATH/path de-duplicated so the chpwd hook below cannot grow the
# environment without bound (HOST_PATH was re-appended on every cd, eventually
# overflowing ARG_MAX and breaking exec with "Argument list too long").
typeset -gU path PATH
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
    local vbr_tools_bin=""
    local vbr_node_bin=""
    if [[ -f "$d/build-tools/tools/dev/viberoots.ts" ]]; then
      vbr_tools_bin="$d/build-tools/tools/bin"
      vbr_node_bin="$d/node_modules/.bin"
    elif [[ -d "$d/.viberoots/current/build-tools/tools/bin" ]]; then
      vbr_tools_bin="$d/.viberoots/current/build-tools/tools/bin"
      vbr_node_bin="$d/.viberoots/current/node_modules/.bin"
    fi
    if [[ ( -n "''${WORKSPACE_ROOT:-}" || -f "$d/flake.nix" ) && -d "$vbr_tools_bin" ]]; then
      local old_ifs="$IFS"
      local entry
      local out=""
      IFS=':'
      for entry in $PATH; do
        case "$entry" in
          ""|/opt/homebrew/bin|/opt/homebrew/sbin|/usr/local/Homebrew/*|/usr/local/Cellar/*|"$vbr_host_nix_bin"|"$vbr_nix_bin"|"$vbr_tools_bin"|"$d/.direnv/bin"|"$d/node_modules/.bin"|"$d/viberoots/build-tools/tools/bin"|"$d/viberoots/node_modules/.bin"|"$vbr_node_bin") ;;
          *) out="''${out:+$out:}$entry" ;;
        esac
      done
      IFS="$old_ifs"
      export PATH="$vbr_tools_bin:$d/.direnv/bin:$vbr_node_bin:''${vbr_host_nix_bin:+$vbr_host_nix_bin:}$vbr_nix_bin''${out:+:$out}"
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
_u() {
  _arguments -S '--upgrade[intentionally upgrade pnpm dependency versions]' '--verbose[show reconciliation steps]' '(-h --help)'{-h,--help}'[show help]'
}
compdef _u u
EOF

      if [ -n "$BASH_VERSION" ] && [ "$is_interactive" = "1" ]; then
        export PS1="\n\033[32m[nix-shell]\033[0m \h:\w$ "
        if [ -d "node_modules/zx" ]; then
          eval "$(scaf completions bash)"
        fi
        if command -v vbr >/dev/null 2>&1; then
          eval "$(vbr completion bash)"
        fi
        _vbr_u() {
          local cur="''${COMP_WORDS[COMP_CWORD]}"
          COMPREPLY=( $(compgen -W "--upgrade --verbose --help" -- "$cur") )
        }
        complete -F _vbr_u u
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
        _u() {
          _arguments -S '--upgrade[intentionally upgrade pnpm dependency versions]' '--verbose[show reconciliation steps]' '(-h --help)'{-h,--help}'[show help]'
        }
        compdef _u u
      fi
      cd "$entry_cwd"

      # Strict consumer workspaces route the Buck prelude through
      # .viberoots/current/prelude; do not recreate a visible root prelude shim.
    '';
    buildInputs = [
      pkgs.git pkgs.nix pkgs.buck2 pkgs.go pkgs.pnpm pkgs.nodejs_22 pkgs.python3 pkgs.uv zx-wrapper viberootsCommand pkgs.jq pkgs.rsync pkgs.copier pkgs.yq pkgs.prettier
      pkgs.jc pkgs.bash pkgs.coreutils pkgs.gomod2nix pkgs.opentofu pkgs.infisical pkgs.awscli2 pkgs.dnsutils
      pkgs.openssl pkgs.postgresql_16
    ] ++ (if pkgs.stdenv.isDarwin then [ agent-safehouse ] else [])
      ++ (if pkgs.stdenv.isLinux then [ pkgs.fuse-overlayfs pkgs.xdg-utils ] else []);
  };
}
