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
        + "if [ -n \"${0:-}\" ]; then case \"$0\" in /*) mkdir -p \"$(dirname \"$0\")\" ;; *) mkdir -p \"$(dirname \"${WORKSPACE_ROOT:-$PWD}/$0\")\" ;; esac; fi; "
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
        "mkdir -p \"$WORKSPACE_ROOT/.viberoots\" \"$WORKSPACE_ROOT/.viberoots/workspace\" \"$WORKSPACE_ROOT/.viberoots/workspace/buck\"; "
        + "if [ \"$(uname -s 2>/dev/null || true)\" = \"Darwin\" ]; then [ ! -e \"$WORKSPACE_ROOT/.viberoots/.metadata_never_index\" ] && : > \"$WORKSPACE_ROOT/.viberoots/.metadata_never_index\"; [ ! -e \"$WORKSPACE_ROOT/.viberoots/workspace/.metadata_never_index\" ] && : > \"$WORKSPACE_ROOT/.viberoots/workspace/.metadata_never_index\"; [ ! -e \"$WORKSPACE_ROOT/.viberoots/workspace/buck/.metadata_never_index\" ] && : > \"$WORKSPACE_ROOT/.viberoots/workspace/buck/.metadata_never_index\"; fi; "
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
        log_file = "$WORKSPACE_ROOT/buck-out/tmp/build-selected/build-selected.log",
        zx_wrapper = "path:$VIBEROOTS_ROOT#zx-wrapper"):
    return (
        "ZX_WRAPPER_REF=\"%s\"; " % zx_wrapper
        + ("VBR_BUILD_SELECTED_LOG=\"%s\"; " % log_file)
        + "case \"$VBR_BUILD_SELECTED_LOG\" in /*) VBR_BUILD_SELECTED_LOG_DIR=\"$(dirname \"$VBR_BUILD_SELECTED_LOG\")\" ;; *) VBR_BUILD_SELECTED_LOG_DIR=\"$(dirname \"${WORKSPACE_ROOT:-$PWD}/$VBR_BUILD_SELECTED_LOG\")\" ;; esac; "
        + "mkdir -p \"$VBR_BUILD_SELECTED_LOG_DIR\"; "
        + "if [ \"$(uname -s 2>/dev/null || true)\" = \"Darwin\" ]; then [ ! -e \"$VBR_BUILD_SELECTED_LOG_DIR/.metadata_never_index\" ] && : > \"$VBR_BUILD_SELECTED_LOG_DIR/.metadata_never_index\"; fi; "
        + "VBR_NODE_ZX_INIT=\"$VIBEROOTS_ROOT/build-tools/tools/dev/zx-init.mjs\"; "
        + "BUCK_TEST_SRC=\"$WORKSPACE_ROOT\"; "
        + ("BUCK_TARGET=\"%s\"; " % target_label)
        + "export BUCK_TEST_SRC BUCK_TARGET; "
        + "set +e; "
        + ("%s=$(if command -v node >/dev/null 2>&1; then " % raw_var)
        + "node --experimental-top-level-await --disable-warning=ExperimentalWarning "
        + "--experimental-strip-types --import \"$VBR_NODE_ZX_INIT\" "
        + "\"$VIBEROOTS_ROOT/build-tools/tools/dev/build-selected.ts\"; "
        + "else "
        + "${TIMEOUT:+$TIMEOUT }nix run --accept-flake-config \"$ZX_WRAPPER_REF\" -- "
        + "\"$VIBEROOTS_ROOT/build-tools/tools/dev/build-selected.ts\"; "
        + "fi 2> \"$VBR_BUILD_SELECTED_LOG\"); "
        + ("%s=$?; set -e; " % status_var)
        + (
            "%s=$(printf %s \"$%s\" | sed -E 's/\\x1B\\[[0-9;]*[A-Za-z]//g' | tr -d '\\r'); "
            % (out_var, "%s", raw_var)
        )
    )


def nix_action_shell_prefix_core():
    return nix_bootstrap_env_core()
