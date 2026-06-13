load("@viberoots//build-tools/lang:defs_common.bzl", "normalize_labels", "prepare_language_wiring")
load("@viberoots//build-tools/lang:global_inputs.bzl", "global_nix_inputs")
load("@workspace_providers//:auto_map.bzl", "MODULE_PROVIDERS")
load("@viberoots//build-tools/go/private:nix_build_carchive.bzl", "go_nix_build_carchive")
load("@viberoots//build-tools/go/private:nix_build.bzl", "go_nix_build")
load("@viberoots//build-tools/go/private:nix_test.bzl", "go_nix_test")
load("@viberoots//build-tools/go/private:cgo_wiring.bzl", "apply_go_rule_stable_defaults", "apply_go_tuple_labels", "configure_cgo_kwargs")
load("@viberoots//build-tools/go/private:auto_tests.bzl", "maybe_autowire_go_binary_test", "maybe_autowire_go_library_test")
load("@viberoots//build-tools/go:defs_wasm.bzl", _nix_go_tiny_wasm_lib = "nix_go_tiny_wasm_lib")


def _apply_go_nix_rule_attrs(attrs, prepared):
    if "override_cgo_enabled" in prepared:
        attrs["override_cgo_enabled"] = prepared["override_cgo_enabled"]
    if "asan" in prepared:
        attrs["asan"] = prepared["asan"]
    if "race" in prepared:
        attrs["race"] = prepared["race"]
    if "cgo_enabled" in prepared:
        attrs["cgo_enabled"] = prepared["cgo_enabled"]
    if "remote_execution" in prepared:
        attrs["remote_execution"] = prepared["remote_execution"]

def nix_go_library(name, **kwargs):
    kw = dict(kwargs)
    repo_cgo_deps = kw.pop("repo_cgo_deps", [])
    nix_cgo_pkgconfig = kw.pop("nix_cgo_pkgconfig", {})
    if isinstance(nix_cgo_pkgconfig, dict) and len(nix_cgo_pkgconfig) > 0:
        fail(
            "nix_go_library: nix_cgo_pkgconfig is currently unsupported; it was previously ignored. "
            + "Remove it so importer/package wiring stays deterministic."
        )
    deps = kw.pop("deps", [])
    extra = normalize_labels(native.package_name(), kw.pop("extra_module_providers", []))
    apply_go_tuple_labels(kw)
    wiring = prepare_language_wiring(
        name = name,
        kwargs = kw,
        lang = "go",
        kind = "lib",
        MODULE_PROVIDERS = MODULE_PROVIDERS,
        deps = deps + repo_cgo_deps + extra,
    )
    configure_cgo_kwargs(wiring.kwargs, wiring.nixpkg_deps, repo_cgo_deps)
    prepared = wiring.kwargs
    nix_inputs = global_nix_inputs()
    attrs = {
        "name": name,
        "out": name + ".stamp",
        "kind": "lib",
        "self_label": "//%s:%s" % (native.package_name(), name),
        "deps": wiring.deps,
        "srcs": prepared.get("srcs", []) or [],
        "labels": prepared.get("labels", []) or [],
        "nix_inputs": nix_inputs,
        "visibility": prepared.get("visibility", []),
    }
    _apply_go_nix_rule_attrs(attrs, prepared)
    go_nix_build(**attrs)

    maybe_autowire_go_library_test(nix_go_test = nix_go_test, name = name)
def nix_go_binary(name, **kwargs):
    orig = dict(kwargs)
    kw = dict(kwargs)
    repo_cgo_deps = kw.pop("repo_cgo_deps", [])
    nix_cgo_pkgconfig = kw.pop("nix_cgo_pkgconfig", {})
    if isinstance(nix_cgo_pkgconfig, dict) and len(nix_cgo_pkgconfig) > 0:
        fail(
            "nix_go_binary: nix_cgo_pkgconfig is currently unsupported; it was previously ignored. "
            + "Remove it so importer/package wiring stays deterministic."
        )
    deps = kw.pop("deps", [])
    extra = normalize_labels(native.package_name(), kw.pop("extra_module_providers", []))
    apply_go_tuple_labels(kw)
    wiring = prepare_language_wiring(
        name = name,
        kwargs = kw,
        lang = "go",
        kind = "bin",
        MODULE_PROVIDERS = MODULE_PROVIDERS,
        deps = deps + repo_cgo_deps + extra,
    )
    configure_cgo_kwargs(wiring.kwargs, wiring.nixpkg_deps, repo_cgo_deps)
    apply_go_rule_stable_defaults(wiring.kwargs)
    prepared = wiring.kwargs
    nix_inputs = global_nix_inputs()
    attrs = {
        "name": name,
        "out": name,
        "kind": "bin",
        "self_label": "//%s:%s" % (native.package_name(), name),
        "deps": wiring.deps,
        "srcs": prepared.get("srcs", []) or [],
        "labels": prepared.get("labels", []) or [],
        "nix_inputs": nix_inputs,
        "visibility": prepared.get("visibility", []),
    }
    _apply_go_nix_rule_attrs(attrs, prepared)
    go_nix_build(**attrs)

    maybe_autowire_go_binary_test(
        nix_go_library = nix_go_library,
        nix_go_test = nix_go_test,
        name = name,
        base_deps = orig.get("deps", []) or [],
        extra_module_providers = orig.get("extra_module_providers", []) or [],
        build_tags = orig.get("build_tags", []) or [],
        goos = orig.get("goos", None),
        goarch = orig.get("goarch", None),
        cgo_enabled = orig.get("cgo_enabled", None),
        nixpkg_deps = wiring.nixpkg_deps,
        repo_cgo_deps = repo_cgo_deps,
        local_patch_dirs = wiring.local_patch_dirs,
    )
def nix_go_test(name, **kwargs):
    kw = dict(kwargs)
    repo_cgo_deps = kw.pop("repo_cgo_deps", [])
    nix_cgo_pkgconfig = kw.pop("nix_cgo_pkgconfig", {})
    if isinstance(nix_cgo_pkgconfig, dict) and len(nix_cgo_pkgconfig) > 0:
        fail(
            "nix_go_test: nix_cgo_pkgconfig is currently unsupported; it was previously ignored. "
            + "Remove it so importer/package wiring stays deterministic."
        )
    deps = kw.pop("deps", [])
    extra = normalize_labels(native.package_name(), kw.pop("extra_module_providers", []))
    lib = kw.get("library")
    abs_lib = None
    if isinstance(lib, str) and lib:
        abs_lib = lib
        if lib.startswith(":"):
            abs_lib = "//%s:%s" % (native.package_name(), lib[1:])
    base_deps = deps + repo_cgo_deps + extra
    if abs_lib != None:
        base_deps = [d for d in base_deps if d not in (lib, abs_lib)]
    apply_go_tuple_labels(kw)
    wiring = prepare_language_wiring(
        name = name,
        kwargs = kw,
        lang = "go",
        kind = "test",
        MODULE_PROVIDERS = MODULE_PROVIDERS,
        deps = base_deps,
    )
    configure_cgo_kwargs(wiring.kwargs, wiring.nixpkg_deps, repo_cgo_deps)
    apply_go_rule_stable_defaults(wiring.kwargs)
    prepared = wiring.kwargs
    nix_inputs = global_nix_inputs()
    attrs = {
        "name": name,
        "out": name + ".stamp",
        "self_label": "//%s:%s" % (native.package_name(), name),
        "deps": wiring.deps,
        "srcs": prepared.get("srcs", []) or [],
        "labels": prepared.get("labels", []) or [],
        "test_rule_timeout_ms": 30 * 60 * 1000,
        "nix_inputs": nix_inputs,
        "visibility": prepared.get("visibility", []),
    }
    if "library" in prepared:
        attrs["library"] = prepared["library"]
    _apply_go_nix_rule_attrs(attrs, prepared)
    go_nix_test(**attrs)

def nix_go_carchive(name, **kwargs):
    # Declare a Go target that builds a C archive via the Nix planner.
    kw = dict(kwargs)
    repo_cgo_deps = kw.pop("repo_cgo_deps", [])
    nix_cgo_pkgconfig = kw.pop("nix_cgo_pkgconfig", {})
    if isinstance(nix_cgo_pkgconfig, dict) and len(nix_cgo_pkgconfig) > 0:
        fail(
            "nix_go_carchive: nix_cgo_pkgconfig is currently unsupported; it was previously ignored. "
            + "Remove it so importer/package wiring stays deterministic."
        )
    deps = kw.pop("deps", [])
    extra = normalize_labels(native.package_name(), kw.pop("extra_module_providers", []))
    apply_go_tuple_labels(kw)
    wiring = prepare_language_wiring(
        name = name,
        kwargs = kw,
        lang = "go",
        kind = "carchive",
        MODULE_PROVIDERS = MODULE_PROVIDERS,
        deps = deps + repo_cgo_deps + extra,
    )
    configure_cgo_kwargs(wiring.kwargs, wiring.nixpkg_deps, repo_cgo_deps)
    prepared = wiring.kwargs
    nix_inputs = global_nix_inputs()
    attrs = {
        "name": name,
        "out": name + ".carchive",
        "self_label": "//%s:%s" % (native.package_name(), name),
        "deps": wiring.deps,
        "srcs": prepared.get("srcs", []) or [],
        "labels": prepared.get("labels", []) or [],
        "nix_inputs": nix_inputs,
        "visibility": prepared.get("visibility", []),
    }
    _apply_go_nix_rule_attrs(attrs, prepared)
    go_nix_build_carchive(**attrs)

def nix_go_tiny_wasm_lib(name, **kwargs):
    _nix_go_tiny_wasm_lib(name = name, **kwargs)
