load("//cpp/private:sanitize.bzl", "sanitize_to_bin_name")
load("//lang:nix_shell.bzl", "nix_bootstrap_env")


def _cpp_nix_build_impl(ctx):
    # Build a C++ bin/lib/addon via Nix graph-generator-selected and export the artifact as this rule's output.
    # Expected artifact layout (sanitized from the target label via sanitize_to_bin_name):
    # - kind="bin"   → bin/<sanitized>
    # - kind="lib"   → lib/lib<sanitized>.a
    # - kind="addon" → lib/<sanitized>.node
    raw = ctx.attrs.self_label
    kind = ctx.attrs.kind
    # Expected artifact names mirror tools/nix/templates/cpp.nix sanitize logic
    sanitized = sanitize_to_bin_name(raw)
    expected_bin = "bin/%s" % sanitized
    expected_lib = "lib/lib%s.a" % sanitized
    expected_addon = "lib/%s.node" % sanitized
    if kind == "bin":
        expected = expected_bin
    elif kind == "lib":
        expected = expected_lib
    elif kind == "addon":
        # Node-API addon built via cpp-node-addon.nix template
        expected = expected_addon
    else:
        fail(
            "unknown kind for cpp_nix_build: %s. Supported kinds: bin→%s, lib→%s, addon→%s"
            % (kind, expected_bin, expected_lib, expected_addon)
        )
    run_and_copy = (
        nix_bootstrap_env()
        + ("OUT_PATH=$(BUCK_TEST_SRC=\"$PWD\" BUCK_TARGET=\"%s\" nix run \"$FLK_ROOT\"#zx-wrapper -- \"$FLK_ROOT/tools/dev/build-selected.ts\"); " % raw)
        + "test -n \"$OUT_PATH\"; "
        + (
            "if [ ! -e \"$OUT_PATH/%s\" ]; then echo 'cpp_nix_build (%s): expected artifact not found for kind \"%s\": %s' >&2; (ls -la \"$OUT_PATH\"; ls -la \"$OUT_PATH/bin\" 2>/dev/null || true; ls -la \"$OUT_PATH/lib\" 2>/dev/null || true) >&2; exit 2; fi; "
            % (expected, raw, kind, expected)
        )
        + "DEST=\"$0\"; cp -f \"$OUT_PATH/%s\" \"$DEST\"; " % expected
    )
    out = ctx.actions.declare_output(ctx.attrs.out)
    # For bash -c, $0 is set to the first argument after the script string
    cmd = cmd_args([
        "bash",
        "-c",
        run_and_copy,
        out.as_output(),
    ], hidden = ctx.attrs.srcs + ctx.attrs.nix_inputs)  # include local patches and explicit Nix inputs
    ctx.actions.run(cmd, category = "cpp_nix_build")
    return [DefaultInfo(default_output = out)]


cpp_nix_build = rule(
    impl = _cpp_nix_build_impl,
    attrs = {
        "self_label": attrs.string(),
        "kind": attrs.string(),  # "bin" | "lib" | "addon"
        "out": attrs.string(),
        "deps": attrs.list(attrs.dep(), default = []),
        "srcs": attrs.list(attrs.source(), default = []),  # include local patch files as inputs
        "nix_inputs": attrs.list(attrs.source(), default = []),  # explicit Nix inputs that should affect the rule key
        "labels": attrs.list(attrs.string(), default = []),
    },
)


