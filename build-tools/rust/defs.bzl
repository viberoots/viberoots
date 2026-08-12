load("@workspace_providers//:auto_map.bzl", "MODULE_PROVIDERS")
load("@viberoots//build-tools/lang:defs_common.bzl", "dedupe_preserve", "merge_link_intent_deps", "normalize_labels", "prepare_language_wiring", "validate_link_closure_overrides")
load("@viberoots//build-tools/lang:global_inputs.bzl", "global_nix_inputs")
load("@viberoots//build-tools/rust/private:nix_build.bzl", "rust_nix_build")
load("@viberoots//build-tools/rust/private:nix_test.bzl", "rust_nix_test")
load("@viberoots//build-tools/rust/private:composition_snapshot.bzl", "rust_composition_snapshot")
load("@viberoots//build-tools/rust/private:extension_contract.bzl", "prepare_python_build_wiring", "validate_addon_name", "validate_extension_kind_args", "validate_node_api_version")
load("@viberoots//build-tools/rust/private:interop_contract.bzl", "prepare_interop_kwargs")
load("@viberoots//build-tools/rust/private:macro_contract.bzl", "RUST_PUBLIC_ARGS", "artifact_out", "crate_type_for", "fixed_artifact_contract", "has_nixpkg_inputs", "public_crate_for", "rust_macro_name", "single_cargo_file", "valid_features", "validate_crate_names", "validate_local_patch_dirs", "validate_public_crate", "with_required_target")
load("@viberoots//build-tools/rust/private:runtime_contract.bzl", "validate_rust_runtime_args")
load("@viberoots//build-tools/rust/private:tauri_contract.bzl", "prepare_tauri_contract")
load("@viberoots//build-tools/rust/private:wasm_contract.bzl", "is_wasm_kind", "prepare_wasm_contract", "rust_wasm_module_surface")
def _rust_nix_target(name, kind, out, kwargs, python_lockfile_label = None, interop = False):
    kw = dict(kwargs)
    validate_extension_kind_args(kind, kw)
    remote_kwargs = {}
    for key in [
        "artifact_contract",
        "materialization_manifest",
        "remote_builder_smoke",
        "source_snapshot",
        "source_snapshot_bundle",
        "source_snapshot_manifest",
        "tool_closure",
    ]:
        if key in kw:
            remote_kwargs[key] = kw.pop(key)
    deps = kw.pop("deps", []) or []
    link_deps = kw.pop("link_deps", []) or []
    header_deps = kw.pop("header_deps", []) or []
    if is_wasm_kind(kind) and (header_deps or has_nixpkg_inputs(kw)):
        fail("%s: header_deps and nixpkg dependencies are unsupported for Rust WASM targets" % rust_macro_name(kind))
    if not interop and not is_wasm_kind(kind) and (link_deps or header_deps):
        fail("%s: native link_deps/header_deps are private bridge wiring; use rust_c_ffi_library or rust_cxx_bridge_library with a reviewed binding_config" % rust_macro_name(kind))
    link_closure = kw.pop("link_closure", "direct") or "direct"
    link_mode = kw.pop("link_mode", "")
    link_closure_overrides = kw.pop("link_closure_overrides", {}) or {}
    validate_link_closure_overrides(link_deps, link_closure_overrides)
    kw["link_deps"] = link_deps
    kw["header_deps"] = header_deps
    kw["link_closure"] = link_closure
    kw["link_closure_overrides"] = link_closure_overrides
    extra = normalize_labels(native.package_name(), kw.pop("extra_module_providers", []))
    unknown = sorted([key for key in kw.keys() if key not in RUST_PUBLIC_ARGS])
    if unknown: fail("%s: unknown arguments: %s" % (rust_macro_name(kind), ", ".join(unknown)))
    wasm_attrs = prepare_wasm_contract(kind, kw)
    tauri_attrs = prepare_tauri_contract(kind, kw)
    tauri_root = tauri_attrs.get("tauri_root", "."); cargo_prefix = "" if tauri_root == "." else tauri_root + "/"
    cargo_manifest = single_cargo_file(kw.pop("cargo_manifest", None), cargo_prefix + "Cargo.toml", "cargo_manifest")
    cargo_lock = single_cargo_file(kw.pop("cargo_lock", None), cargo_prefix + "Cargo.lock", "cargo_lock")
    cargo_output_hashes = kw.pop("cargo_output_hashes", {})
    cargo_fixed_sources = kw.pop("cargo_fixed_sources", {})
    if not isinstance(cargo_output_hashes, dict): fail("rust target cargo_output_hashes must be a dict of package-version to Nix hash")
    if not isinstance(cargo_fixed_sources, dict): fail("rust target cargo_fixed_sources must be a dict of source identity to reviewed JSON")
    for key, value in cargo_fixed_sources.items():
        if not isinstance(key, str) or not isinstance(value, str):
            fail("rust target cargo_fixed_sources keys and reviewed JSON values must be strings")
    crate = kw.pop("crate", name)
    cargo_package = kw.pop("cargo_package", crate)
    public_crate = kw.pop("public_crate", crate.replace("-", "_"))
    crate_type = crate_type_for(kind, kw.pop("crate_type", None))
    host_role = kw.pop("host_role", "host" if crate_type == "proc-macro" else "target")
    generated_outputs = kw.pop("generated_outputs", [out])
    features = kw.pop("features", [])
    default_features = kw.pop("default_features", True)
    profile = kw.pop("profile", "release")
    target = kw.pop("target", "")
    module = kw.pop("module", "")
    build_py_deps = kw.pop("build_py_deps", []) or []
    runtime_deps = kw.pop("runtime_deps", []) or []
    addon_name = kw.pop("addon_name", "")
    node_api_version = kw.pop("node_api_version", 0)
    behavior_probe = kw.pop("behavior_probe", False)
    platform, python_abi = kw.pop("platform", ""), kw.pop("python_abi", "")
    interop_keys = ["binding_config", "interop_kind", "interop_generator", "panic_strategy", "exception_policy", "allocator", "thread_safety", "cxx_standard", "c_standard", "compiler_family", "compiler_identity", "target_triple", "stl", "module_surface"]
    supplied_interop = [key for key in interop_keys if kw.get(key, "") != ""]
    if supplied_interop and not interop:
        fail("%s: interop arguments require rust_c_ffi_library or rust_cxx_bridge_library: %s" % (rust_macro_name(kind), ", ".join(supplied_interop)))
    interop_attrs = {key: kw.pop(key, "") for key in interop_keys}
    validate_crate_names(crate, cargo_package); validate_public_crate(public_crate)
    if interop: generated_outputs += [public_crate + ".h", public_crate + ".rs"] + ([public_crate + ".hpp"] if interop_attrs["interop_kind"] == "cxx" else [])
    else: interop_attrs["module_surface"] = "rust-module:v1:%s:%s:%s" % (kind, crate_type, target or "native")
    if host_role not in ["host", "target"]: fail("rust target host_role must be host or target")
    if crate_type == "proc-macro" and host_role != "host": fail("rust proc-macro targets must use the host role")
    if not isinstance(generated_outputs, list) or not generated_outputs: fail("rust target generated_outputs must be a non-empty list")
    for generated_output in generated_outputs:
        if not isinstance(generated_output, str) or generated_output == "":
            fail("rust target generated_outputs must contain non-empty strings")
    kw["labels"] = (kw.get("labels", []) or []) + ["crate-type:" + crate_type, "rust-role:" + host_role]
    if not valid_features(features):
        fail("rust target features must be a list of non-empty strings")
    if not isinstance(default_features, bool):
        fail("rust target default_features must be a bool")
    if profile not in ["release", "dev"]:
        fail("rust target profile must be release or dev")
    if not isinstance(target, str):
        fail("rust target target must be a string")
    validate_rust_runtime_args(build_py_deps, runtime_deps, behavior_probe)
    if kind == "pyext":
        kw = prepare_python_build_wiring(kw, python_lockfile_label, build_py_deps)
    runtime_deps = normalize_labels(native.package_name(), runtime_deps)
    expected_target = wasm_attrs.get("wasm_target", "")
    if target != expected_target:
        fail("rust target target must be %s for kind %s" % (expected_target if expected_target else "empty", kind))
    if "local_patch_dirs" in kw:
        validate_local_patch_dirs(kw["local_patch_dirs"])
    app_deps = tauri_attrs.get("sidecar_deps", []) + ([tauri_attrs["frontend_dist"]] if kind == "tauri" else [])
    wiring = prepare_language_wiring(
        name = name,
        kwargs = kw,
        lang = "rust",
        kind = "app" if kind == "tauri" else kind,
        MODULE_PROVIDERS = MODULE_PROVIDERS,
        deps = merge_link_intent_deps(deps, link_deps, header_deps) + runtime_deps + app_deps + extra,
    )
    prepared = wiring.kwargs
    prepared.update(remote_kwargs)
    cargo_root_srcs = native.glob([cargo_prefix + "**/*.rs"]); tauri_owner_srcs = ([tauri_attrs["tauri_config"]] + tauri_attrs["resources"] + tauri_attrs["capabilities"] + tauri_attrs["permissions"] + tauri_attrs["icons"]) if kind == "tauri" else []
    owner_srcs = dedupe_preserve((prepared.get("srcs", []) or []) + tauri_owner_srcs + native.glob(
        [cargo_prefix + "src/**/*.rs", cargo_prefix + "build.rs", cargo_prefix + "benches/**/*.rs", cargo_prefix + "examples/**/*.rs", cargo_prefix + "tests/**/*.rs"],
    ))
    attrs = {
        "name": name,
        "out": out,
        "kind": kind,
        "self_label": "//%s:%s" % (native.package_name(), name),
        "deps": wiring.deps,
        "link_deps": prepared.get("link_deps", []) or [],
        "header_deps": prepared.get("header_deps", []) or [],
        "link_closure": prepared.get("link_closure", link_closure),
        "link_closure_overrides": prepared.get("link_closure_overrides", link_closure_overrides),
        "srcs": dedupe_preserve((prepared.get("srcs", []) or []) + tauri_owner_srcs + cargo_root_srcs),
        "labels": prepared.get("labels", []) or [],
        "nix_inputs": global_nix_inputs(),
        "cargo_manifest": cargo_manifest,
        "cargo_lock": cargo_lock,
        "cargo_root": native.package_name() + ("" if tauri_root == "." else "/" + tauri_root),
        "cargo_package": cargo_package,
        "cargo_lock_identity": "%s%sCargo.lock" % (native.package_name() + "/", cargo_prefix),
        "cargo_output_hashes": cargo_output_hashes,
        "cargo_fixed_sources": cargo_fixed_sources,
        "crate": crate,
        "public_crate": public_crate,
        "crate_type": crate_type,
        "host_role": host_role,
        "generated_outputs": generated_outputs,
        "features": features,
        "default_features": default_features,
        "profile": profile,
        "target": target,
        "behavior_probe": behavior_probe,
        "local_patch_dirs": wiring.local_patch_dirs,
        "nixpkgs_profile": prepared.get("nixpkgs_profile", "default"),
        "nixpkg_pins": prepared.get("nixpkg_pins", {}),
        "visibility": prepared.get("visibility", []),
    }
    if kind != "test":
        attrs.update({
            "link_mode": link_mode,
            "module": module,
            "build_py_deps": build_py_deps,
            "runtime_deps": runtime_deps,
            "addon_name": addon_name,
            "node_api_version": node_api_version,
            "platform": platform,
            "python_abi": python_abi,
        })
        attrs.update(interop_attrs)
        attrs.update(wasm_attrs)
        attrs.update(tauri_attrs)
    snapshot_attrs = {key: attrs[key] for key in [
        "cargo_root", "cargo_package", "cargo_manifest", "cargo_lock",
        "cargo_lock_identity", "public_crate", "crate_type", "host_role",
        "generated_outputs",
    ]}
    snapshot_attrs["srcs"] = owner_srcs
    snapshot_attrs["owner_label"] = "root//%s:%s" % (native.package_name(), name)
    if "source_snapshot_bundle" in remote_kwargs:
        rust_composition_snapshot(
            name = name + "__rust_composition_snapshot",
            base_bundle = remote_kwargs.pop("source_snapshot_bundle"),
            deps = wiring.deps,
            **snapshot_attrs
        )
        remote_kwargs["source_snapshot_bundle"] = ":" + name + "__rust_composition_snapshot"
    elif "source_snapshot" in remote_kwargs or "source_snapshot_manifest" in remote_kwargs:
        rust_composition_snapshot(
            name = name + "__rust_composition_snapshot",
            base_snapshot = remote_kwargs.pop("source_snapshot", None),
            base_manifest = remote_kwargs.pop("source_snapshot_manifest", None),
            deps = wiring.deps,
            **snapshot_attrs
        )
        remote_kwargs["source_snapshot_bundle"] = ":" + name + "__rust_composition_snapshot"
    attrs.update(remote_kwargs)
    if kind == "test":
        rust_nix_test(**attrs)
    else:
        rust_nix_build(**attrs)
def rust_library(name, **kwargs):
    kw = fixed_artifact_contract(kwargs, "rust_library", "rlib", "target"); _rust_nix_target(name = name, kind = "lib", out = artifact_out(public_crate_for(name, kw), "rlib"), kwargs = kw)
def rust_static_library(name, **kwargs):
    kw = fixed_artifact_contract(kwargs, "rust_static_library", "staticlib", "target"); _rust_nix_target(name = name, kind = "lib", out = artifact_out(public_crate_for(name, kw), "staticlib"), kwargs = kw)
def rust_cdylib(name, **kwargs):
    kw = fixed_artifact_contract(kwargs, "rust_cdylib", "cdylib", "target"); _rust_nix_target(name = name, kind = "lib", out = artifact_out(public_crate_for(name, kw), "cdylib"), kwargs = kw)
def rust_c_ffi_library(name, binding_config, artifact = "static", panic_strategy = "abort", allocator = "caller", thread_safety = "send-sync", c_standard = "c11", compiler_family = "llvm", **kwargs):
    kw = prepare_interop_kwargs(kwargs, "rust_c_ffi_library", "c", binding_config, artifact, panic_strategy, "none", allocator, thread_safety, c_standard, compiler_family, "none"); _rust_nix_target(name = name, kind = "lib", out = artifact_out(public_crate_for(name, kw), kw["crate_type"]), kwargs = kw, interop = True)
def rust_cxx_bridge_library(name, binding_config, artifact = "static", panic_strategy = "abort", exception_policy = "noexcept", allocator = "caller", thread_safety = "send-sync", cxx_standard = "c++17", compiler_family = "llvm", stl = "libc++", **kwargs):
    kw = prepare_interop_kwargs(kwargs, "rust_cxx_bridge_library", "cxx", binding_config, artifact, panic_strategy, exception_policy, allocator, thread_safety, cxx_standard, compiler_family, stl); _rust_nix_target(name = name, kind = "lib", out = artifact_out(public_crate_for(name, kw), kw["crate_type"]), kwargs = kw, interop = True)
def rust_proc_macro(name, **kwargs):
    kw = fixed_artifact_contract(kwargs, "rust_proc_macro", "proc-macro", "host"); _rust_nix_target(name = name, kind = "lib", out = artifact_out(public_crate_for(name, kw), "proc-macro"), kwargs = kw)
def rust_binary(name, **kwargs):
    _rust_nix_target(name = name, kind = "bin", out = name, kwargs = kwargs)
def tauri_app(name, frontend_dist, **kwargs):
    kw = dict(kwargs); kw["frontend_dist"] = frontend_dist; _rust_nix_target(name = name, kind = "tauri", out = name + ".tauri", kwargs = kw)
def rust_test(name, **kwargs):
    _rust_nix_target(name = name, kind = "test", out = name + ".stamp", kwargs = kwargs)
def rust_wasm_library(name, wasm_abi = "bare", **kwargs):
    if wasm_abi not in ["bare", "wasi"]:
        fail("rust_wasm_library: wasm_abi must be bare or wasi")
    kw = dict(kwargs)
    kw["wasm_abi"] = wasm_abi
    target = "wasm32-wasip1" if wasm_abi == "wasi" else "wasm32-unknown-unknown"
    kw = with_required_target(kw, "rust_wasm_library", target); _rust_nix_target(name = name, kind = "wasm", out = name + ".wasm", kwargs = kw); rust_wasm_module_surface(name, "module")
def rust_wasi_binary(name, **kwargs):
    kw = with_required_target(kwargs, "rust_wasi_binary", "wasm32-wasip1"); _rust_nix_target(name = name, kind = "wasi", out = name + ".wasm", kwargs = kw); rust_wasm_module_surface(name, "module")
def rust_wasm_static_library(name, wasm_abi = "bare", **kwargs):
    kw = dict(kwargs); kw["wasm_abi"] = wasm_abi
    kind = "wasi_static" if wasm_abi == "wasi" else "wasm_static"
    _rust_nix_target(name = name, kind = kind, out = "lib" + public_crate_for(name, kw) + ".a", kwargs = kw); rust_wasm_module_surface(name, "static")
def rust_wasm_browser_package(name, **kwargs):
    _rust_nix_target(name = name, kind = "wasm_browser", out = name + ".browser", kwargs = kwargs); rust_wasm_module_surface(name, "browser")
def rust_wasm_component(name, **kwargs):
    _rust_nix_target(name = name, kind = "wasm_component", out = name + ".component.wasm", kwargs = kwargs); rust_wasm_module_surface(name, "component")
def rust_python_extension(name, module, python_abi = "selected", lockfile_label = None, **kwargs):
    ident_chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_0123456789"
    if not isinstance(module, str) or module == "" or not all([part != "" and part[0] not in "0123456789" and all([char in ident_chars for char in part.elems()]) for part in module.split(".")]):
        fail("rust_python_extension: module must be a dotted Python identifier")
    kw = fixed_artifact_contract(kwargs, "rust_python_extension", "cdylib", "target")
    kw.update({"module": module, "python_abi": python_abi})
    _rust_nix_target(name = name, kind = "pyext", out = name + ".pyext.stamp", kwargs = kw, python_lockfile_label = lockfile_label)
def rust_python_wasm_extension(name, backend, **kwargs):
    if backend in ["wasi", "pyodide"]:
        fail("rust_python_wasm_extension: backend %s is unavailable because the pinned Rust/Python toolchains do not provide an importable dynamic-extension ABI" % backend)
    fail("rust_python_wasm_extension: unsupported backend %s; expected wasi or pyodide" % backend)
    _rust_nix_target(name = name, kind = "pyext_wasm", out = name + ".pyext-wasm.stamp", kwargs = kwargs)
def rust_node_addon(name, addon_name = None, node_api_version = 8, platform = "selected", **kwargs):
    resolved_name = validate_addon_name(addon_name or name); validate_node_api_version(node_api_version)
    kw = fixed_artifact_contract(kwargs, "rust_node_addon", "cdylib", "target"); kw.update({"addon_name": resolved_name, "node_api_version": node_api_version, "platform": platform}); _rust_nix_target(name = name, kind = "addon", out = resolved_name + ".node", kwargs = kw)
__all__ = ["rust_binary", "rust_c_ffi_library", "rust_cdylib", "rust_cxx_bridge_library", "rust_library", "rust_node_addon", "rust_proc_macro", "rust_python_extension", "rust_python_wasm_extension", "rust_static_library", "rust_test", "rust_wasi_binary", "rust_wasm_browser_package", "rust_wasm_component", "rust_wasm_library", "rust_wasm_static_library", "tauri_app"]
