load("@prelude//:rules.bzl", "go_binary", "go_library", "go_test", "genrule")
load("//lang:defs_common.bzl", "append_tuple_labels", "dedupe_preserve", "normalize_labels", "stamp_labels", "normalize_nix_attr", "append_patch_srcs")
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


def _nixpkg_provider_for(attr):
    # Deterministic provider target name for nixpkgs attribute paths, aligned with TS helper
    norm = normalize_nix_attr(attr)
    # Replace any non-alphanumeric character with underscore for a stable provider name
    tail = "".join([c if (c.isalnum() or c == "_") else "_" for c in norm])
    # Family is "nix_" and the package tail is the entire normalized attribute (may start with pkgs_)
    return "//third_party/providers:nix_%s" % tail


def _apply_cgo_labels(kwargs, nix_cgo_deps, repo_cgo_deps):
    if len(nix_cgo_deps) > 0 or len(repo_cgo_deps) > 0:
        labels = kwargs.get("labels", []) or []
        extra = ["cgo:enabled"] + ["nixpkg:%s" % a for a in nix_cgo_deps]
        kwargs["labels"] = dedupe_preserve(labels + extra)


def _merge_cgo_deps(deps, nix_cgo_deps, repo_cgo_deps):
    out = deps
    if len(repo_cgo_deps) > 0:
        out = out + repo_cgo_deps
    return dedupe_preserve(out)


def _srcs_imply_cgo(kwargs):
    srcs = kwargs.get("srcs", []) or []
    if not isinstance(srcs, list):
        return False
    exts = (".c", ".cc", ".cxx", ".cpp", ".m", ".mm", ".s", ".S")
    for s in srcs:
        if isinstance(s, str) and s.endswith(exts):
            return True
    return False


def nix_go_library(name, **kwargs):
    local_patch_dirs = kwargs.pop("local_patch_dirs", ["patches/go"])  # per-target local patch directories
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
    # Transparent CGO: auto-enable when C-family sources or cgo deps are present
    if _srcs_imply_cgo(kwargs) or len(nix_cgo_deps) > 0 or len(repo_cgo_deps) > 0:
        # Prefer override so the target is hermetic regardless of inherited platform
        kwargs["override_cgo_enabled"] = True
    # Include local patch files in srcs so Buck invalidates precisely on patch changes
    append_patch_srcs(kwargs, local_patch_dirs)
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
    local_patch_dirs = kwargs.pop("local_patch_dirs", ["patches/go"])  # per-target local patch directories
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
    # Ensure stable defaults that don't depend on unspecified platform selects
    if "asan" not in kwargs:
        kwargs["asan"] = False
    if "race" not in kwargs:
        kwargs["race"] = False
    if "cgo_enabled" not in kwargs:
        kwargs["cgo_enabled"] = None
    # Transparent CGO: auto-enable when C-family sources or cgo deps are present
    if _srcs_imply_cgo(kwargs) or len(nix_cgo_deps) > 0 or len(repo_cgo_deps) > 0:
        kwargs["override_cgo_enabled"] = True
    # Include local patch files in srcs so Buck invalidates precisely on patch changes
    append_patch_srcs(kwargs, local_patch_dirs)
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

    if "asan" not in kwargs:
        kwargs["asan"] = False
    if "race" not in kwargs:
        kwargs["race"] = False
    if "cgo_enabled" not in kwargs:
        kwargs["cgo_enabled"] = None
    if "_go_toolchain" not in kwargs:
        kwargs["_go_toolchain"] = "@repo_toolchains//:go"
    if "_cxx_toolchain" not in kwargs:
        kwargs["_cxx_toolchain"] = "@repo_toolchains//:cxx"
    # Transparent CGO: if test itself declares cgo deps or includes C-family sources, enable it.
    # Note: if testing a cgo library via `library=":lib"`, cgo will be picked up by the library build.
    if _srcs_imply_cgo(kwargs) or len(nix_cgo_deps) > 0 or len(repo_cgo_deps) > 0:
        kwargs["override_cgo_enabled"] = True
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
    # Keep a minimal graph node with srcs so planner can find package dir.
    # Realize edges to provider nodes by merging them into srcs; genrule does not
    # accept a `deps` parameter in Buck2.
    srcs = kwargs.get("srcs", []) or []
    merged_srcs = dedupe_preserve(srcs + deps + _providers_for(name))
    genrule(
        name = name,
        srcs = merged_srcs,
        out = name + ".stamp",
        cmd = "echo go_carchive > $OUT",
        labels = labels,
        visibility = kwargs.get("visibility", []),
    )

