load("@prelude//:rules.bzl", "go_binary", "go_library", "go_test")
load("//lang:defs_common.bzl", "dedupe_preserve", "normalize_labels", "stamp_labels", "include_package_local_patches", "realize_provider_edges")
load("//lang:defs_common.bzl", "default_package_patch_dirs")
load("//lang:defs_common.bzl", "stamp_wasm_variant")
load("//lang:planner_stub.bzl", "planner_stub", "planner_stub_with_package_local_patches")
load("//lang:global_inputs.bzl", "global_nix_inputs")
load("//third_party/providers:auto_map.bzl", "MODULE_PROVIDERS")
load("//go/private:nix_build_wasm.bzl", "go_nix_build_wasm")
load("//go/private:cgo_wiring.bzl", "apply_go_rule_stable_defaults", "apply_go_tuple_labels", "configure_cgo_and_merge_deps")


def nix_go_library(name, **kwargs):
    local_patch_dirs = kwargs.pop("local_patch_dirs", default_package_patch_dirs("go"))  # per-target local patch directories
    if "nix_cgo_deps" in kwargs:
        fail("nix_cgo_deps is no longer supported; use nixpkg_deps instead")
    nixpkg_deps = kwargs.pop("nixpkg_deps", [])
    repo_cgo_deps = kwargs.pop("repo_cgo_deps", [])
    nix_cgo_pkgconfig = kwargs.pop("nix_cgo_pkgconfig", {})
    apply_go_tuple_labels(kwargs)
    # PR3/PR25: Stamp primary target labels for language/kind via helper
    stamp_labels(kwargs, "go", "lib")
    merged = configure_cgo_and_merge_deps(name, kwargs, nixpkg_deps, repo_cgo_deps, MODULE_PROVIDERS)
    # Include local patch files in srcs so Buck invalidates precisely on patch changes
    include_package_local_patches(kwargs, "go", local_patch_dirs)
    go_library(name = name, deps = merged, **kwargs)

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
            labels = ["lang:go", "kind:test"],
        )


def nix_go_binary(name, **kwargs):
    local_patch_dirs = kwargs.pop("local_patch_dirs", default_package_patch_dirs("go"))  # per-target local patch directories
    if "nix_cgo_deps" in kwargs:
        fail("nix_cgo_deps is no longer supported; use nixpkg_deps instead")
    nixpkg_deps = kwargs.pop("nixpkg_deps", [])
    repo_cgo_deps = kwargs.pop("repo_cgo_deps", [])
    nix_cgo_pkgconfig = kwargs.pop("nix_cgo_pkgconfig", {})
    apply_go_tuple_labels(kwargs)
    # PR3/PR25: Stamp primary target labels for language/kind via helper
    stamp_labels(kwargs, "go", "bin")
    merged = configure_cgo_and_merge_deps(name, kwargs, nixpkg_deps, repo_cgo_deps, MODULE_PROVIDERS)
    apply_go_rule_stable_defaults(kwargs)
    # Include local patch files in srcs so Buck invalidates precisely on patch changes
    include_package_local_patches(kwargs, "go", local_patch_dirs)
    go_binary(name = name, deps = merged, **kwargs)

    # Auto-wire a go_test target for binaries if *_test.go exists under cmd/<name>/**
    # This allows CLI packages to have local tests with no TARGETS edits.
    tests = native.glob(["cmd/%s/**/*_test.go" % name]) or []
    if len(tests) > 0:
        # Synthesize a package library for tests; binaries don't expose GoTestInfo
        pkg_srcs = native.glob(["cmd/%s/**/*.go" % name], exclude=["**/*_test.go"]) or []
        if len(pkg_srcs) == 0:
            pkg_srcs = native.glob(["cmd/**/*.go"], exclude=["**/*_test.go"]) or []
        go_library(
            name = name + "_pkg",
            srcs = pkg_srcs,
            _go_toolchain = "@repo_toolchains//:go",
            _cxx_toolchain = "@repo_toolchains//:cxx",
            labels = ["lang:go", "kind:lib"],
            visibility = ["PUBLIC"],
        )
        nix_go_test(
            name = name + "_test",
            library = ":%s" % (name + "_pkg"),
            srcs = tests,
            labels = ["lang:go", "kind:test"],
        )


def nix_go_test(name, **kwargs):
    if "nix_cgo_deps" in kwargs:
        fail("nix_cgo_deps is no longer supported; use nixpkg_deps instead")
    nixpkg_deps = kwargs.pop("nixpkg_deps", [])
    repo_cgo_deps = kwargs.pop("repo_cgo_deps", [])
    nix_cgo_pkgconfig = kwargs.pop("nix_cgo_pkgconfig", {})
    apply_go_tuple_labels(kwargs)
    merged = configure_cgo_and_merge_deps(name, kwargs, nixpkg_deps, repo_cgo_deps, MODULE_PROVIDERS)

    # If a library is provided, ensure we don't pass the same target in deps.
    pkg = native.package_name()
    lib = kwargs.get("library")
    if isinstance(lib, str) and lib:
        abs_lib = lib
        if lib.startswith(":"):
            abs_lib = "//%s:%s" % (pkg, lib[1:])
        merged = [d for d in merged if d not in (lib, abs_lib)]

    apply_go_rule_stable_defaults(kwargs)
    go_test(name = name, deps = merged, **kwargs)

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
    local_patch_dirs = kwargs.pop("local_patch_dirs", default_package_patch_dirs("go"))
    # Stamp language/kind labels for planner detection
    labels = kwargs.get("labels", []) or []
    labels = dedupe_preserve(labels + ["lang:go", "kind:carchive"])
    deps = kwargs.pop("deps", [])
    # Keep a minimal graph node with srcs so the planner can discover the package.
    # Preserve the existing behavior where provider edges are realized into `srcs`.
    srcs = kwargs.get("srcs", []) or []
    merged_srcs = realize_provider_edges(MODULE_PROVIDERS, name, into = "srcs", base = srcs)
    planner_stub_with_package_local_patches(
        name = name,
        out = name + ".stamp",
        lang = "go",
        local_patch_dirs = local_patch_dirs,
        deps = deps,
        srcs = merged_srcs,
        labels = labels,
        visibility = kwargs.get("visibility", []),
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
    merged_srcs = realize_provider_edges(MODULE_PROVIDERS, name, into = "srcs", base = (srcs + deps + extra))
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

