load("@workspace_providers//:auto_map.bzl", "MODULE_PROVIDERS")
load("@viberoots//build-tools/lang:defs_common.bzl", "dedupe_preserve", "normalize_labels", "prepare_language_wiring")
load("@viberoots//build-tools/lang:global_inputs.bzl", "global_nix_inputs")
load("@viberoots//build-tools/rust/private:nix_build.bzl", "rust_nix_build")

_PUBLIC_ARGS = [
    "cargo_lock",
    "cargo_manifest",
    "crate",
    "default_features",
    "features",
    "labels",
    "local_patch_dirs",
    "profile",
    "srcs",
    "target",
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

def _rust_nix_target(name, kind, out, kwargs):
    kw = dict(kwargs)
    deps = kw.pop("deps", [])
    extra = normalize_labels(native.package_name(), kw.pop("extra_module_providers", []))
    unknown = sorted([key for key in kw.keys() if key not in _PUBLIC_ARGS])
    if unknown:
        fail("rust_%s: unknown arguments: %s" % ("binary" if kind == "bin" else "library", ", ".join(unknown)))
    cargo_manifest = _single_cargo_file(kw.pop("cargo_manifest", None), "Cargo.toml", "cargo_manifest")
    cargo_lock = _single_cargo_file(kw.pop("cargo_lock", None), "Cargo.lock", "cargo_lock")
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
    if target != "":
        fail("rust target target is unsupported in the native PR-1 contract; leave it empty")
    if "local_patch_dirs" in kw:
        _validate_local_patch_dirs(kw["local_patch_dirs"])
    wiring = prepare_language_wiring(
        name = name,
        kwargs = kw,
        lang = "rust",
        kind = kind,
        MODULE_PROVIDERS = MODULE_PROVIDERS,
        deps = deps + extra,
    )
    prepared = wiring.kwargs
    cargo_root_srcs = native.glob(["**/*.rs"])
    rust_nix_build(
        name = name,
        out = out,
        kind = kind,
        self_label = "//%s:%s" % (native.package_name(), name),
        deps = wiring.deps,
        srcs = dedupe_preserve((prepared.get("srcs", []) or []) + cargo_root_srcs),
        labels = prepared.get("labels", []) or [],
        nix_inputs = global_nix_inputs(),
        cargo_manifest = cargo_manifest,
        cargo_lock = cargo_lock,
        crate = crate,
        features = features,
        default_features = default_features,
        profile = profile,
        target = target,
        local_patch_dirs = wiring.local_patch_dirs,
        visibility = prepared.get("visibility", []),
    )

def rust_library(name, **kwargs):
    _rust_nix_target(name = name, kind = "lib", out = name + ".stamp", kwargs = kwargs)

def rust_binary(name, **kwargs):
    _rust_nix_target(name = name, kind = "bin", out = name, kwargs = kwargs)

__all__ = [
    "rust_binary",
    "rust_library",
]
