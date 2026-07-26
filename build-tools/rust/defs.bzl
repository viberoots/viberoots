load("@workspace_providers//:auto_map.bzl", "MODULE_PROVIDERS")
load(
    "@viberoots//build-tools/lang:defs_common.bzl",
    "dedupe_preserve",
    "merge_link_intent_deps",
    "normalize_labels",
    "prepare_language_wiring",
    "validate_link_closure_overrides",
)
load("@viberoots//build-tools/lang:global_inputs.bzl", "global_nix_inputs")
load("@viberoots//build-tools/rust/private:nix_build.bzl", "rust_nix_build")
load("@viberoots//build-tools/rust/private:nix_test.bzl", "rust_nix_test")

_PUBLIC_ARGS = [
    "artifact_contract",
    "cargo_lock",
    "cargo_manifest",
    "cargo_fixed_sources",
    "cargo_output_hashes",
    "crate",
    "default_features",
    "features",
    "labels",
    "header_deps",
    "link_closure",
    "link_closure_overrides",
    "link_deps",
    "local_patch_dirs",
    "nixpkg_deps",
    "nixpkg_pins",
    "nixpkgs_profile",
    "profile",
    "remote_builder_smoke",
    "srcs",
    "source_snapshot",
    "source_snapshot_bundle",
    "source_snapshot_manifest",
    "target",
    "tool_closure",
    "materialization_manifest",
    "visibility",
]

def _valid_features(features):
    if not isinstance(features, list):
        return False
    for feature in features:
        if not isinstance(feature, str) or feature == "":
            return False
    return True

def _single_cargo_file(value, default_name, field):
    resolved = value
    if resolved == None:
        matches = native.glob([default_name])
        if len(matches) != 1:
            fail("rust target requires exactly one package-local %s; found %s" % (default_name, len(matches)))
        resolved = matches[0]
    if isinstance(resolved, list):
        if len(resolved) != 1:
            fail("rust target %s must identify exactly one file" % field)
        resolved = resolved[0]
    if not isinstance(resolved, str) or resolved == "":
        fail("rust target %s must be a non-empty file path" % field)
    if resolved != default_name:
        fail("rust target %s must be the canonical package-local %s" % (field, default_name))
    return resolved

def _validate_local_patch_dirs(value):
    if not isinstance(value, list):
        fail("rust target local_patch_dirs must be a list of normalized package-relative paths")
    for directory in value:
        if not isinstance(directory, str) or directory == "":
            fail("rust target local_patch_dirs must contain non-empty strings")
        parts = directory.split("/")
        if directory.startswith("/") or "\\" in directory or ":" in directory or "" in parts or "." in parts or ".." in parts:
            fail("rust target local_patch_dirs must remain within the package: %s" % directory)

def _rust_macro_name(kind):
    if kind == "bin":
        return "rust_binary"
    if kind == "lib":
        return "rust_library"
    if kind == "test":
        return "rust_test"
    if kind == "wasm":
        return "rust_wasm_library"
    if kind == "wasi":
        return "rust_wasi_binary"
    fail("unsupported Rust target kind: %s" % kind)

def _with_required_target(kwargs, macro_name, required_target):
    kw = dict(kwargs)
    if "target" in kw and kw["target"] != required_target:
        fail("%s: target must be %s" % (macro_name, required_target))
    kw["target"] = required_target
    return kw

def _has_nixpkg_inputs(kwargs):
    if kwargs.get("nixpkg_deps", []) or []:
        return True
    for label in kwargs.get("labels", []) or []:
        if isinstance(label, str) and label.startswith("nixpkg:"):
            return True
    return False

def _rust_nix_target(name, kind, out, kwargs):
    kw = dict(kwargs)
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
    if kind in ["wasm", "wasi"] and (link_deps or header_deps or _has_nixpkg_inputs(kw)):
        fail("%s: link_deps, header_deps, and nixpkg dependencies are unsupported for non-native Rust targets; cross-language WebAssembly linking is not available" % _rust_macro_name(kind))
    link_closure = kw.pop("link_closure", "direct") or "direct"
    link_closure_overrides = kw.pop("link_closure_overrides", {}) or {}
    validate_link_closure_overrides(link_deps, link_closure_overrides)
    kw["link_deps"] = link_deps
    kw["header_deps"] = header_deps
    kw["link_closure"] = link_closure
    kw["link_closure_overrides"] = link_closure_overrides
    extra = normalize_labels(native.package_name(), kw.pop("extra_module_providers", []))
    unknown = sorted([key for key in kw.keys() if key not in _PUBLIC_ARGS])
    if unknown:
        fail("%s: unknown arguments: %s" % (_rust_macro_name(kind), ", ".join(unknown)))
    cargo_manifest = _single_cargo_file(kw.pop("cargo_manifest", None), "Cargo.toml", "cargo_manifest")
    cargo_lock = _single_cargo_file(kw.pop("cargo_lock", None), "Cargo.lock", "cargo_lock")
    cargo_output_hashes = kw.pop("cargo_output_hashes", {})
    cargo_fixed_sources = kw.pop("cargo_fixed_sources", {})
    if not isinstance(cargo_output_hashes, dict):
        fail("rust target cargo_output_hashes must be a dict of package-version to Nix hash")
    if not isinstance(cargo_fixed_sources, dict):
        fail("rust target cargo_fixed_sources must be a dict of source identity to reviewed JSON")
    for key, value in cargo_fixed_sources.items():
        if not isinstance(key, str) or not isinstance(value, str):
            fail("rust target cargo_fixed_sources keys and reviewed JSON values must be strings")
    crate = kw.pop("crate", name)
    features = kw.pop("features", [])
    default_features = kw.pop("default_features", True)
    profile = kw.pop("profile", "release")
    target = kw.pop("target", "")
    if not isinstance(crate, str) or crate == "":
        fail("rust target crate must be a non-empty string")
    if not _valid_features(features):
        fail("rust target features must be a list of non-empty strings")
    if not isinstance(default_features, bool):
        fail("rust target default_features must be a bool")
    if profile not in ["release", "dev"]:
        fail("rust target profile must be release or dev")
    if not isinstance(target, str):
        fail("rust target target must be a string")
    expected_target = "wasm32-unknown-unknown" if kind == "wasm" else "wasm32-wasip1" if kind == "wasi" else ""
    if target != expected_target:
        fail("rust target target must be %s for kind %s" % (expected_target if expected_target else "empty", kind))
    if "local_patch_dirs" in kw:
        _validate_local_patch_dirs(kw["local_patch_dirs"])
    wiring = prepare_language_wiring(
        name = name,
        kwargs = kw,
        lang = "rust",
        kind = kind,
        MODULE_PROVIDERS = MODULE_PROVIDERS,
        deps = merge_link_intent_deps(deps, link_deps, header_deps) + extra,
    )
    prepared = wiring.kwargs
    prepared.update(remote_kwargs)
    cargo_root_srcs = native.glob(["**/*.rs"])
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
        "srcs": dedupe_preserve((prepared.get("srcs", []) or []) + cargo_root_srcs),
        "labels": prepared.get("labels", []) or [],
        "nix_inputs": global_nix_inputs(),
        "cargo_manifest": cargo_manifest,
        "cargo_lock": cargo_lock,
        "cargo_output_hashes": cargo_output_hashes,
        "cargo_fixed_sources": cargo_fixed_sources,
        "crate": crate,
        "features": features,
        "default_features": default_features,
        "profile": profile,
        "target": target,
        "local_patch_dirs": wiring.local_patch_dirs,
        "nixpkgs_profile": prepared.get("nixpkgs_profile", "default"),
        "nixpkg_pins": prepared.get("nixpkg_pins", {}),
        "visibility": prepared.get("visibility", []),
    }
    attrs.update(remote_kwargs)
    if kind == "test":
        rust_nix_test(**attrs)
    else:
        rust_nix_build(**attrs)

def rust_library(name, **kwargs):
    _rust_nix_target(name = name, kind = "lib", out = name + ".stamp", kwargs = kwargs)

def rust_binary(name, **kwargs):
    _rust_nix_target(name = name, kind = "bin", out = name, kwargs = kwargs)

def rust_test(name, **kwargs):
    _rust_nix_target(name = name, kind = "test", out = name + ".stamp", kwargs = kwargs)

def rust_wasm_library(name, **kwargs):
    kw = _with_required_target(kwargs, "rust_wasm_library", "wasm32-unknown-unknown")
    _rust_nix_target(name = name, kind = "wasm", out = name + ".wasm", kwargs = kw)

def rust_wasi_binary(name, **kwargs):
    kw = _with_required_target(kwargs, "rust_wasi_binary", "wasm32-wasip1")
    _rust_nix_target(name = name, kind = "wasi", out = name + ".wasm", kwargs = kw)

__all__ = [
    "rust_binary",
    "rust_library",
    "rust_test",
    "rust_wasi_binary",
    "rust_wasm_library",
]
