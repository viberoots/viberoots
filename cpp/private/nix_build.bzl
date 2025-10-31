load("//cpp/private:sanitize.bzl", "sanitize_to_bin_name")


def _cpp_nix_build_impl(ctx):
    # Build a C++ bin/lib via Nix graph-generator-selected and export the artifact as this rule's output
    raw = ctx.attrs.self_label
    kind = ctx.attrs.kind
    # Expected artifact names mirror tools/nix/templates/cpp.nix sanitize logic
    sanitized = sanitize_to_bin_name(raw)
    expected = ("bin/%s" % sanitized) if kind == "bin" else ("lib/lib%s.a" % sanitized)
    run_and_copy = (
        "set -euo pipefail; "
        + "export WORKSPACE_ROOT=\"${WORKSPACE_ROOT:-$(pwd)}\"; cd \"$WORKSPACE_ROOT\"; "
        + "FLK_ROOT=\"$WORKSPACE_ROOT\"; if [ ! -f \"$FLK_ROOT/flake.nix\" ]; then FLK_ROOT=\"$(git -C \"$WORKSPACE_ROOT\" rev-parse --show-toplevel 2>/dev/null || echo \"$WORKSPACE_ROOT\")\"; fi; "
        + "test -f \"$FLK_ROOT/flake.nix\"; "
        + ("OUT_PATH=$(BUCK_TEST_SRC=\"$PWD\" BUCK_TARGET=\"%s\" nix run \"$FLK_ROOT\"#zx-wrapper -- \"$FLK_ROOT/tools/dev/build-selected.ts\"); " % raw)
        + "test -n \"$OUT_PATH\"; "
        + ("if [ ! -e \"$OUT_PATH/%s\" ]; then echo 'expected artifact not found: %s' >&2; (ls -la \"$OUT_PATH\"; ls -la \"$OUT_PATH/bin\" 2>/dev/null || true; ls -la \"$OUT_PATH/lib\" 2>/dev/null || true) >&2; exit 2; fi; " % (expected, expected))
        + "DEST=\"$0\"; cp -f \"$OUT_PATH/%s\" \"$DEST\"; " % expected
    )
    out = ctx.actions.declare_output(ctx.attrs.out)
    # For bash -c, $0 is set to the first argument after the script string
    cmd = cmd_args([
        "bash",
        "-c",
        run_and_copy,
        out.as_output(),
    ], hidden = ctx.attrs.srcs)  # ensure local patch files are inputs
    ctx.actions.run(cmd, category = "cpp_nix_build")
    return [DefaultInfo(default_output = out)]


cpp_nix_build = rule(
    impl = _cpp_nix_build_impl,
    attrs = {
        "self_label": attrs.string(),
        "kind": attrs.string(),  # "bin" | "lib"
        "out": attrs.string(),
        "deps": attrs.list(attrs.dep(), default = []),  # graph edge for provider discovery
        "srcs": attrs.list(attrs.source(), default = []),  # include local patch files as inputs
        "labels": attrs.list(attrs.string(), default = []),
    },
)


