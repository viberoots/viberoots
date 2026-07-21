load("@viberoots//build-tools/lang:sanitize.bzl", "sanitize_name")
load("@viberoots//build-tools/lang:nix_shell.bzl", "nix_artifact_bash", "nix_cmd_prefix", "nix_declared_action_inputs_manifest_cmd", "nix_declared_action_transport_args")
load("@viberoots//build-tools/lang:nix_action_runner.bzl", "nix_action_export_graph_cmd", "nix_action_workspace_setup_from_args")
load("@viberoots//build-tools/lang:nix_artifact_inputs.bzl", "nix_artifact_action_inputs", "with_nix_artifact_action_attrs")
load("@viberoots//build-tools/lang:remote_action_policy.bzl", "run_nix_action")


def _cpp_nix_build_impl(ctx):
    # Build a C++ bin/lib/addon via Nix graph-generator-selected and export the artifact as this rule's output.
    # Expected artifact layout (sanitized from the target label via sanitize_name):
    # - kind="bin"   → bin/<sanitized>
    # - kind="lib"   → lib/lib<sanitized>.a
    # - kind="addon" → lib/<sanitized>.node
    # - kind="headers" → header tree under include/ (this rule emits a stamp)
    # - kind="emscripten" → lib/<sanitized>.js + lib/<sanitized>.wasm (this rule emits a stamp)
    raw = ctx.attrs.self_label
    kind = ctx.attrs.kind
    link_mode = ctx.attrs.link_mode or "static"
    # Expected artifact names mirror build-tools/tools/nix/templates/cpp.nix sanitize logic
    sanitized = sanitize_name(raw)
    expected_bin = "bin/%s" % sanitized
    expected_lib = "lib/lib%s.a" % sanitized
    expected_shared_lib = "lib/lib%s.so" % sanitized
    expected_addon = "lib/%s.node" % sanitized
    expected_headers_dir = "include"
    expected_ems_js = "lib/%s.js" % sanitized
    expected_ems_wasm = "lib/%s.wasm" % sanitized
    if kind == "bin":
        expected = expected_bin
    elif kind == "lib":
        if link_mode == "shared":
            expected = expected_shared_lib
        else:
            expected = expected_lib
    elif kind == "addon":
        expected = expected_addon
    elif kind == "headers":
        expected = expected_headers_dir
    elif kind == "emscripten":
        expected = expected_ems_js
    else:
        fail(
            "unknown kind for cpp_nix_build: %s. Supported kinds: bin→%s, lib→%s, addon→%s, headers→%s, emscripten→%s"
            % (kind, expected_bin, expected_lib, expected_addon, expected_headers_dir, expected_ems_js)
        )
    # Build flow:
    # 1) Ensure the Buck graph is exported for the temp workspace
    # 2) Build the planner-selected attr directly via nix build .#graph-generator-cppTargets.<sanitized>
    # 3) Copy the produced artifact to the declared output
    run_and_copy = (
        nix_action_workspace_setup_from_args()
        + "export VBR_SKIP_REQUIRE_UNIFIED_PNPM_STORE=1; "
        + nix_cmd_prefix(timeout_var = "TIMEOUT", timeout_sec = 600, include_pnpm_store = False, escape_cmd_subst = True)
        + nix_declared_action_inputs_manifest_cmd()
        + "BUCK_EXEC_ROOT=\"$PWD\"; "
        + "cd \"$FLK_ROOT\"; "
        + nix_action_export_graph_cmd(
            out_graph = "$WORKSPACE_ROOT/.viberoots/workspace/buck/graph.json",
        )
        # Require a pre-exported Buck graph for the temp workspace (fail fast if missing)
        + "echo \"[cpp_nix_build] WR=$WORKSPACE_ROOT FLK=$FLK_ROOT\" >&2; "
        + "ls -la \"$WORKSPACE_ROOT/.viberoots/workspace/buck\" >/dev/null 2>&1 || true; "
        + "if [ ! -f \"$WORKSPACE_ROOT/.viberoots/workspace/buck/graph.json\" ]; then "
        + "  echo 'cpp_nix_build: missing $WORKSPACE_ROOT/.viberoots/workspace/buck/graph.json; run build-tools/tools/buck/export-graph.ts first' >&2; "
        + "  exit 2; "
        + "fi; "
        + "export BUCK_GRAPH_JSON=\"$WORKSPACE_ROOT/.viberoots/workspace/buck/graph.json\"; "
        + "realpath \"$BUCK_GRAPH_JSON\" >> \"$VBR_BUCK_INPUTS\"; sort -u \"$VBR_BUCK_INPUTS\" -o \"$VBR_BUCK_INPUTS\"; "
        + "export VBR_NODE_ZX_INIT=\"$VIBEROOTS_ROOT/build-tools/tools/dev/zx-init.mjs\"; "
        # Build via a filtered flake snapshot instead of the live repo root so broad
        # dev builds are not poisoned by dirty/untracked workspace artifacts.
        + "export BUCK_TEST_SRC=\"$WORKSPACE_ROOT\"; "
        + "OUT_PATHS_FILE=\"$TMP/vbr-nix-outpaths.txt\"; "
        + (
            "$TIMEOUT node --experimental-top-level-await --disable-warning=ExperimentalWarning "
            + "--experimental-strip-types --import \"$VBR_NODE_ZX_INIT\" "
            + "\"$VIBEROOTS_ROOT/build-tools/tools/dev/nix-build-filtered-flake.ts\" --attr "
            + ("\"graph-generator-selected\" --target \"%s\" --buck-action-inputs \"$VBR_BUCK_INPUTS\" " % raw)
            + nix_declared_action_transport_args()
            + " --planner-only-cpp $VBR_DEV_OVERRIDE_ARG > \"$OUT_PATHS_FILE\"; "
        )
        + "OUT_REST_FILE=\"$OUT_PATHS_FILE.rest\"; sed -n '2,$p' \"$OUT_PATHS_FILE\" > \"$OUT_REST_FILE\"; "
        + "outPath=\"\"; IFS= read -r outPath < \"$OUT_PATHS_FILE\" 2>/dev/null || true; "
        + "case \"$outPath\" in /nix/store/*) ;; *) echo 'cpp_nix_build: filtered build produced an invalid output path' >&2; cat \"$OUT_PATHS_FILE\" >&2; exit 2 ;; esac; "
        + "if [ -s \"$OUT_REST_FILE\" ]; then echo 'cpp_nix_build: filtered build produced multiple stdout lines' >&2; cat \"$OUT_PATHS_FILE\" >&2; exit 2; fi; "
        + (
            "if [ ! -e \"$outPath/%s\" ]; then echo 'cpp_nix_build (%s): expected artifact not found for kind \"%s\": %s' >&2; (ls -la \"$outPath\"; ls -la \"$outPath/bin\" 2>/dev/null || true; ls -la \"$outPath/lib\" 2>/dev/null || true; ls -la \"$outPath/include\" 2>/dev/null || true) >&2; exit 2; fi; "
            % (expected, raw, kind, expected)
        )
        + (
            "if [ \"%s\" = \"headers\" ]; then "
            + "if ! find \"$outPath/include\" -type f \\( -name '*.h' -o -name '*.hpp' -o -name '*.hh' -o -name '*.hxx' \\) | awk 'NR==1{found=1} END{exit !found}'; then "
            + "  echo 'cpp_nix_build (%s): headers output contains no header files under include/' >&2; "
            + "  exit 2; "
            + "fi; "
            + "DEST=\"$0\"; case \"$DEST\" in /*) ;; *) DEST=\"$BUCK_EXEC_ROOT/$DEST\" ;; esac; mkdir -p \"$(dirname \"$DEST\")\"; "
            + "if [ -f \"$outPath/build.log\" ]; then cp -f \"$outPath/build.log\" \"$DEST\"; else printf 'kind=headers\\nlabel=%s\\nout=%s\\n' > \"$DEST\"; fi; "
            + "elif [ \"%s\" = \"emscripten\" ]; then "
            + "if [ ! -f \"$outPath/%s\" ]; then "
            + "  echo 'cpp_nix_build (%s): expected Emscripten WASM artifact missing: %s' >&2; "
            + "  exit 2; "
            + "fi; "
            + "DEST=\"$0\"; case \"$DEST\" in /*) ;; *) DEST=\"$BUCK_EXEC_ROOT/$DEST\" ;; esac; mkdir -p \"$(dirname \"$DEST\")\"; "
            + "printf '%%s\\n' "
            + "  'kind=emscripten' "
            + "  'label=%s' "
            + "  \"nix_out=$outPath\" "
            + "  \"build_log=$outPath/build.log\" "
            + "  \"phase_log=$outPath/diagnostics/emscripten/phase-times.tsv\" "
            + "  \"compile_log=$outPath/diagnostics/emscripten/compile-times.tsv\" "
            + "  \"source_log=$outPath/diagnostics/emscripten/source-list.txt\" "
            + "  \"js=$outPath/%s\" "
            + "  \"wasm=$outPath/%s\" > \"$DEST\"; "
            + "else "
            + "DEST=\"$0\"; case \"$DEST\" in /*) ;; *) DEST=\"$BUCK_EXEC_ROOT/$DEST\" ;; esac; mkdir -p \"$(dirname \"$DEST\")\"; cp -f \"$outPath/%s\" \"$DEST\"; "
            + "fi; "
        ) % (kind, raw, raw, expected, kind, expected_ems_wasm, raw, expected_ems_wasm, raw, expected_ems_js, expected_ems_wasm, expected)
    )
    out = ctx.actions.declare_output(ctx.attrs.out)
    # For bash -c, $0 is set to the first argument after the script string
    graph_arg = ctx.attrs._graph_json
    env_arg = ctx.attrs._workspace_root_env
    cmd = cmd_args([
        nix_artifact_bash(),
        "-c",
        run_and_copy,
        out.as_output(),
        # $1: absolute path to .viberoots/workspace/buck/graph.json
        graph_arg,
        # $2: optional path to .viberoots/workspace/buck/workspace-root.env
        env_arg,
        # $3: absolute path to the repository flake.nix to pin FLK_ROOT deterministically
        ctx.attrs.flake_file if ctx.attrs.flake_file != None else "",
    ], hidden = nix_artifact_action_inputs(ctx) + ([ctx.attrs.flake_file] if ctx.attrs.flake_file != None else []))
    declared_inputs = nix_artifact_action_inputs(ctx) + ([ctx.attrs.flake_file] if ctx.attrs.flake_file != None else [])
    policy_info = run_nix_action(ctx, cmd, category = "cpp_nix_build", declared_inputs = declared_inputs)
    return [DefaultInfo(default_output = out)] + policy_info


cpp_nix_build = rule(
    impl = _cpp_nix_build_impl,
    attrs = with_nix_artifact_action_attrs({
        "self_label": attrs.string(),
        "kind": attrs.string(),  # "bin" | "lib" | "addon" | "headers" | "emscripten"
        "out": attrs.string(),
        "deps": attrs.list(attrs.dep(), default = []),
        # Link intent surface (planner/exporter contract; unused by this rule impl).
        "link_deps": attrs.list(attrs.dep(), default = []),
        "header_deps": attrs.list(attrs.dep(), default = []),
        "link_closure": attrs.string(default = "direct"),
        "link_closure_overrides": attrs.dict(key = attrs.label(), value = attrs.string(), default = {}),
        "link_mode": attrs.string(default = "static"),
        "nixpkgs_profile": attrs.string(default = "default"),
        "nixpkg_pins": attrs.dict(key = attrs.string(), value = attrs.dict(key = attrs.string(), value = attrs.string()), default = {}),
        "srcs": attrs.list(attrs.source(), default = []),  # include local patch files as inputs
        "nix_inputs": attrs.list(attrs.source(), default = []),  # explicit Nix inputs that should affect the rule key
        "labels": attrs.list(attrs.string(), default = []),
        # Optional Emscripten symbol export contract (consumed by planner/template path).
        "exported_functions": attrs.list(attrs.string(), default = []),
        # Optional: absolute path to flake.nix; when provided, used to pin FLK_ROOT deterministically
        "flake_file": attrs.option(attrs.source(), default = None),
    }),
)
