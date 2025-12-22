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


def nix_cmd_prefix(
        timeout_var = "TIMEOUT",
        timeout_sec = 600,
        include_pnpm_store = False,
        escape_cmd_subst = True):
    boot = nix_bootstrap_env_core()
    if include_pnpm_store:
        boot = boot + nix_bootstrap_env_pnpm_store()
    if escape_cmd_subst:
        boot = escape_buck_cmd_subst(boot)
    return boot + nix_timeout_wrapper_var(var_name = timeout_var, default_sec = timeout_sec)

def nix_calling_genrule_bootstrap(
        timeout_var = "TIMEOUT",
        timeout_sec = 600,
        include_pnpm_store = False,
        source_workspace_root_env = False,
        skip_require_unified_pnpm_store = False,
        debug_env_var = "BNX_NIX_CALL_DEBUG"):
    """
    Standard bootstrap for genrule-style macros that invoke Nix.

    Responsibilities:
    - optionally source tools/buck/workspace-root.env (when available as an input)
    - normalize REPO_ROOT from WORKSPACE_ROOT (for git-based flake root fallback)
    - optionally disable unified PNPM store enforcement (bundling and other special cases)
    - compose with nix_cmd_prefix(...) so call sites don't reassemble partial variants
    """
    pre = ""
    if source_workspace_root_env:
        pre = pre + ". tools/buck/workspace-root.env 2>/dev/null || true; "
    pre = pre + "if [ -n \"${WORKSPACE_ROOT:-}\" ]; then export REPO_ROOT=\"$WORKSPACE_ROOT\"; fi; "
    if skip_require_unified_pnpm_store:
        pre = pre + "export BNX_SKIP_REQUIRE_UNIFIED_PNPM_STORE=1; "
    if isinstance(debug_env_var, str) and debug_env_var != "":
        pre = pre + ("if [ \"${%s:-}\" = \"1\" ]; then set -x; fi; " % debug_env_var)

    return pre + nix_cmd_prefix(
        timeout_var = timeout_var,
        timeout_sec = timeout_sec,
        include_pnpm_store = include_pnpm_store,
        escape_cmd_subst = True,
    )

def nix_calling_genrule_nix_build_out_path_prefix(
        flake_attr,
        timeout_var = "TIMEOUT",
        timeout_sec = 600,
        include_pnpm_store = False,
        source_workspace_root_env = False,
        skip_require_unified_pnpm_store = False,
        debug_env_var = "BNX_NIX_CALL_DEBUG"):
    """
    Convenience helper for the common pattern:
      <bootstrap> + outPath=$$($TIMEOUT nix build ... --no-link --print-out-paths | tail -n1)
    """
    return nix_calling_genrule_bootstrap(
        timeout_var = timeout_var,
        timeout_sec = timeout_sec,
        include_pnpm_store = include_pnpm_store,
        source_workspace_root_env = source_workspace_root_env,
        skip_require_unified_pnpm_store = skip_require_unified_pnpm_store,
        debug_env_var = debug_env_var,
    ) + nix_build_out_path_cmd(flake_attr, timeout_var = timeout_var)


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



