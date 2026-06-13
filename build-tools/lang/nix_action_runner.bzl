load("@viberoots//build-tools/lang:nix_shell.bzl", "nix_bootstrap_env_core")
load("@viberoots//build-tools/lang:importer_roots.bzl", "WORKSPACE_IMPORTER_ROOTS")


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
        + "  WR=\"${GRAPH%/.viberoots/workspace/buck/graph.json}\"; "
        + "  if [ \"$WR\" = \"$GRAPH\" ]; then WR=\"${GRAPH%/build-tools/tools/buck/graph.json}\"; fi; "
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
        out_graph = "$WORKSPACE_ROOT/.viberoots/workspace/buck/graph.json",
        query_roots = None,
        zx_wrapper = "path:$VIBEROOTS_ROOT#zx-wrapper"):
    if not query_roots:
        roots = WORKSPACE_IMPORTER_ROOTS if WORKSPACE_IMPORTER_ROOTS else ["apps", "libs"]
        query_roots = ",".join(roots + ["go", "cpp", "third_party"])
    return (
        "mkdir -p \"$WORKSPACE_ROOT/.viberoots/workspace/buck\"; "
        + "VBR_NODE_ZX_INIT=\"$VIBEROOTS_ROOT/build-tools/tools/dev/zx-init.mjs\"; "
        + "if command -v node >/dev/null 2>&1; then "
        + ("  BUCK_TEST_SRC=\"$WORKSPACE_ROOT\" BUCK_QUERY_ROOTS=\"%s\" " % query_roots)
        + "node --experimental-top-level-await --disable-warning=ExperimentalWarning "
        + "--experimental-strip-types --import \"$VBR_NODE_ZX_INIT\" "
        + ("\"$VIBEROOTS_ROOT/build-tools/tools/buck/export-graph.ts\" --out \"%s\"; " % out_graph)
        + "else "
        + ("  BUCK_TEST_SRC=\"$WORKSPACE_ROOT\" BUCK_QUERY_ROOTS=\"%s\" " % query_roots)
        + ("nix run --accept-flake-config \"%s\" -- " % zx_wrapper)
        + ("\"$VIBEROOTS_ROOT/build-tools/tools/buck/export-graph.ts\" --out \"%s\"; " % out_graph)
        + "fi; "
    )


def nix_action_build_selected_out_path_cmd(
        target_label,
        out_var = "OUT_PATH",
        raw_var = "OUT_RAW",
        status_var = "NIX_STATUS",
        log_file = "/tmp/build-selected.log",
        zx_wrapper = "path:$VIBEROOTS_ROOT#zx-wrapper"):
    return (
        "set +e; "
        + (
            "%s=$(BUCK_TEST_SRC=\"$WORKSPACE_ROOT\" BUCK_TARGET=\"%s\" "
            % (raw_var, target_label)
        )
        + ("nix run --accept-flake-config \"%s\" -- " % zx_wrapper)
        + ("\"$VIBEROOTS_ROOT/build-tools/tools/dev/build-selected.ts\" 2> \"%s\"); " % log_file)
        + ("%s=$?; set -e; " % status_var)
        + (
            "%s=$(printf %s \"$%s\" | sed -E 's/\\x1B\\[[0-9;]*[A-Za-z]//g' | tr -d '\\r'); "
            % (out_var, "%s", raw_var)
        )
    )


def nix_action_shell_prefix_core():
    return nix_bootstrap_env_core()
