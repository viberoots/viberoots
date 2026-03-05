load("//build-tools/lang:defs_common.bzl", "merge_link_intent_deps", "normalize_labels", "prepare_language_wiring", "validate_link_closure_overrides")
load("//build-tools/lang:global_inputs.bzl", "global_nix_inputs")
load("//build-tools/lang:auto_map.bzl", "MODULE_PROVIDERS")
load("//build-tools/lang:module_surface.bzl", "module_surface")
load("//build-tools/go/private:nix_build_wasm.bzl", "go_nix_build_wasm")

def nix_go_tiny_wasm_lib(name, **kwargs):
    pkg = native.package_name()
    kw = dict(kwargs)
    go_source_roots = kw.pop("go_source_roots", ["."])
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
    module_surface(
        name = name + "__surface",
        module_kind = "wasm",
        source_roots = go_source_roots,
        artifact_mapping_policy = "go-tiny-wasm-v1",
        watch_hints = go_source_roots,
        visibility = ["PUBLIC"],
    )
