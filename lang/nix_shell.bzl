def nix_bootstrap_env_core():
    return (
        "set -euo pipefail; "
        + "export WORKSPACE_ROOT=\"${WORKSPACE_ROOT:-}\"; "
        + "if [ -z \"${WORKSPACE_ROOT:-}\" ] && [ -n \"${BUCK_TEST_SRC:-}\" ]; then export WORKSPACE_ROOT=\"$BUCK_TEST_SRC\"; fi; "
        + "if [ -z \"${WORKSPACE_ROOT:-}\" ]; then "
        + "  if [ -f \"$(pwd)/tools/buck/graph.json\" ]; then "
        + "    export WORKSPACE_ROOT=\"$(pwd)\"; "
        + "  else "
        + "    CAND=\"$(pwd)\"; "
        + "    while [ \"$CAND\" != \"/\" ]; do "
        + "      if [ -f \"$CAND/tools/buck/graph.json\" ]; then export WORKSPACE_ROOT=\"$CAND\"; break; fi; "
        + "      CAND=\"$(dirname \"$CAND\")\"; "
        + "    done; "
        + "  fi; "
        + "fi; "
        + "export WORKSPACE_ROOT=\"${WORKSPACE_ROOT:-$(pwd)}\"; "
        + "FLK_ROOT=\"${FLK_ROOT:-}\"; "
        + "if [ -z \"${FLK_ROOT:-}\" ] || [ ! -f \"$FLK_ROOT/flake.nix\" ]; then "
        + "  FLK_ROOT=\"${WORKSPACE_ROOT:-${REPO_ROOT:-$(pwd)}}\"; "
        + "  if [ ! -f \"$FLK_ROOT/flake.nix\" ]; then "
        + "    SEARCH_FROM=\"${WORKSPACE_ROOT:-${REPO_ROOT:-$(pwd)}}\"; "
        + "    CAND=\"$SEARCH_FROM\"; "
        + "    while [ \"$CAND\" != \"/\" ] && [ ! -f \"$CAND/flake.nix\" ]; do CAND=\"$(dirname \"$CAND\")\"; done; "
        + "    FLK_ROOT=\"$CAND\"; "
        + "  fi; "
        + "  if [ ! -f \"$FLK_ROOT/flake.nix\" ]; then "
        + "    ROOT_GIT=\"$(git -C \"${REPO_ROOT:-$WORKSPACE_ROOT}\" rev-parse --show-toplevel 2>/dev/null || echo \"${REPO_ROOT:-$WORKSPACE_ROOT}\")\"; "
        + "    FLK_ROOT=\"$ROOT_GIT\"; "
        + "  fi; "
        + "fi; "
        + "cd \"$WORKSPACE_ROOT\"; "
        + "test -f \"$FLK_ROOT/flake.nix\"; "
    )


def nix_bootstrap_env_pnpm_store():
    return (
        "if [ \"${BNX_SKIP_REQUIRE_UNIFIED_PNPM_STORE:-}\" != \"1\" ]; then "
        + "  if [ ! -f \"$FLK_ROOT/buck-out/.unified-pnpm-store/path\" ]; then "
        + "    if command -v node >/dev/null 2>&1; then "
        + "      (cd \"$FLK_ROOT\" && node \"$FLK_ROOT/tools/dev/require-unified-pnpm-store.ts\" >/dev/null 2>&1 || true); "
        + "    elif command -v nix >/dev/null 2>&1; then "
        + "      (cd \"$FLK_ROOT\" && nix run --accept-flake-config \"path:$FLK_ROOT#zx-wrapper\" -- tools/dev/require-unified-pnpm-store.ts >/dev/null 2>&1 || true); "
        + "    fi; "
        + "  fi; "
        + "fi; "
        + "if [ -f \"$FLK_ROOT/buck-out/.unified-pnpm-store/path\" ]; then "
        + "  export NIX_USE_PREFETCHED_PNPM_STORE=1; "
        + "  export LOCAL_PNPM_STORE=\"$(cat \"$FLK_ROOT/buck-out/.unified-pnpm-store/path\" 2>/dev/null || true)\"; "
        + "fi; "
    )


def nix_bootstrap_env():
    return nix_bootstrap_env_core()


def nix_timeout_wrapper_var(var_name = "TIMEOUT", default_sec = 600):
    tout = default_sec if isinstance(default_sec, int) and default_sec > 0 else 600
    return (
        ("TOUT=%d; " % tout)
        + "if command -v timeout >/dev/null 2>&1; then "
        + ("%s=\"timeout -k 2s ${TOUT}s\"; " % var_name)
        + "elif command -v gtimeout >/dev/null 2>&1; then "
        + ("%s=\"gtimeout -k 2s ${TOUT}s\"; " % var_name)
        + "else "
        + ("%s=\"\"; " % var_name)
        + "fi; "
    )

def escape_buck_cmd_subst(s):
    if not isinstance(s, str):
        return s
    return s.replace("$(", "$$(")


def nix_build_out_path_cmd(flake_attr, timeout_var = "TIMEOUT"):
    tout = ""
    if isinstance(timeout_var, str) and timeout_var != "":
        tout = "$%s " % timeout_var
    return (
        "outPath=$$("
        + tout
        + ("nix build %s --accept-flake-config --no-link --print-out-paths | tail -n1" % flake_attr)
        + "); "
    )



