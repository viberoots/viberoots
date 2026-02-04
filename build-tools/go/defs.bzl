load("@prelude//:rules.bzl", "go_binary", "go_library", "go_test")
load("//lang:defs_common.bzl", "normalize_labels", "prepare_language_wiring")
load("//lang:defs_common.bzl", "merge_link_intent_deps", "validate_link_closure_overrides")
load("//lang:global_inputs.bzl", "global_nix_inputs")
load("//lang:auto_map.bzl", "MODULE_PROVIDERS")
load("//lang:defs_common.bzl", "wire_package_local_planner_visible_stub")
load("//build-tools/go/private:nix_build_wasm.bzl", "go_nix_build_wasm")
load("//build-tools/go/private:cgo_wiring.bzl", "apply_go_rule_stable_defaults", "apply_go_tuple_labels", "configure_cgo_kwargs")
load("//build-tools/go/private:auto_tests.bzl", "maybe_autowire_go_binary_test", "maybe_autowire_go_library_test")


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
    go_library(name = name, deps = wiring.deps, **wiring.kwargs)

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
    go_binary(name = name, deps = wiring.deps, **wiring.kwargs)

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
    go_test(name = name, deps = wiring.deps, **wiring.kwargs)

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
    kw = dict(kwargs)
    deps = kw.pop("deps", [])
    srcs = kw.get("srcs", []) or []
    # Keep a minimal graph node with srcs so the planner can discover the package.
    # Preserve the existing behavior where provider edges are realized into `srcs`.
    wire_package_local_planner_visible_stub(
        name = name,
        out = name + ".stamp",
        kwargs = kw,
        lang = "go",
        kind = "carchive",
        deps = deps,
        srcs = srcs,
        MODULE_PROVIDERS = MODULE_PROVIDERS,
        provider_realization_mode = "inputs",
    )


def nix_go_tiny_wasm_lib(name, **kwargs):
    """
    Declare a planner-visible TinyGo Wasm target that builds a single `top.wasm` via Nix.

    Stamps language/kind labels for adapter detection and uses a thin rule that
    invokes the planner-selected build, copying `$out/lib/top.wasm` to this rule's output.
    """
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
    # Graph-facing shim that copies from the Nix out path produced by planner
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

