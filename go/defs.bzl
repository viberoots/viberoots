load("@prelude//:rules.bzl", "go_binary", "go_library", "go_test")
load("//lang:defs_common.bzl", "dedupe_preserve", "normalize_labels", "prepare_package_local_wiring", "stamp_wasm_variant")
load("//lang:planner_stub.bzl", "planner_stub", "planner_stub_with_package_local_patches")
load("//lang:global_inputs.bzl", "global_nix_inputs")
load("//lang:auto_map.bzl", "MODULE_PROVIDERS")
load("//lang:defs_common.bzl", "wire_planner_visible_inputs", "wire_planner_visible_stub")
load("//go/private:nix_build_wasm.bzl", "go_nix_build_wasm")
load("//go/private:cgo_wiring.bzl", "apply_go_rule_stable_defaults", "apply_go_tuple_labels", "configure_cgo_kwargs")


def nix_go_library(name, **kwargs):
    repo_cgo_deps = kwargs.pop("repo_cgo_deps", [])
    nix_cgo_pkgconfig = kwargs.pop("nix_cgo_pkgconfig", {})
    deps = kwargs.pop("deps", [])
    extra = normalize_labels(native.package_name(), kwargs.pop("extra_module_providers", []))
    apply_go_tuple_labels(kwargs)
    wiring = prepare_package_local_wiring(
        name = name,
        kwargs = kwargs,
        lang = "go",
        kind = "lib",
        MODULE_PROVIDERS = MODULE_PROVIDERS,
        base_deps = deps + repo_cgo_deps + extra,
    )
    configure_cgo_kwargs(kwargs, wiring.nixpkg_deps, repo_cgo_deps)
    go_library(name = name, deps = wiring.deps, **kwargs)

    # Auto-wire a go_test target if *_test.go files exist alongside the library.
    # This keeps scaffolds simple: adding a test file is enough; no TARGETS edits.
    # We mirror the scaffolded pattern: tests live under pkg/** for libs.
    tests = native.glob(["pkg/**/*_test.go"]) or []
    if len(tests) > 0:
        # Bind tests to the library to include sources in compilation.
        nix_go_test(
            name = name + "_test",
            library = ":%s" % name,
            srcs = tests,
        )


def nix_go_binary(name, **kwargs):
    # Preserve key macro inputs for any auto-wired helper targets we synthesize below.
    # (The helpers we call will `pop(...)` from kwargs, so capture first.)
    base_deps = kwargs.get("deps", []) or []
    extra_module_providers = kwargs.get("extra_module_providers", []) or []
    build_tags = kwargs.get("build_tags", []) or []
    goos = kwargs.get("goos", None)
    goarch = kwargs.get("goarch", None)
    cgo_enabled = kwargs.get("cgo_enabled", None)
    repo_cgo_deps = kwargs.pop("repo_cgo_deps", [])
    nix_cgo_pkgconfig = kwargs.pop("nix_cgo_pkgconfig", {})
    apply_go_tuple_labels(kwargs)
    deps = kwargs.pop("deps", [])
    extra = normalize_labels(native.package_name(), kwargs.pop("extra_module_providers", []))
    wiring = prepare_package_local_wiring(
        name = name,
        kwargs = kwargs,
        lang = "go",
        kind = "bin",
        MODULE_PROVIDERS = MODULE_PROVIDERS,
        base_deps = deps + repo_cgo_deps + extra,
    )
    configure_cgo_kwargs(kwargs, wiring.nixpkg_deps, repo_cgo_deps)
    apply_go_rule_stable_defaults(kwargs)
    go_binary(name = name, deps = wiring.deps, **kwargs)

    # Auto-wire a go_test target for binaries if *_test.go exists under cmd/<name>/**
    # This allows CLI packages to have local tests with no TARGETS edits.
    tests = native.glob(["cmd/%s/**/*_test.go" % name]) or []
    if len(tests) > 0:
        # Synthesize a package library for tests; binaries don't expose GoTestInfo
        pkg_srcs = native.glob(["cmd/%s/**/*.go" % name], exclude=["**/*_test.go"]) or []
        if len(pkg_srcs) == 0:
            pkg_srcs = native.glob(["cmd/**/*.go"], exclude=["**/*_test.go"]) or []
        nix_go_library(
            name = name + "_pkg",
            srcs = pkg_srcs,
            deps = base_deps,
            extra_module_providers = extra_module_providers,
            build_tags = build_tags,
            goos = goos,
            goarch = goarch,
            cgo_enabled = cgo_enabled,
            nixpkg_deps = wiring.nixpkg_deps,
            repo_cgo_deps = repo_cgo_deps,
            local_patch_dirs = wiring.local_patch_dirs,
            visibility = ["PUBLIC"],
        )
        nix_go_test(
            name = name + "_test",
            library = ":%s" % (name + "_pkg"),
            srcs = tests,
        )


def nix_go_test(name, **kwargs):
    repo_cgo_deps = kwargs.pop("repo_cgo_deps", [])
    nix_cgo_pkgconfig = kwargs.pop("nix_cgo_pkgconfig", {})
    deps = kwargs.pop("deps", [])
    extra = normalize_labels(native.package_name(), kwargs.pop("extra_module_providers", []))
    apply_go_tuple_labels(kwargs)
    wiring = prepare_package_local_wiring(
        name = name,
        kwargs = kwargs,
        lang = "go",
        kind = "test",
        MODULE_PROVIDERS = MODULE_PROVIDERS,
        base_deps = deps + repo_cgo_deps + extra,
    )
    configure_cgo_kwargs(kwargs, wiring.nixpkg_deps, repo_cgo_deps)

    # If a library is provided, ensure we don't pass the same target in deps.
    pkg = native.package_name()
    lib = kwargs.get("library")
    if isinstance(lib, str) and lib:
        abs_lib = lib
        if lib.startswith(":"):
            abs_lib = "//%s:%s" % (pkg, lib[1:])
        deps_out = [d for d in wiring.deps if d not in (lib, abs_lib)]
    else:
        deps_out = wiring.deps

    apply_go_rule_stable_defaults(kwargs)
    go_test(name = name, deps = deps_out, **kwargs)

# Third-party shim: expose vendor-provided sources as a go_library while
# allowing an explicit import path via package map flags


def nix_go_carchive(name, **kwargs):
    """
    Declare a planner-visible Go target that builds as a C archive via Nix.

    This macro stamps labels so the exporter/planner can route the target to
    the goCArchive Nix template. It creates a small genrule to appear in the
    Buck graph; the actual archive is produced by the Nix planner build when
    a consumer (e.g., a C++ binary) is built.
    """
    wiring = prepare_package_local_wiring(
        name = name,
        kwargs = kwargs,
        lang = "go",
        kind = None,
        MODULE_PROVIDERS = MODULE_PROVIDERS,
        base_deps = [],
        stamp = False,
    )
    # Stamp language/kind labels for planner detection
    labels = kwargs.get("labels", []) or []
    labels = dedupe_preserve(labels + ["lang:go", "kind:carchive"])
    deps = kwargs.pop("deps", [])
    # Keep a minimal graph node with srcs so the planner can discover the package.
    # Preserve the existing behavior where provider edges are realized into `srcs`.
    srcs = kwargs.get("srcs", []) or []
    wire_planner_visible_stub(
        name = name,
        out = name + ".stamp",
        lang = "go",
        local_patch_dirs = wiring.local_patch_dirs,
        deps = deps,
        srcs = srcs,
        labels = labels,
        visibility = kwargs.get("visibility", []),
        MODULE_PROVIDERS = MODULE_PROVIDERS,
        realize_providers_into = "srcs",
    )


def nix_go_tiny_wasm_lib(name, **kwargs):
    """
    Declare a planner-visible TinyGo Wasm target that builds a single `top.wasm` via Nix.

    Stamps language/kind labels for adapter detection and uses a thin rule that
    invokes the planner-selected build, copying `$out/lib/top.wasm` to this rule's output.
    """
    # Uniform WASM labeling across languages (variant=tinygo)
    stamp_wasm_variant(kwargs, "go", "tinygo")
    labels = kwargs.get("labels", []) or []
    pkg = native.package_name()
    deps = kwargs.pop("deps", [])
    srcs = kwargs.get("srcs", []) or []
    extra = normalize_labels(pkg, kwargs.pop("extra_module_providers", []))
    merged_srcs = wire_planner_visible_inputs(
        name = name,
        MODULE_PROVIDERS = MODULE_PROVIDERS,
        deps = deps,
        srcs = srcs,
        extra_srcs = extra,
        srcs_include_deps = True,
        realize_providers_into = "srcs",
    )["srcs"]
    # Graph-facing shim that copies from the Nix out path produced by planner
    go_nix_build_wasm(
        name = name,
        self_label = "//%s:%s" % (pkg, name),
        out = name + ".wasm",
        expected_rel = "lib/top.wasm",
        srcs = merged_srcs,
        nix_inputs = global_nix_inputs(),
        labels = labels,
        visibility = kwargs.get("visibility", []),
    )

