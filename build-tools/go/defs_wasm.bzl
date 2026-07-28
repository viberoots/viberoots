load("@viberoots//build-tools/lang:defs_common.bzl", "merge_link_intent_deps", "normalize_labels", "prepare_language_wiring", "validate_link_closure_overrides")
load("@viberoots//build-tools/lang:global_inputs.bzl", "global_nix_inputs")
load("@workspace_providers//:auto_map.bzl", "MODULE_PROVIDERS")
load("@viberoots//build-tools/lang:module_surface.bzl", "module_surface")
load("@viberoots//build-tools/go/private:nix_build_wasm.bzl", "go_nix_build_wasm")

def _tiny_wasm(name, static, kwargs):
    pkg = native.package_name()
    kw = dict(kwargs)
    go_source_roots = kw.pop("go_source_roots", ["."])
    declared_wasm_abi = kw.pop("wasm_abi", None)
    wasm_abi = declared_wasm_abi or "bare"
    if wasm_abi not in ["bare", "wasi"]:
        fail("TinyGo WASM ABI must be bare or wasi")
    if static and wasm_abi == "wasi":
        fail("nix_go_tiny_wasm_static_lib: WASI static archives are unsupported because TinyGo and final WASI runtimes both own allocator symbols")
    wasm_header = kw.pop("wasm_header", None)
    if static and (not isinstance(wasm_header, str) or wasm_header == "" or wasm_header.startswith("/") or wasm_header.startswith("//") or wasm_header.startswith("@") or ".." in wasm_header.split("/")):
        fail("nix_go_tiny_wasm_static_lib requires a package-local wasm_header")
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
    target = "wasm32-wasip1" if wasm_abi == "wasi" else "wasm32-unknown-unknown"
    link_kind = "static" if static else "module"
    kw["labels"] = (kw.get("labels", []) or []) + [
        "kind:wasm",
        "wasm:%s" % link_kind,
        "wasm_abi:%s" % wasm_abi,
        "wasm_target:%s" % target,
    ] + (["wasm:wasi"] if wasm_abi == "wasi" else [])

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
        out = name + (".a" if static else ".wasm"),
        expected_rel = "lib/lib%s.a" % name if static else "lib/top.wasm",
        deps = wiring.deps,
        link_deps = prepared.get("link_deps", []) or [],
        link_closure = prepared.get("link_closure", link_closure),
        link_closure_overrides = prepared.get("link_closure_overrides", link_closure_overrides),
        nixpkgs_profile = prepared.get("nixpkgs_profile", "default"),
        nixpkg_pins = prepared.get("nixpkg_pins", {}),
        use_selected_wasm = use_selected_wasm,
        wasm_abi = wasm_abi,
        wasm_abi_explicit = declared_wasm_abi != None,
        wasm_target = target,
        wasm_link_kind = link_kind,
        wasm_allocator = "tinygo",
        wasm_libc = "wasi-libc" if wasm_abi == "wasi" else "none",
        wasm_exception_policy = "trap",
        wasm_runtime = "link-only" if static else ("wasi-preview1" if wasm_abi == "wasi" else "webassembly"),
        wasm_header = wasm_header,
        srcs = prepared.get("srcs", []) or [],
        nix_inputs = global_nix_inputs(),
        labels = prepared.get("labels", []) or [],
        visibility = prepared.get("visibility", []),
    )
    module_surface(
        name = name + "__surface",
        module_kind = "wasm",
        source_roots = go_source_roots,
        artifact_mapping_policy = "go-tiny-wasm-v2-%s" % link_kind,
        watch_hints = go_source_roots,
        visibility = ["PUBLIC"],
    )

def nix_go_tiny_wasm_lib(name, **kwargs):
    _tiny_wasm(name, False, kwargs)

def nix_go_tiny_wasm_static_lib(name, **kwargs):
    _tiny_wasm(name, True, kwargs)

__all__ = ["nix_go_tiny_wasm_lib", "nix_go_tiny_wasm_static_lib"]
