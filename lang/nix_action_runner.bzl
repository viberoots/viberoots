load("//lang:nix_shell.bzl", "nix_bootstrap_env_core")


def nix_action_workspace_setup_from_args(
        graph_json_arg = "$1",
        workspace_env_arg = "$2",
        flake_file_arg = "$3"):
    return (
        ("GRAPH=\"%s\"; " % graph_json_arg)
        + ("WORKSPACE_ENV=\"%s\"; " % workspace_env_arg)
        + ("FLAKE_FILE=\"%s\"; " % flake_file_arg)
        + "[ -n \"$WORKSPACE_ENV\" ] && [ -f \"$WORKSPACE_ENV\" ] && . \"$WORKSPACE_ENV\" || true; "
        + "if [ -n \"$GRAPH\" ] && [ -z \"${WORKSPACE_ROOT:-}\" ]; then "
        + "  WR=\"${GRAPH%/tools/buck/graph.json}\"; "
        + "  export WORKSPACE_ROOT=\"$WR\"; "
        + "fi; "
        + "export REPO_ROOT=\"${REPO_ROOT:-$WORKSPACE_ROOT}\"; "
        + "if [ -z \"${FLK_ROOT:-}\" ] && [ -n \"$FLAKE_FILE\" ] && [ -f \"$FLAKE_FILE\" ]; then "
        + "  FLK_DIR=\"$(dirname \"$FLAKE_FILE\")\"; "
        + "  FLK_GIT=\"$(git -C \"$FLK_DIR\" rev-parse --show-toplevel 2>/dev/null || echo \"$FLK_DIR\")\"; "
        + "  export FLK_ROOT=\"$FLK_GIT\"; "
        + "fi; "
    )


def nix_action_export_graph_cmd(
        out_graph = "$WORKSPACE_ROOT/tools/buck/graph.json",
        query_roots = "libs,go,cpp,third_party",
        zx_wrapper = "path:$FLK_ROOT#zx-wrapper"):
    return (
        "mkdir -p \"$WORKSPACE_ROOT/tools/buck\"; "
        + ("BUCK_TEST_SRC=\"$WORKSPACE_ROOT\" BUCK_QUERY_ROOTS=\"%s\" " % query_roots)
        + ("nix run --accept-flake-config \"%s\" -- " % zx_wrapper)
        + ("tools/buck/export-graph.ts --out \"%s\"; " % out_graph)
    )


def nix_action_build_selected_out_path_cmd(
        target_label,
        out_var = "OUT_PATH",
        raw_var = "OUT_RAW",
        status_var = "NIX_STATUS",
        log_file = "/tmp/build-selected.log",
        zx_wrapper = "path:$FLK_ROOT#zx-wrapper"):
    return (
        "set +e; "
        + (
            "%s=$(BUCK_TEST_SRC=\"$WORKSPACE_ROOT\" BUCK_TARGET=\"%s\" "
            % (raw_var, target_label)
        )
        + ("nix run --accept-flake-config \"%s\" -- " % zx_wrapper)
        + ("\"$FLK_ROOT/tools/dev/build-selected.ts\" 2> \"%s\"); " % log_file)
        + ("%s=$?; set -e; " % status_var)
        + (
            "%s=$(printf %s \"$%s\" | sed -E 's/\\x1B\\[[0-9;]*[A-Za-z]//g' | tr -d '\\r'); "
            % (out_var, "%s", raw_var)
        )
    )


def nix_action_shell_prefix_core():
    return nix_bootstrap_env_core()


