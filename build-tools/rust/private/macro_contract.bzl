def valid_features(features):
    if not isinstance(features, list):
        return False
    for feature in features:
        if not isinstance(feature, str) or feature == "":
            return False
    return True

def single_cargo_file(value, default_name, field):
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

def validate_local_patch_dirs(value):
    if not isinstance(value, list):
        fail("rust target local_patch_dirs must be a list of normalized package-relative paths")
    for directory in value:
        if not isinstance(directory, str) or directory == "":
            fail("rust target local_patch_dirs must contain non-empty strings")
        parts = directory.split("/")
        if directory.startswith("/") or "\\" in directory or ":" in directory or "" in parts or "." in parts or ".." in parts:
            fail("rust target local_patch_dirs must remain within the package: %s" % directory)

def rust_macro_name(kind):
    names = {
        "addon": "rust_node_addon",
        "bin": "rust_binary",
        "lib": "rust_library",
        "pyext": "rust_python_extension",
        "pyext_wasm": "rust_python_wasm_extension",
        "tauri": "tauri_app",
        "test": "rust_test",
        "wasm": "rust_wasm_library",
        "wasm_browser": "rust_wasm_browser_package",
        "wasm_component": "rust_wasm_component",
        "wasm_static": "rust_wasm_static_library",
        "wasi": "rust_wasi_binary",
        "wasi_static": "rust_wasm_static_library",
    }
    if kind not in names:
        fail("unsupported Rust target kind: %s" % kind)
    return names[kind]

def crate_type_for(kind, value):
    expected = "bin" if kind in ["bin", "tauri", "wasi"] else "staticlib" if kind in ["wasm_static", "wasi_static"] else "cdylib" if kind in ["addon", "pyext", "pyext_wasm", "wasm", "wasm_browser", "wasm_component"] else "test" if kind == "test" else None
    crate_type = value or expected or "rlib"
    allowed = ["bin", "rlib", "staticlib", "cdylib", "proc-macro", "test"]
    if crate_type not in allowed:
        fail("rust target crate_type must be one of %s" % ", ".join(allowed))
    if expected != None and crate_type != expected:
        fail("%s: crate_type must be %s" % (rust_macro_name(kind), expected))
    return crate_type

def validate_public_crate(value):
    if not isinstance(value, str) or value == "":
        fail("rust target public_crate must be a non-empty Rust identifier")
    letters = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ"
    digits = "0123456789"
    first = value[0]
    if first != "_" and first not in letters:
        fail("rust target public_crate must match [A-Za-z_][A-Za-z0-9_]*: %s" % value)
    for index in range(1, len(value)):
        char = value[index]
        if char != "_" and char not in letters and char not in digits:
            fail("rust target public_crate must match [A-Za-z_][A-Za-z0-9_]*: %s" % value)
    return value

def validate_crate_names(crate, cargo_package):
    if not isinstance(crate, str) or crate == "" or not isinstance(cargo_package, str) or cargo_package == "":
        fail("rust target crate and cargo_package must be non-empty strings")

def public_crate_for(name, kwargs):
    crate = kwargs.get("crate", name)
    if not isinstance(crate, str) or crate == "":
        fail("rust target crate must be a non-empty string")
    return validate_public_crate(kwargs.get("public_crate", crate.replace("-", "_")))

def artifact_out(public_crate, crate_type):
    if crate_type == "rlib":
        return "lib" + public_crate + ".rlib"
    if crate_type == "staticlib":
        return "lib" + public_crate + ".a"
    if crate_type == "cdylib":
        return "lib" + public_crate + ".cdylib"
    if crate_type == "proc-macro":
        return "lib" + public_crate + ".proc-macro"
    fail("unsupported Rust library artifact type: %s" % crate_type)

def fixed_artifact_contract(kwargs, macro_name, crate_type, host_role):
    kw = dict(kwargs)
    supplied_type = kw.get("crate_type")
    supplied_role = kw.get("host_role")
    if supplied_type != None and supplied_type != crate_type:
        fail("%s: crate_type must be %s" % (macro_name, crate_type))
    if supplied_role != None and supplied_role != host_role:
        fail("%s: host_role must be %s" % (macro_name, host_role))
    kw["crate_type"] = crate_type
    kw["host_role"] = host_role
    return kw

def with_required_target(kwargs, macro_name, required_target):
    kw = dict(kwargs)
    if "target" in kw and kw["target"] != required_target:
        fail("%s: target must be %s" % (macro_name, required_target))
    kw["target"] = required_target
    return kw

def has_nixpkg_inputs(kwargs):
    if kwargs.get("nixpkg_deps", []) or []:
        return True
    for label in kwargs.get("labels", []) or []:
        if isinstance(label, str) and label.startswith("nixpkg:"):
            return True
    return False

__all__ = [
    "RUST_PUBLIC_ARGS",
    "artifact_out",
    "crate_type_for",
    "fixed_artifact_contract",
    "has_nixpkg_inputs",
    "public_crate_for",
    "rust_macro_name",
    "single_cargo_file",
    "valid_features",
    "validate_local_patch_dirs",
    "validate_crate_names",
    "validate_public_crate",
    "with_required_target",
]
RUST_PUBLIC_ARGS = [
    "addon_name",
    "artifact_contract",
    "build_py_deps",
    "binding_config",
    "behavior_probe",
    "cargo_fixed_sources",
    "cargo_lock",
    "cargo_manifest",
    "cargo_output_hashes",
    "cargo_package",
    "crate",
    "crate_type",
    "cxx_standard",
    "c_standard",
    "compiler_family",
    "compiler_identity",
    "default_features",
    "features",
    "exception_policy",
    "generated_outputs",
    "header_deps",
    "host_role",
    "interop_generator",
    "interop_kind",
    "labels",
    "link_closure",
    "link_closure_overrides",
    "link_deps",
    "link_mode",
    "local_patch_dirs",
    "materialization_manifest",
    "module",
    "module_surface",
    "nixpkg_deps",
    "nixpkg_pins",
    "nixpkgs_profile",
    "node_api_version",
    "allocator",
    "platform",
    "profile",
    "panic_strategy",
    "python_abi",
    "public_crate",
    "remote_builder_smoke",
    "runtime_deps",
    "source_snapshot",
    "source_snapshot_bundle",
    "source_snapshot_manifest",
    "srcs",
    "target",
    "target_triple",
    "thread_safety",
    "stl",
    "tool_closure",
    "visibility",
    "component_adapter",
    "exported_functions",
    "wasm_abi",
    "wasm_debug",
    "wasm_header",
    "wasm_optimize",
    "wasm_source_map",
    "wit",
    "wit_world",
]
