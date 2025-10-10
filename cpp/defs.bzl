load("@prelude//:rules.bzl", "cxx_library", "cxx_binary", "cxx_test")
load("//lang:defs_common.bzl", "stamp_labels")
load("//third_party/providers:auto_map.bzl", "MODULE_PROVIDERS")

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
    deps = kwargs.pop("deps", [])
    # Stamp language/kind onto kwargs["labels"] while preserving any existing labels
    stamp_labels(kwargs, "cpp", "lib")
    deps = deps + _providers_for(name)
    cxx_library(name = name, deps = deps, **kwargs)


def nix_cpp_binary(name, **kwargs):
    deps = kwargs.pop("deps", [])
    stamp_labels(kwargs, "cpp", "bin")
    deps = deps + _providers_for(name)
    cxx_binary(name = name, deps = deps, **kwargs)


def nix_cpp_test(name, **kwargs):
    # Define a planner-visible cxx_test (not executed) and an external runner test (executed)
    deps = kwargs.pop("deps", [])
    srcs = kwargs.get("srcs", [])
    planner_name = name + "__planner"
    # Planner-visible: stamps labels and wires providers so exporter->planner can generate the Nix derivation
    _planner_kwargs = dict(kwargs)
    stamp_labels(_planner_kwargs, "cpp", "test")
    # Derive nixpkg:* labels from explicit provider deps to aid planner collection.
    # Generic rule: any dep ending with :nix_pkgs_<attr> → nixpkg:pkgs.<attr> ("_" → ".").
    # Keep gtest special-case to preserve canonical googletest label.
    extra_nixpkg_labels = []
    for d in deps:
        if ":nix_pkgs_" in d:
            tail = d.split(":nix_pkgs_")[-1]
            # Map underscores to dots for attr path (e.g., openssl → pkgs.openssl; zlib → pkgs.zlib).
            attr = tail.replace("_", ".")
            extra_nixpkg_labels.append("nixpkg:pkgs.%s" % attr)
        if d.endswith(":nix_pkgs_gtest") or d.endswith(":nix_pkgs_gtest_main"):
            # Add both gtest and googletest labels for compatibility across Nixpkgs variants.
            extra_nixpkg_labels.append("nixpkg:pkgs.gtest")
            extra_nixpkg_labels.append("nixpkg:pkgs.googletest")
    _planner_labels = _planner_kwargs.get("labels", []) + extra_nixpkg_labels
    # Planner-visible stub: expose test sources in `srcs` so planner can pass only test files
    cxx_library(
        name = planner_name,
        headers = [],
        exported_headers = [],
        srcs = srcs,
        deps = deps + _providers_for(name) + _providers_for(planner_name),
        labels = _planner_labels,
    )
    # Executed: external runner builds the corresponding flake attr for planner_name and runs it
    _cpp_nix_test(
        name = name,
        out = name + ".stamp",
        planner_label = "//%s:%s" % (native.package_name(), planner_name),
        planner = ":%s" % planner_name,
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
        # Strict shell; fail fast on nix errors
        "set -euo pipefail; "
        +
        # Establish repo roots
        "export WORKSPACE_ROOT=\"${WORKSPACE_ROOT:-$(pwd)}\"; "
        + "cd \"$WORKSPACE_ROOT\"; "
        + "FLK_ROOT=\"$WORKSPACE_ROOT\"; if [ ! -f \"$FLK_ROOT/flake.nix\" ]; then FLK_ROOT=\"$(git -C \"$WORKSPACE_ROOT\" rev-parse --show-toplevel 2>/dev/null || echo \"$WORKSPACE_ROOT\")\"; fi; "
        + "if [ ! -f \"$FLK_ROOT/flake.nix\" ]; then echo 'flake.nix not found at FLK_ROOT' >&2; exit 2; fi; "
        # Ensure graph exists for the CURRENT repo (temp test workspace)
        + "mkdir -p tools/buck; "
        + "rm -f tools/buck/graph.json; nix run \"$FLK_ROOT\"#zx-wrapper -- \"$FLK_ROOT/tools/buck/export-graph.ts\" --out tools/buck/graph.json; "
        # Point flake evaluation to current graph and sources
        + "export BUCK_GRAPH_JSON=\"$PWD/tools/buck/graph.json\"; "
        + "export BUCK_TEST_SRC=\"$PWD\"; "
        + "echo '[cpp_nix_test] planner_label=%s' >&2; " % raw
        + "echo '[cpp_nix_test] writing graph to' \"$BUCK_GRAPH_JSON\" >&2; "
        + "if ! grep -qF -- %s \"$BUCK_GRAPH_JSON\" 2>/dev/null; then echo '[cpp_nix_test] planner label not found in graph.json' >&2; fi; " % raw
        + "echo '[cpp_nix_test] providers in graph:' >&2; (grep -n " + '"third_party/providers"' + " \"$BUCK_GRAPH_JSON\" || true) | sed 's/^/[cpp_nix_test] graph.json: /' >&2; "
        + "echo '[cpp_nix_test] nixpkg labels in graph:' >&2; (grep -n " + '"nixpkg:"' + " \"$BUCK_GRAPH_JSON\" || true) | sed 's/^/[cpp_nix_test] graph.json: /' >&2; "
        + "echo '[cpp_nix_test] planner deps:' >&2; nix run \"$FLK_ROOT\"#zx-wrapper -- -e 'import fs from \"fs-extra\"; const p=process.argv[1]; const l=process.argv[2]; const nodes=JSON.parse(fs.readFileSync(p,\"utf8\")); const arr=Array.isArray(nodes)?nodes:Object.values(nodes); const n=arr.find(x=>x && x.name===l); console.log(`[cpp_nix_test] deps for ${l}:`, (n && n.deps)||[]);' \"$BUCK_GRAPH_JSON\" %s 2>/dev/null || true; " % raw
        + "echo '[cpp_nix_test] planner labels:' >&2; nix run \"$FLK_ROOT\"#zx-wrapper -- -e 'import fs from \"fs-extra\"; const p=process.argv[1]; const l=process.argv[2]; const nodes=JSON.parse(fs.readFileSync(p,\"utf8\")); const arr=Array.isArray(nodes)?nodes:Object.values(nodes); const n=arr.find(x=>x && x.name===l); console.log(`[cpp_nix_test] labels for ${l}:`, (n && n.labels)||[]);' \"$BUCK_GRAPH_JSON\" %s 2>/dev/null || true; " % raw
        + ("SYS=$(nix eval --raw --impure --expr builtins.currentSystem); echo '[cpp_nix_test] system='\"$SYS\" >&2; " )
        + ("echo '[cpp_nix_test] listing cppTargets keys'; nix eval --impure --json \"$FLK_ROOT\"#packages.$SYS.graph-generator-cppTargets --accept-flake-config | jq -r 'keys[]' 2>/dev/null | sed 's/^/[cpp_nix_test] key /' >&2; ")
        + ("echo '[cpp_nix_test] expecting attr %s' >&2; " % attr)
        # Build selected target via flake attr, passing BUCK_TARGET (avoids attr-key mismatch)
        + ("set +e; OUT_PATH=$(BUCK_TEST_SRC=\"$PWD\" BUCK_TARGET=\"%s\" nix build --impure -L \"$FLK_ROOT\"#graph-generator-selected --accept-flake-config --print-out-paths 2>&1 | tee /tmp/cpp_nix_test_build.log | tail -1); NIX_STATUS=$?; set -e; echo \"[cpp_nix_test] OUT_PATH=$OUT_PATH\" >&2; if [ \"$NIX_STATUS\" -ne 0 ]; then echo '[cpp_nix_test] nix build failed' >&2; cat /tmp/cpp_nix_test_build.log >&2 || true; exit $NIX_STATUS; fi; " % raw)
        + "test -n \"$OUT_PATH\" || { echo '[cpp_nix_test] nix build returned no out path' >&2; cat /tmp/cpp_nix_test_build.log >&2 || true; exit 2; }; "
        + "if [ ! -d \"$OUT_PATH/bin\" ]; then echo 'no test binary produced' >&2; exit 2; fi; "
        + ("BIN='%s'; " % expected_bin)
        + "if [ ! -x \"$OUT_PATH/bin/$BIN\" ]; then echo '[cpp_nix_test] expected bin not found: ' \"$OUT_PATH/bin/$BIN\" >&2; ls -la \"$OUT_PATH/bin\" >&2 || true; exit 2; fi; "
        + "\"$OUT_PATH/bin/$BIN\""
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


