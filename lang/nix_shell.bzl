def nix_bootstrap_env():
    return (
        "set -euo pipefail; "
        + "export WORKSPACE_ROOT=\"${WORKSPACE_ROOT:-$(pwd)}\"; "
        # Determine flake root, preferring explicit REPO_ROOT from the parent workspace.
        + "FLK_ROOT=\"${REPO_ROOT:-$WORKSPACE_ROOT}\"; "
        + "if [ ! -f \"$FLK_ROOT/flake.nix\" ]; then "
        + "  SEARCH_FROM=\"${REPO_ROOT:-$(pwd)}\"; "
        + "  CAND=\"$SEARCH_FROM\"; "
        + "  while [ \"$CAND\" != \"/\" ] && [ ! -f \"$CAND/flake.nix\" ]; do CAND=\"$(dirname \"$CAND\")\"; done; "
        + "  FLK_ROOT=\"$CAND\"; "
        + "fi; "
        + "if [ ! -f \"$FLK_ROOT/flake.nix\" ]; then "
        + "  ROOT_GIT=\"$(git -C \"${REPO_ROOT:-$WORKSPACE_ROOT}\" rev-parse --show-toplevel 2>/dev/null || echo \"${REPO_ROOT:-$WORKSPACE_ROOT}\")\"; "
        + "  FLK_ROOT=\"$ROOT_GIT\"; "
        + "fi; "
        + "cd \"$WORKSPACE_ROOT\"; "
        + "test -f \"$FLK_ROOT/flake.nix\"; "
    )


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



