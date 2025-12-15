load("//lang:defs_common.bzl", "append_nixpkg_labels", "dedupe_preserve", "normalize_labels", "realize_provider_edges")
load("//go/private:labels.bzl", "append_tuple_labels")

def apply_go_tuple_labels(kwargs):
    build_tags = kwargs.pop("build_tags", [])
    goos = kwargs.pop("goos", None)
    goarch = kwargs.pop("goarch", None)
    cgo_enabled = kwargs.pop("cgo_enabled", None)
    append_tuple_labels(kwargs, build_tags, goos, goarch, cgo_enabled)

def apply_go_rule_stable_defaults(kwargs):
    if "asan" not in kwargs:
        kwargs["asan"] = False
    if "race" not in kwargs:
        kwargs["race"] = False
    if "cgo_enabled" not in kwargs:
        kwargs["cgo_enabled"] = None

def configure_go_toolchains(kwargs):
    if "_go_toolchain" not in kwargs:
        kwargs["_go_toolchain"] = "@repo_toolchains//:go"
    if "_cxx_toolchain" not in kwargs:
        kwargs["_cxx_toolchain"] = "@repo_toolchains//:cxx"

def _srcs_imply_cgo(kwargs):
    srcs = kwargs.get("srcs", []) or []
    if not isinstance(srcs, list):
        return False
    exts = (".c", ".cc", ".cxx", ".cpp", ".m", ".mm", ".s", ".S")
    for s in srcs:
        if isinstance(s, str) and s.endswith(exts):
            return True
    return False

def _apply_cgo_labels(kwargs, nixpkg_deps, repo_cgo_deps):
    if len(nixpkg_deps) == 0 and len(repo_cgo_deps) == 0:
        return
    labels = kwargs.get("labels", []) or []
    kwargs["labels"] = dedupe_preserve(labels + ["cgo:enabled"])
    append_nixpkg_labels(kwargs, nixpkg_deps)

def configure_cgo_and_merge_deps(name, kwargs, nixpkg_deps, repo_cgo_deps, module_providers):
    deps = kwargs.pop("deps", [])
    extra = normalize_labels(native.package_name(), kwargs.pop("extra_module_providers", []))

    _apply_cgo_labels(kwargs, nixpkg_deps, repo_cgo_deps)
    configure_go_toolchains(kwargs)

    if _srcs_imply_cgo(kwargs) or len(nixpkg_deps) > 0 or len(repo_cgo_deps) > 0:
        kwargs["override_cgo_enabled"] = True

    base = deps + repo_cgo_deps + extra
    return realize_provider_edges(module_providers, name, base = base)


