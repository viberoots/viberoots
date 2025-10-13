load("@prelude//:rules.bzl", "cxx_library", "cxx_binary", "cxx_test")
load("//lang:defs_common.bzl", "stamp_labels")
load("//third_party/providers:auto_map.bzl", "MODULE_PROVIDERS")
load("//third_party/providers:nix_attr_map.bzl", "NIX_ATTR_MAP")

def _replace_all(hay, needle, repl):
    if needle == "":
        return hay
    return repl.join(hay.split(needle))

def _sanitize_to_bin_name(s):
    # Mirror tools/nix/templates-common.nix sanitizeName exactly:
    # replaceStrings ["//" ":" "/" " "] ["" "-" "-" "-"] s
    s1 = _replace_all(s, "//", "")
    s2 = _replace_all(s1, ":", "-")
    s3 = _replace_all(s2, "/", "-")
    s4 = _replace_all(s3, " ", "-")
    return s4

def _providers_for(name):
    pkg = native.package_name()
    key = "//%s:%s" % (pkg, name)
    return MODULE_PROVIDERS.get(key, [])


def nix_cpp_library(name, **kwargs):
    # Build via Nix, not Buck's C++ toolchain
    deps = kwargs.pop("deps", [])
    stamp_labels(kwargs, "cpp", "lib")
    _cpp_nix_build(
        name = name,
        out = _sanitize_to_bin_name("//%s:%s" % (native.package_name(), name)) + ".a",
        kind = "lib",
        self_label = "//%s:%s" % (native.package_name(), name),
        deps = deps + _providers_for(name),
        labels = kwargs.get("labels", []),
    )


def nix_cpp_binary(name, **kwargs):
    # Build via Nix, not Buck's C++ toolchain
    deps = kwargs.pop("deps", [])
    stamp_labels(kwargs, "cpp", "bin")
    _cpp_nix_build(
        name = name,
        out = _sanitize_to_bin_name("//%s:%s" % (native.package_name(), name)),
        kind = "bin",
        self_label = "//%s:%s" % (native.package_name(), name),
        deps = deps + _providers_for(name),
        labels = kwargs.get("labels", []),
    )


def nix_cpp_test(name, **kwargs):
    # Define a planner-visible cxx_test (not executed) and an external runner test (executed)
    deps = kwargs.pop("deps", [])
    srcs = kwargs.get("srcs", [])
    planner_name = name + "__planner"
    # Planner-visible: stamps labels and wires providers so exporter->planner can generate the Nix derivation
    _planner_kwargs = dict(kwargs)
    stamp_labels(_planner_kwargs, "cpp", "test")
    # Use generated mapping from provider targets → canonical nixpkg: labels (PR 3 Option A)
    extra_nixpkg_labels = []
    for d in deps:
        if isinstance(d, str) and d.startswith("//third_party/providers:"):
            lbl = NIX_ATTR_MAP.get(d)
            if lbl != None and isinstance(lbl, str) and lbl != "":
                extra_nixpkg_labels.append(lbl)
    _planner_labels = _planner_kwargs.get("labels", []) + extra_nixpkg_labels
    # Planner-visible stub: declare a cxx_library without compiling test sources; Nix will build the test.
    # Filter provider deps from planner to avoid visibility / graph-edge to providers
    _planner_deps = []
    for d in deps:
        if not isinstance(d, str):
            continue
        if d.startswith("//third_party/providers:"):
            continue
        _planner_deps.append(d)

    _cpp_planner_stub(
        name = planner_name,
        out = planner_name + ".stamp",
        # Graph edges for planner discovery
        deps = _planner_deps,
        # labels carry nixpkg attrs for the planner in the exported graph
        labels = _planner_labels,
    )
    # Executed: external runner builds the corresponding flake attr for planner_name and runs it
    _cpp_nix_test(
        name = name,
        out = name + ".stamp",
        planner_label = "//%s:%s" % (native.package_name(), planner_name),
        planner = ":%s" % planner_name,
    )


def _cpp_planner_stub_impl(ctx):
    # Minimal planner-visible node: writes a stamp file and exposes edges via deps
    out = ctx.actions.declare_output(ctx.attrs.out)
    ctx.actions.write(out, "planner\n")
    return [DefaultInfo(default_output = out)]


_cpp_planner_stub = rule(
    impl = _cpp_planner_stub_impl,
    attrs = {
        "out": attrs.string(),
        "deps": attrs.list(attrs.dep(), default = []),
        "labels": attrs.list(attrs.string(), default = []),
    },
)


def _cpp_nix_test_impl(ctx):
    pkg = ctx.label.package
    nm = ctx.label.name
    # Build per-target attr exposed by flake: packages.<system>.graph-generator-cppTargets.<sanitized>
    # Sanitize label to match cppTargetsFlat in graph-generator.nix
    raw = ctx.attrs.planner_label
    # Compute expected test binary name deterministically
    expected_bin = _sanitize_to_bin_name(raw)
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
        "set -euo pipefail; "
        + "export WORKSPACE_ROOT=\"${WORKSPACE_ROOT:-$(pwd)}\"; cd \"$WORKSPACE_ROOT\"; "
        + "FLK_ROOT=\"$WORKSPACE_ROOT\"; if [ ! -f \"$FLK_ROOT/flake.nix\" ]; then FLK_ROOT=\"$(git -C \"$WORKSPACE_ROOT\" rev-parse --show-toplevel 2>/dev/null || echo \"$WORKSPACE_ROOT\")\"; fi; "
        + "test -f \"$FLK_ROOT/flake.nix\"; "
        + ("echo '[cpp_nix_test] planner_label=%s' >&2; " % raw)
        + "# Use centralized zx helper to export graph (if needed) and build selected target\n"
        + (
            "set +e; OUT_RAW=$(BUCK_TEST_SRC=\"$PWD\" BUCK_TARGET=\"%s\" nix run \"$FLK_ROOT\"#zx-wrapper -- \"$FLK_ROOT/tools/dev/build-selected.ts\" 2> /tmp/cpp_nix_test_build.log); " % raw
        )
        + "NIX_STATUS=$?; set -e; OUT_PATH=$(printf %s \"$OUT_RAW\" | sed -E 's/\\x1B\\[[0-9;]*[A-Za-z]//g' | tr -d '\r'); "
        + "echo \"[cpp_nix_test] OUT_PATH=$OUT_PATH\" >&2; "
        + "if [ \"$NIX_STATUS\" -ne 0 ] || [ -z \"$OUT_PATH\" ]; then echo '[cpp_nix_test] build-selected failed' >&2; cat /tmp/cpp_nix_test_build.log >&2 || true; exit ${NIX_STATUS:-2}; fi; "
        + ("BIN='%s'; " % expected_bin)
        + "CAND=\"$OUT_PATH/bin/$BIN\"; if [ ! -x \"$CAND\" ]; then echo '[cpp_nix_test] expected bin not found:' \"$CAND\" >&2; ls -la \"$OUT_PATH\" >&2 || true; ls -la \"$OUT_PATH/bin\" >&2 || true; exit 2; fi; "
        + "\"$CAND\""
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


_cpp_nix_test = rule(
    impl = _cpp_nix_test_impl,
    attrs = {
        "planner_label": attrs.string(),
        "out": attrs.string(),
        # Create a graph edge so exporter cquery includes the planner cxx_test node
        "planner": attrs.dep(),
    },
)


def _cpp_nix_build_impl(ctx):
    # Build a C++ bin/lib via Nix graph-generator-selected and export the artifact as this rule's output
    raw = ctx.attrs.self_label
    kind = ctx.attrs.kind
    # Expected artifact names mirror tools/nix/templates/cpp.nix sanitize logic
    sanitized = _sanitize_to_bin_name(raw)
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
    cmd = cmd_args(["bash", "-c", run_and_copy, out.as_output()])
    ctx.actions.run(cmd, category = "cpp_nix_build")
    return [DefaultInfo(default_output = out)]


_cpp_nix_build = rule(
    impl = _cpp_nix_build_impl,
    attrs = {
        "self_label": attrs.string(),
        "kind": attrs.string(),  # "bin" | "lib"
        "out": attrs.string(),
        "deps": attrs.list(attrs.dep(), default = []),  # graph edge for provider discovery
        "labels": attrs.list(attrs.string(), default = []),
    },
)


def _sanitize_probe_impl(ctx):
    # Emit a tiny file containing the sanitized form of the provided label
    val = _sanitize_to_bin_name(ctx.attrs.label)
    out = ctx.actions.declare_output(ctx.attrs.out)
    ctx.actions.write(out, val + "\n")
    return [DefaultInfo(default_output = out)]


_sanitize_probe = rule(
    impl = _sanitize_probe_impl,
    attrs = {
        "label": attrs.string(),
        "out": attrs.string(),
    },
)


def cpp_sanitize_probe(name, label):
    # Helper used only in tests to surface the sanitizer result via a declared output name
    _sanitize_probe(
        name = name,
        label = label,
        out = _sanitize_to_bin_name(label) + ".txt",
    )

