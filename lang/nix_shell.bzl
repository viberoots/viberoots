def nix_bootstrap_env_core():
    return (
        "set -euo pipefail; "
        + "export TMP=\"${TMPDIR:-/tmp}\"; "
        + "WS_ENV=\"\"; "
        + "CAND_WS=\"$PWD\"; "
        + "while [ \"$CAND_WS\" != \"/\" ]; do "
        + "  if [ -f \"$CAND_WS/tools/buck/workspace-root.env\" ]; then WS_ENV=\"$CAND_WS/tools/buck/workspace-root.env\"; break; fi; "
        + "  CAND_WS=\"${CAND_WS%/*}\"; "
        + "  if [ -z \"$CAND_WS\" ]; then CAND_WS=\"/\"; fi; "
        + "done; "
        + "[ -n \"$WS_ENV\" ] && . \"$WS_ENV\" 2>/dev/null || true; "
        + "export WORKSPACE_ROOT=\"${WORKSPACE_ROOT:-}\"; "
        + "if [ -z \"${WORKSPACE_ROOT:-}\" ] && [ -n \"${BUCK_TEST_SRC:-}\" ]; then export WORKSPACE_ROOT=\"$BUCK_TEST_SRC\"; fi; "
        + "if [ -z \"${WORKSPACE_ROOT:-}\" ]; then "
        + "  if [ -f \"$PWD/tools/buck/graph.json\" ]; then "
        + "    export WORKSPACE_ROOT=\"$PWD\"; "
        + "  else "
        + "    CAND=\"$PWD\"; "
        + "    while [ \"$CAND\" != \"/\" ]; do "
        + "      if [ -f \"$CAND/tools/buck/graph.json\" ]; then export WORKSPACE_ROOT=\"$CAND\"; break; fi; "
        + "      CAND=\"${CAND%/*}\"; "
        + "      if [ -z \"$CAND\" ]; then CAND=\"/\"; fi; "
        + "    done; "
        + "  fi; "
        + "fi; "
        + "export WORKSPACE_ROOT=\"${WORKSPACE_ROOT:-$PWD}\"; "
        + "WS_PHYS_FILE=\"$TMP/bnx-workspace-root.phys\"; "
        + "(cd \"$WORKSPACE_ROOT\" 2>/dev/null && pwd -P > \"$WS_PHYS_FILE\") || true; "
        + "WS_PHYS=\"\"; read -r WS_PHYS < \"$WS_PHYS_FILE\" 2>/dev/null || true; "
        + "if [ -n \"$WS_PHYS\" ]; then WORKSPACE_ROOT=\"$WS_PHYS\"; fi; "
        + "FLK_ROOT=\"${FLK_ROOT:-}\"; "
        + "if [ -z \"${FLK_ROOT:-}\" ] || [ ! -f \"$FLK_ROOT/flake.nix\" ]; then "
        + "  FLK_ROOT=\"${WORKSPACE_ROOT:-${REPO_ROOT:-$PWD}}\"; "
        + "  if [ ! -f \"$FLK_ROOT/flake.nix\" ]; then "
        + "    SEARCH_FROM=\"${WORKSPACE_ROOT:-${REPO_ROOT:-$PWD}}\"; "
        + "    CAND=\"$SEARCH_FROM\"; "
        + "    while [ \"$CAND\" != \"/\" ] && [ ! -f \"$CAND/flake.nix\" ]; do "
        + "      CAND=\"${CAND%/*}\"; "
        + "      if [ -z \"$CAND\" ]; then CAND=\"/\"; fi; "
        + "    done; "
        + "    FLK_ROOT=\"$CAND\"; "
        + "  fi; "
        + "  if [ ! -f \"$FLK_ROOT/flake.nix\" ]; then "
        + "    ROOT_GIT_FILE=\"$TMP/bnx-flk-root.git\"; "
        + "    if git -C \"${REPO_ROOT:-$WORKSPACE_ROOT}\" rev-parse --show-toplevel > \"$ROOT_GIT_FILE\" 2>/dev/null; then "
        + "      ROOT_GIT=\"\"; read -r ROOT_GIT < \"$ROOT_GIT_FILE\" 2>/dev/null || true; "
        + "    else "
        + "      ROOT_GIT=\"${REPO_ROOT:-$WORKSPACE_ROOT}\"; "
        + "    fi; "
        + "    FLK_ROOT=\"$ROOT_GIT\"; "
        + "  fi; "
        + "fi; "
        + "FLK_PHYS_FILE=\"$TMP/bnx-flk-root.phys\"; "
        + "(cd \"$FLK_ROOT\" 2>/dev/null && pwd -P > \"$FLK_PHYS_FILE\") || true; "
        + "FLK_PHYS=\"\"; read -r FLK_PHYS < \"$FLK_PHYS_FILE\" 2>/dev/null || true; "
        + "if [ -n \"$FLK_PHYS\" ]; then FLK_ROOT=\"$FLK_PHYS\"; fi; "
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
        + "  LOCAL_PNPM_STORE=\"\"; read -r LOCAL_PNPM_STORE < \"$FLK_ROOT/buck-out/.unified-pnpm-store/path\" 2>/dev/null || true; "
        + "  export LOCAL_PNPM_STORE; "
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
        + "else "
        + "echo \"error: timeout not found on PATH (expected via direnv/devshell)\" 1>&2; exit 127; "
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
    # Back-compat: historically this helper escaped shell command substitutions ($(...)) so
    # callers could cquery cmd strings without Buck interpreting them as macros.
    # Current bootstraps avoid $(...) entirely, but keep the switch for existing call sites.
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
        impure = False,
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
    ) + nix_build_out_path_cmd(flake_attr, timeout_var = timeout_var, impure = impure)


def nix_build_out_path_cmd(flake_attr, timeout_var = "TIMEOUT", impure = False, build_prefix = ""):
    tout = ""
    if isinstance(timeout_var, str) and timeout_var != "":
        tout = "$%s " % timeout_var
    prefix = ""
    if isinstance(build_prefix, str) and build_prefix != "":
        prefix = build_prefix
        if not prefix.endswith(" "):
            prefix = prefix + " "
    imp = "--impure " if impure else ""
    return (
        "OUT_PATHS_FILE=\"$TMP/bnx-nix-outpaths.txt\"; "
        + (
            tout +
            ("%snix build %s --accept-flake-config %s--no-link --print-out-paths > \"$OUT_PATHS_FILE\"; " % (prefix, flake_attr, imp))
        )
        + "OUT_LAST_FILE=\"$OUT_PATHS_FILE.last\"; "
        + "tail -n1 \"$OUT_PATHS_FILE\" > \"$OUT_LAST_FILE\"; "
        + "outPath=\"\"; read -r outPath < \"$OUT_LAST_FILE\" 2>/dev/null || true; "
        + "test -n \"$outPath\"; "
    )


def nix_calling_env_export_buck_graph_json(graph_json_path = "$WORKSPACE_ROOT/tools/buck/graph.json"):
    return ("export BUCK_GRAPH_JSON=\"%s\"; " % graph_json_path)


def nix_calling_env_export_nix_pnpm_fetch_timeout(default_sec = 600):
    v = default_sec if isinstance(default_sec, int) and default_sec > 0 else 600
    return ("export NIX_PNPM_FETCH_TIMEOUT=\"${NIX_PNPM_FETCH_TIMEOUT:-%d}\"; " % v)



