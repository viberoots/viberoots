load("//build-tools/lang:defs_common.bzl", "normalize_labels", "prepare_language_wiring")
load("//build-tools/lang:defs_common.bzl", "merge_link_intent_deps", "validate_link_closure_overrides")
load("//build-tools/lang:global_inputs.bzl", "global_nix_inputs")
load("//build-tools/lang:auto_map.bzl", "MODULE_PROVIDERS")
load("//build-tools/go/private:nix_build_wasm.bzl", "go_nix_build_wasm")
load("//build-tools/go/private:nix_build_carchive.bzl", "go_nix_build_carchive")
load("//build-tools/go/private:nix_build.bzl", "go_nix_build")
load("//build-tools/go/private:nix_test.bzl", "go_nix_test")
load("//build-tools/go/private:cgo_wiring.bzl", "apply_go_rule_stable_defaults", "apply_go_tuple_labels", "configure_cgo_kwargs")
load("//build-tools/go/private:auto_tests.bzl", "maybe_autowire_go_binary_test", "maybe_autowire_go_library_test")


def _apply_go_nix_rule_attrs(attrs, prepared):
    if "override_cgo_enabled" in prepared:
        attrs["override_cgo_enabled"] = prepared["override_cgo_enabled"]
    if "asan" in prepared:
        attrs["asan"] = prepared["asan"]
    if "race" in prepared:
        attrs["race"] = prepared["race"]
    if "cgo_enabled" in prepared:
        attrs["cgo_enabled"] = prepared["cgo_enabled"]

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
    # Planner-visible TinyGo Wasm target that builds a single top.wasm via Nix.
    pkg = native.package_name()
    kw = dict(kwargs)
    deps = kw.pop("deps", []) or []
    link_deps = kw.pop("link_deps", []) or []
    link_closure = kw.pop("link_closure", "direct") or "direct"
    link_closure_overrides = kw.pop("link_closure_overrides", {}) or {}
    use_selected_wasm = kw.pop("use_selected_wasm", False) or False
    extra = normalize_labels(pkg, kw.pop("extra_module_providers", []) or [])

    validate_link_closure_overrides(link_deps, link_closure_overrides)
    kw["link_deps"] = link_deps
    kw["link_closure"] = link_closure
    kw["link_closure_overrides"] = link_closure_overrides

    merged = merge_link_intent_deps(deps, link_deps, [])

    wiring = prepare_language_wiring(
        name = name,
        kwargs = kw,
        lang = "go",
        kind = None,
        MODULE_PROVIDERS = MODULE_PROVIDERS,
        deps = merged,
        wasm_variant = "tinygo",
        wasm_extra_srcs = extra,
        wasm_srcs_include_deps = True,
        wasm_provider_realization_mode = "inputs",
        wasm_strip_providers_from_deps = True,
    )
    prepared = wiring.kwargs
    go_nix_build_wasm(
        name = name,
        self_label = "//%s:%s" % (pkg, name),
        out = name + ".wasm",
        expected_rel = "lib/top.wasm",
        deps = wiring.deps,
        link_deps = prepared.get("link_deps", []) or [],
        link_closure = prepared.get("link_closure", link_closure),
        link_closure_overrides = prepared.get("link_closure_overrides", link_closure_overrides),
        use_selected_wasm = use_selected_wasm,
        srcs = prepared.get("srcs", []) or [],
        nix_inputs = global_nix_inputs(),
        labels = prepared.get("labels", []) or [],
        visibility = prepared.get("visibility", []),
    )

