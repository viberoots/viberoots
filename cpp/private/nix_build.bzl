load("//lang:sanitize.bzl", "sanitize_name")
load("//lang:nix_shell.bzl", "nix_build_out_path_cmd", "nix_cmd_prefix")
load("//lang:nix_action_runner.bzl", "nix_action_export_graph_cmd", "nix_action_workspace_setup_from_args")


def _cpp_nix_build_impl(ctx):
    # Build a C++ bin/lib/addon via Nix graph-generator-selected and export the artifact as this rule's output.
    # Expected artifact layout (sanitized from the target label via sanitize_name):
    # - kind="bin"   → bin/<sanitized>
    # - kind="lib"   → lib/lib<sanitized>.a
    # - kind="addon" → lib/<sanitized>.node
    raw = ctx.attrs.self_label
    kind = ctx.attrs.kind
    link_mode = ctx.attrs.link_mode or "static"
    # Expected artifact names mirror tools/nix/templates/cpp.nix sanitize logic
    sanitized = sanitize_name(raw)
    expected_bin = "bin/%s" % sanitized
    expected_lib = "lib/lib%s.a" % sanitized
    expected_shared_lib = "lib/lib%s.so" % sanitized
    expected_addon = "lib/%s.node" % sanitized
    if kind == "bin":
        expected = expected_bin
    elif kind == "lib":
        if link_mode == "shared":
            expected = expected_shared_lib
        else:
            expected = expected_lib
    elif kind == "addon":
        expected = expected_addon
    else:
        fail(
            "unknown kind for cpp_nix_build: %s. Supported kinds: bin→%s, lib→%s, addon→%s"
            % (kind, expected_bin, expected_lib, expected_addon)
        )
    # Build flow:
    # 1) Ensure the Buck graph is exported for the temp workspace
    # 2) Build the planner-selected attr directly via nix build .#graph-generator-cppTargets.<sanitized>
    # 3) Copy the produced artifact to the declared output
    build_prefix = (
        "env "
        + "PLANNER_ONLY_CPP=1 "
        + ("BUCK_TARGET=\"%s\" " % raw)
        + "BUCK_TEST_SRC=\"$WORKSPACE_ROOT\" "
        + "BUCK_GRAPH_JSON=\"$WORKSPACE_ROOT/tools/buck/graph.json\" "
    )
    run_and_copy = (
        nix_action_workspace_setup_from_args()
        + "export BNX_SKIP_REQUIRE_UNIFIED_PNPM_STORE=1; "
        + nix_cmd_prefix(timeout_var = "TIMEOUT", timeout_sec = 600, include_pnpm_store = False, escape_cmd_subst = True)
        + "cd \"$FLK_ROOT\"; "
        + nix_action_export_graph_cmd(
            out_graph = "$WORKSPACE_ROOT/tools/buck/graph.json",
            query_roots = "libs,go,cpp,third_party",
            zx_wrapper = "path:$FLK_ROOT#zx-wrapper",
        )
        # Require a pre-exported Buck graph for the temp workspace (fail fast if missing)
        + "echo \"[cpp_nix_build] WR=$WORKSPACE_ROOT FLK=$FLK_ROOT\" >&2; "
        + "ls -la \"$WORKSPACE_ROOT/tools/buck\" >/dev/null 2>&1 || true; "
        + "if [ ! -f \"$WORKSPACE_ROOT/tools/buck/graph.json\" ]; then "
        + "  echo 'cpp_nix_build: missing $WORKSPACE_ROOT/tools/buck/graph.json; run tools/buck/export-graph.ts first' >&2; "
        + "  exit 2; "
        + "fi; "
        + "export BUCK_GRAPH_JSON=\"$WORKSPACE_ROOT/tools/buck/graph.json\"; "
        # Build the selected target via the primary flake attr using BUCK_TARGET
        + nix_build_out_path_cmd(
            "\"path:$FLK_ROOT#graph-generator-selected\"",
            timeout_var = "TIMEOUT",
            impure = True,
            build_prefix = build_prefix,
        )
        + (
            "if [ ! -e \"$outPath/%s\" ]; then echo 'cpp_nix_build (%s): expected artifact not found for kind \"%s\": %s' >&2; (ls -la \"$outPath\"; ls -la \"$outPath/bin\" 2>/dev/null || true; ls -la \"$outPath/lib\" 2>/dev/null || true) >&2; exit 2; fi; "
            % (expected, raw, kind, expected)
        )
        + "DEST=\"$0\"; cp -f \"$outPath/%s\" \"$DEST\"; " % expected
    )
    out = ctx.actions.declare_output(ctx.attrs.out)
    # For bash -c, $0 is set to the first argument after the script string
    graph_arg = (ctx.attrs.graph_json if ctx.attrs.graph_json != None else "")
    env_arg = (ctx.attrs.workspace_env if ctx.attrs.workspace_env != None else "")
    cmd = cmd_args([
        "bash",
        "-c",
        run_and_copy,
        out.as_output(),
        # $1: absolute path to tools/buck/graph.json
        graph_arg,
        # $2: optional path to tools/buck/workspace-root.env (may be an empty artifact in some contexts)
        env_arg,
        # $3: absolute path to the repository flake.nix to pin FLK_ROOT deterministically
        ctx.attrs.flake_file if ctx.attrs.flake_file != None else "",
    ], hidden = (
        ctx.attrs.srcs + ctx.attrs.nix_inputs
        + ([ctx.attrs.graph_json] if ctx.attrs.graph_json != None else [])
        + ([ctx.attrs.workspace_env] if ctx.attrs.workspace_env != None else [])
        + ([ctx.attrs.flake_file] if ctx.attrs.flake_file != None else [])
    ))  # include local patches and explicit Nix inputs
    ctx.actions.run(cmd, category = "cpp_nix_build")
    return [DefaultInfo(default_output = out)]


cpp_nix_build = rule(
    impl = _cpp_nix_build_impl,
    attrs = {
        "self_label": attrs.string(),
        "kind": attrs.string(),  # "bin" | "lib" | "addon"
        "out": attrs.string(),
        "deps": attrs.list(attrs.dep(), default = []),
        # Link intent surface (planner/exporter contract; unused by this rule impl).
        "link_deps": attrs.list(attrs.dep(), default = []),
        "header_deps": attrs.list(attrs.dep(), default = []),
        "link_closure": attrs.string(default = "direct"),
        "link_closure_overrides": attrs.dict(key = attrs.label(), value = attrs.string(), default = {}),
        "link_mode": attrs.string(default = "static"),
        "srcs": attrs.list(attrs.source(), default = []),  # include local patch files as inputs
        "nix_inputs": attrs.list(attrs.source(), default = []),  # explicit Nix inputs that should affect the rule key
        "labels": attrs.list(attrs.string(), default = []),
        # Optional: path to a buck graph.json; if provided, used to derive WORKSPACE_ROOT
        "graph_json": attrs.option(attrs.source(), default = None),
        # Optional: env file to inject WORKSPACE_ROOT explicitly (used by tests)
        "workspace_env": attrs.option(attrs.source(), default = None),
        # Optional: absolute path to flake.nix; when provided, used to pin FLK_ROOT deterministically
        "flake_file": attrs.option(attrs.source(), default = None),
    },
)


