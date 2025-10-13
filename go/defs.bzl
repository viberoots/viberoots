load("@prelude//:rules.bzl", "go_binary", "go_library", "go_test", "genrule")
load("//lang:defs_common.bzl", "append_tuple_labels", "dedupe_preserve", "normalize_labels", "stamp_labels")
load("//third_party/providers:auto_map.bzl", "MODULE_PROVIDERS")

def _providers_for(name):
    pkg = native.package_name()
    key = "//%s:%s" % (pkg, name)
    # PR3: Do not translate to third_party/go targets. Providers are used for invalidation only.
    labels = MODULE_PROVIDERS.get(key, [])
    out = []
    for l in labels:
        if isinstance(l, str):
            out.append(l)
    return out


def _append_tuple_labels(kwargs, build_tags, goos, goarch, cgo_enabled):
    append_tuple_labels(kwargs, build_tags, goos, goarch, cgo_enabled)


def _normalize_nix_attr(attr):
    # Canonical normalization for nixpkgs attribute paths to mirror tools/lib/providers.ts
    # - trim, lower-case
    # - ensure "pkgs." prefix
    # - map historical alias pkgs.gtest -> pkgs.googletest
    if not isinstance(attr, str):
        fail("nix_cgo_deps entries must be non-empty strings like 'pkgs.zlib'")
    s = attr.strip().lower()
    if s == "":
        fail("nix_cgo_deps entries must be non-empty strings like 'pkgs.zlib'")
    if not s.startswith("pkgs."):
        s = "pkgs." + s
    if s == "pkgs.gtest":
        s = "pkgs.googletest"
    return s


def _nixpkg_provider_for(attr):
    # Deterministic provider target name for nixpkgs attribute paths, aligned with TS helper
    norm = _normalize_nix_attr(attr)
    # Replace any non-alphanumeric character with underscore for a stable provider name
    tail = "".join([c if (c.isalnum() or c == "_") else "_" for c in norm])
    return "//third_party/providers:nix_pkgs_%s" % tail


def _apply_cgo_labels(kwargs, nix_cgo_deps, repo_cgo_deps):
    if len(nix_cgo_deps) > 0 or len(repo_cgo_deps) > 0:
        labels = kwargs.get("labels", []) or []
        extra = ["cgo:enabled"] + ["nixpkg:%s" % a for a in nix_cgo_deps]
        kwargs["labels"] = dedupe_preserve(labels + extra)


def _merge_cgo_deps(deps, nix_cgo_deps, repo_cgo_deps):
    out = deps
    if len(nix_cgo_deps) > 0:
        provs = [_nixpkg_provider_for(a) for a in nix_cgo_deps]
        out = out + provs
    if len(repo_cgo_deps) > 0:
        out = out + repo_cgo_deps
    return dedupe_preserve(out)


def nix_go_library(name, **kwargs):
    nix_cgo_deps = kwargs.pop("nix_cgo_deps", [])
    repo_cgo_deps = kwargs.pop("repo_cgo_deps", [])
    nix_cgo_pkgconfig = kwargs.pop("nix_cgo_pkgconfig", {})
    build_tags = kwargs.pop("build_tags", [])
    goos = kwargs.pop("goos", None)
    goarch = kwargs.pop("goarch", None)
    cgo_enabled = kwargs.pop("cgo_enabled", None)
    _append_tuple_labels(kwargs, build_tags, goos, goarch, cgo_enabled)
    # PR3/PR25: Stamp primary target labels for language/kind via helper
    stamp_labels(kwargs, "go", "lib")
    pkg = native.package_name()
    deps = kwargs.pop("deps", [])
    _apply_cgo_labels(kwargs, nix_cgo_deps, repo_cgo_deps)
    extra = normalize_labels(pkg, kwargs.pop("extra_module_providers", []))
    merged = dedupe_preserve(_merge_cgo_deps(deps, nix_cgo_deps, repo_cgo_deps) + _providers_for(name) + extra)
    # Forward importpath to underlying rule if present; Buck's go_library understands it
    if "_go_toolchain" not in kwargs:
        kwargs["_go_toolchain"] = "@repo_toolchains//:go"
    if "_cxx_toolchain" not in kwargs:
        kwargs["_cxx_toolchain"] = "@repo_toolchains//:cxx"
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
    nix_cgo_deps = kwargs.pop("nix_cgo_deps", [])
    repo_cgo_deps = kwargs.pop("repo_cgo_deps", [])
    nix_cgo_pkgconfig = kwargs.pop("nix_cgo_pkgconfig", {})
    build_tags = kwargs.pop("build_tags", [])
    goos = kwargs.pop("goos", None)
    goarch = kwargs.pop("goarch", None)
    cgo_enabled = kwargs.pop("cgo_enabled", None)
    _append_tuple_labels(kwargs, build_tags, goos, goarch, cgo_enabled)
    # PR3/PR25: Stamp primary target labels for language/kind via helper
    stamp_labels(kwargs, "go", "bin")
    pkg = native.package_name()
    deps = kwargs.pop("deps", [])
    _apply_cgo_labels(kwargs, nix_cgo_deps, repo_cgo_deps)
    extra = normalize_labels(pkg, kwargs.pop("extra_module_providers", []))
    merged = dedupe_preserve(_merge_cgo_deps(deps, nix_cgo_deps, repo_cgo_deps) + _providers_for(name) + extra)
    if "_go_toolchain" not in kwargs:
        kwargs["_go_toolchain"] = "@repo_toolchains//:go"
    if "_cxx_toolchain" not in kwargs:
        kwargs["_cxx_toolchain"] = "@repo_toolchains//:cxx"
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
    nix_cgo_deps = kwargs.pop("nix_cgo_deps", [])
    repo_cgo_deps = kwargs.pop("repo_cgo_deps", [])
    nix_cgo_pkgconfig = kwargs.pop("nix_cgo_pkgconfig", {})
    build_tags = kwargs.pop("build_tags", [])
    goos = kwargs.pop("goos", None)
    goarch = kwargs.pop("goarch", None)
    cgo_enabled = kwargs.pop("cgo_enabled", None)
    _append_tuple_labels(kwargs, build_tags, goos, goarch, cgo_enabled)
    pkg = native.package_name()
    deps = kwargs.pop("deps", [])
    extra = normalize_labels(pkg, kwargs.pop("extra_module_providers", []))
    _apply_cgo_labels(kwargs, nix_cgo_deps, repo_cgo_deps)
    merged = dedupe_preserve(_merge_cgo_deps(deps, nix_cgo_deps, repo_cgo_deps) + _providers_for(name) + extra)

    # If a library is provided, ensure we don't pass the same target in deps.
    lib = kwargs.get("library")
    if isinstance(lib, str) and lib:
        abs_lib = lib
        if lib.startswith(":"):
            abs_lib = "//%s:%s" % (pkg, lib[1:])
        merged = [d for d in merged if d not in (lib, abs_lib)]

    if "_go_toolchain" not in kwargs:
        kwargs["_go_toolchain"] = "@repo_toolchains//:go"
    if "_cxx_toolchain" not in kwargs:
        kwargs["_cxx_toolchain"] = "@repo_toolchains//:cxx"
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
    # Stamp language/kind labels for planner detection
    labels = kwargs.get("labels", []) or []
    labels = dedupe_preserve(labels + ["lang:go", "kind:carchive"])
    deps = kwargs.pop("deps", [])
    # Keep a minimal graph node with srcs so planner can find package dir
    srcs = kwargs.get("srcs", []) or []
    genrule(
        name = name,
        srcs = srcs,
        out = name + ".stamp",
        cmd = "echo go_carchive > $OUT",
        labels = labels,
        deps = deps + _providers_for(name),
        visibility = kwargs.get("visibility", []),
    )

