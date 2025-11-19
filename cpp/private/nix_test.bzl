load("//cpp/private:sanitize.bzl", "sanitize_to_bin_name")
load("//lang:nix_shell.bzl", "nix_bootstrap_env", "nix_timeout_wrapper_var")


def _cpp_nix_test_impl(ctx):
    pkg = ctx.label.package
    nm = ctx.label.name
    # Build per-target attr exposed by flake: packages.<system>.graph-generator-cppTargets.<sanitized>
    # Sanitize label to match cppTargetsFlat in graph-generator.nix
    raw = ctx.attrs.planner_label
    # Compute expected test binary name deterministically based on the planner label
    expected_bin = sanitize_to_bin_name(raw)
    def _sanitize(s):
        # Map to [a-z0-9_] only, lowercased; others become '_', then prefix with 't'
        s = s.lower()
        out = ""
        for i in range(len(s)):
            c = s[i]
            is_alpha = (c >= "a" and c <= "z")
            is_num = (c >= "0" and c <= "9")
            out = out + (c if (is_alpha or is_num or c == "_") else "_")
        return "t" + out
    attr = _sanitize(raw)
    run_and_exec = (
        nix_bootstrap_env()
        + ("echo '[cpp_nix_test] planner_label=%s' >&2; " % raw)
        + "# Use centralized zx helper to export graph (if needed) and build selected target\n"
        + ("set +e; OUT_RAW=$(BUCK_TEST_SRC=\"$WORKSPACE_ROOT\" BUCK_TARGET=\"%s\" nix run \"$FLK_ROOT\"#zx-wrapper -- \"$FLK_ROOT/tools/dev/build-selected.ts\" 2> /tmp/cpp_nix_test_build.log); " % raw)
        + "NIX_STATUS=$?; set -e; OUT_PATH=$(printf %s \"$OUT_RAW\" | sed -E 's/\\x1B\\[[0-9;]*[A-Za-z]//g' | tr -d '\r'); "
        + "echo \"[cpp_nix_test] OUT_PATH=$OUT_PATH\" >&2; "
        + "if [ \"$NIX_STATUS\" -ne 0 ] || [ -z \"$OUT_PATH\" ]; then echo '[cpp_nix_test] build-selected failed' >&2; cat /tmp/cpp_nix_test_build.log >&2 || true; exit ${NIX_STATUS:-2}; fi; "
        + ("BIN='%s'; " % expected_bin)
        + "CAND=\"$OUT_PATH/bin/$BIN\"; "
        + "if [ ! -x \"$CAND\" ]; then "
        + "  echo '[cpp_nix_test] expected bin not found:' \"$CAND\" >&2; "
        + "  base=\"%s\"; base=${base##*:}; " % raw
        + "  # Fallback: try to locate the produced test binary by suffixing the target name\n"
        + "  found=$(ls -1 \"$OUT_PATH/bin\" 2>/dev/null | grep -E \"(^|-)${base}$\" | head -n1 || true); "
        + "  if [ -n \"$found\" ] && [ -x \"$OUT_PATH/bin/$found\" ]; then CAND=\"$OUT_PATH/bin/$found\"; else ls -la \"$OUT_PATH\" >&2 || true; ls -la \"$OUT_PATH/bin\" >&2 || true; exit 2; fi; "
        + "fi; "
        + nix_timeout_wrapper_var(var_name = "TIMEOUT", default_sec = 600)
        + "$TIMEOUT \"$CAND\""
    )
    stamp = ctx.actions.declare_output(ctx.attrs.out)
    ctx.actions.write(stamp, "cpp_nix_test\n")
    return [
        DefaultInfo(default_output = stamp),
        ExternalRunnerTestInfo(
            type = "custom",
            command = ["bash", "-c", run_and_exec],
            labels = [],
            contacts = [],
        ),
    ]


cpp_nix_test = rule(
    impl = _cpp_nix_test_impl,
    attrs = {
        "planner_label": attrs.string(),
        "out": attrs.string(),
        # Create a graph edge so exporter cquery includes the planner cxx_test node
        "planner": attrs.dep(),
    },
)


