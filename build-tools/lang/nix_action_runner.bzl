load("@viberoots//build-tools/lang:nix_shell.bzl", "nix_artifact_tool_authority_shell", "nix_bootstrap_env_core", "nix_declared_action_inputs_manifest_cmd", "nix_declared_action_transport_args")
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
        + nix_artifact_tool_authority_shell()
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
        query_roots = None):
    if not query_roots:
        roots = WORKSPACE_IMPORTER_ROOTS if WORKSPACE_IMPORTER_ROOTS else ["apps", "libs"]
        query_roots = ",".join(roots + ["go", "cpp", "third_party"])
    return (
        "mkdir -p \"$WORKSPACE_ROOT/.viberoots\" \"$WORKSPACE_ROOT/.viberoots/workspace\" \"$WORKSPACE_ROOT/.viberoots/workspace/buck\"; "
        + "if [ \"$(uname -s 2>/dev/null || true)\" = \"Darwin\" ]; then [ ! -e \"$WORKSPACE_ROOT/.viberoots/.metadata_never_index\" ] && : > \"$WORKSPACE_ROOT/.viberoots/.metadata_never_index\"; [ ! -e \"$WORKSPACE_ROOT/.viberoots/workspace/.metadata_never_index\" ] && : > \"$WORKSPACE_ROOT/.viberoots/workspace/.metadata_never_index\"; [ ! -e \"$WORKSPACE_ROOT/.viberoots/workspace/buck/.metadata_never_index\" ] && : > \"$WORKSPACE_ROOT/.viberoots/workspace/buck/.metadata_never_index\"; fi; "
        + "VBR_NODE_ZX_INIT=\"$VIBEROOTS_ROOT/build-tools/tools/dev/zx-init.mjs\"; "
        + ("BUCK_TEST_SRC=\"$WORKSPACE_ROOT\" BUCK_QUERY_ROOTS=\"%s\" " % query_roots)
        + "node --experimental-top-level-await --disable-warning=ExperimentalWarning "
        + "--experimental-strip-types --import \"$VBR_NODE_ZX_INIT\" "
        + ("\"$VIBEROOTS_ROOT/build-tools/tools/buck/export-graph.ts\" --out \"%s\"; " % out_graph)
    )


def nix_action_build_selected_out_path_cmd(
        target_label,
        out_var = "OUT_PATH",
        raw_var = "OUT_RAW",
        status_var = "NIX_STATUS",
        log_file = "$WORKSPACE_ROOT/buck-out/tmp/build-selected/build-selected.log",
        attr = "graph-generator-selected",
        escape_cmd_subst = False,
        graph_json_arg = ""):
    subst_open = "`" if escape_cmd_subst else "$("
    subst_close = "`" if escape_cmd_subst else ")"
    return (
        ((
            "VBR_DECLARED_GRAPH=\"%s\"; " % graph_json_arg
            + "test -f \"$VBR_DECLARED_GRAPH\" || { echo \"declared Buck graph is missing: $VBR_DECLARED_GRAPH\" >&2; exit 2; }; "
            + "VBR_DECLARED_GRAPH_REAL_FILE=\"$TMP/vbr-declared-graph.real\"; realpath \"$VBR_DECLARED_GRAPH\" > \"$VBR_DECLARED_GRAPH_REAL_FILE\"; "
            + "BUCK_GRAPH_JSON=\"\"; read -r BUCK_GRAPH_JSON < \"$VBR_DECLARED_GRAPH_REAL_FILE\"; export BUCK_GRAPH_JSON; "
        ) if graph_json_arg else "")
        + "test -f \"${BUCK_GRAPH_JSON:-}\" || { echo 'selected artifact build requires the declared Buck graph' >&2; exit 2; }; "
        + nix_declared_action_inputs_manifest_cmd()
        + ("VBR_BUILD_SELECTED_LOG=\"%s\"; " % log_file)
        + ("case \"$VBR_BUILD_SELECTED_LOG\" in /*) VBR_BUILD_SELECTED_LOG_DIR=\"%sdirname \"$VBR_BUILD_SELECTED_LOG\"%s\" ;; *) VBR_BUILD_SELECTED_LOG_DIR=\"%sdirname \"${WORKSPACE_ROOT:-$PWD}/$VBR_BUILD_SELECTED_LOG\"%s\" ;; esac; " % (subst_open, subst_close, subst_open, subst_close))
        + "mkdir -p \"$VBR_BUILD_SELECTED_LOG_DIR\"; "
        + "[ -e \"$VBR_BUILD_SELECTED_LOG_DIR/.metadata_never_index\" ] || : > \"$VBR_BUILD_SELECTED_LOG_DIR/.metadata_never_index\" 2>/dev/null || true; "
        + "VBR_NODE_ZX_INIT=\"$VIBEROOTS_ROOT/build-tools/tools/dev/zx-init.mjs\"; "
        + "set +e; "
        + ("%s=%s" % (raw_var, subst_open))
        + " (cd \"$WORKSPACE_ROOT\" && env -u WORKSPACE_ROOT -u BUCK_TEST_SRC node --experimental-top-level-await --disable-warning=ExperimentalWarning "
        + "--experimental-strip-types --import \"$VBR_NODE_ZX_INIT\" "
        + ("\"$VIBEROOTS_ROOT/build-tools/tools/dev/build-selected.ts\" --target \"%s\" --attr %s --buck-action-inputs \"$VBR_BUCK_INPUTS\" " % (target_label, attr))
        + nix_declared_action_transport_args()
        + " $VBR_DEV_OVERRIDE_ARG "
        + ("2> \"$VBR_BUILD_SELECTED_LOG\")%s; " % subst_close)
        + ("%s=$?; set -e; " % status_var)
        + (
            "%s=%sprintf %s \"$%s\" | sed -E 's/\\x1B\\[[0-9;]*[A-Za-z]//g' | tr -d '\\r'%s; "
            % (out_var, subst_open, "%s", raw_var, subst_close)
        )
    )


def nix_action_shell_prefix_core():
    return nix_bootstrap_env_core()
