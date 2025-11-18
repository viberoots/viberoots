def nix_bootstrap_env():
    return (
        "set -euo pipefail; "
        + "export WORKSPACE_ROOT=\"${WORKSPACE_ROOT:-$(pwd)}\"; cd \"$WORKSPACE_ROOT\"; "
        + "FLK_ROOT=\"$WORKSPACE_ROOT\"; if [ ! -f \"$FLK_ROOT/flake.nix\" ]; then FLK_ROOT=\"$(git -C \"$WORKSPACE_ROOT\" rev-parse --show-toplevel 2>/dev/null || echo \"$WORKSPACE_ROOT\")\"; fi; "
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



