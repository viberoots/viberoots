load("@prelude//:rules.bzl", "go_binary", "go_library", "go_test")
load("//lang:defs_common.bzl", "append_tuple_labels", "dedupe_preserve", "normalize_labels")
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


def nix_go_library(name, **kwargs):
    build_tags = kwargs.pop("build_tags", [])
    goos = kwargs.pop("goos", None)
    goarch = kwargs.pop("goarch", None)
    cgo_enabled = kwargs.pop("cgo_enabled", None)
    _append_tuple_labels(kwargs, build_tags, goos, goarch, cgo_enabled)
    # PR3: Stamp primary target labels for language/kind
    labels = kwargs.get("labels", []) or []
    kwargs["labels"] = dedupe_preserve(labels + ["lang:go", "kind:lib"])
    pkg = native.package_name()
    deps = kwargs.pop("deps", [])
    extra = normalize_labels(pkg, kwargs.pop("extra_module_providers", []))
    merged = dedupe_preserve(deps + _providers_for(name) + extra)
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
    build_tags = kwargs.pop("build_tags", [])
    goos = kwargs.pop("goos", None)
    goarch = kwargs.pop("goarch", None)
    cgo_enabled = kwargs.pop("cgo_enabled", None)
    _append_tuple_labels(kwargs, build_tags, goos, goarch, cgo_enabled)
    # PR3: Stamp primary target labels for language/kind
    labels = kwargs.get("labels", []) or []
    kwargs["labels"] = dedupe_preserve(labels + ["lang:go", "kind:bin"]) 
    pkg = native.package_name()
    deps = kwargs.pop("deps", [])
    extra = normalize_labels(pkg, kwargs.pop("extra_module_providers", []))
    merged = dedupe_preserve(deps + _providers_for(name) + extra)
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
    build_tags = kwargs.pop("build_tags", [])
    goos = kwargs.pop("goos", None)
    goarch = kwargs.pop("goarch", None)
    cgo_enabled = kwargs.pop("cgo_enabled", None)
    _append_tuple_labels(kwargs, build_tags, goos, goarch, cgo_enabled)
    pkg = native.package_name()
    deps = kwargs.pop("deps", [])
    extra = normalize_labels(pkg, kwargs.pop("extra_module_providers", []))
    merged = dedupe_preserve(deps + _providers_for(name) + extra)

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

