load("@viberoots//build-tools/lang:module_surface.bzl", "module_surface")

WASM_KINDS = [
    "wasm",
    "wasi",
    "wasm_static",
    "wasi_static",
    "wasm_browser",
    "wasm_component",
]

def is_wasm_kind(kind):
    return kind in WASM_KINDS

def _validate_strings(field, values):
    if not isinstance(values, list):
        fail("rust target %s must be a list of non-empty strings" % field)
    for value in values:
        if not isinstance(value, str) or value == "":
            fail("rust target %s must be a list of non-empty strings" % field)
    return values

def _validate_exported_identifiers(values):
    first = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ_"
    rest = first + "0123456789-"
    for value in values:
        if value[0] not in first or [char for char in value[1:].elems() if char not in rest]:
            fail("rust target exported_functions entries must match [A-Za-z_][A-Za-z0-9_-]*")
    return values

def _validate_choice(field, value, allowed):
    if value not in allowed:
        fail("rust target %s must be one of %s" % (field, ", ".join(allowed)))
    return value

def _package_file(field, value):
    if not isinstance(value, str) or value == "":
        fail("rust target %s must be a non-empty package-local file" % field)
    if value.startswith("/") or value.startswith("//") or value.startswith(":") or value.startswith("@") or ".." in value.split("/"):
        fail("rust target %s must remain within the package" % field)
    return value

def prepare_wasm_contract(kind, kwargs):
    if not is_wasm_kind(kind):
        return {}
    abi = "wasi" if kind in ["wasi", "wasi_static"] else kwargs.pop("wasm_abi", "bare")
    _validate_choice("wasm_abi", abi, ["bare", "wasi"])
    link_kind = {
        "wasm": "module",
        "wasi": "module",
        "wasm_static": "static",
        "wasi_static": "static",
        "wasm_browser": "browser",
        "wasm_component": "component",
    }[kind]
    expected_target = "wasm32-wasip1" if abi == "wasi" else "wasm32-unknown-unknown"
    if kwargs.get("target", expected_target) != expected_target:
        fail("rust target target must be %s for WASM ABI %s" % (expected_target, abi))
    kwargs["target"] = expected_target
    exported = _validate_exported_identifiers(_validate_strings("exported_functions", kwargs.pop("exported_functions", [])))
    if link_kind == "static" and exported:
        fail("rust_wasm_static_library: exported_functions is unsupported because the final linked module owns its exports")
    optimize = _validate_choice(
        "wasm_optimize",
        kwargs.pop("wasm_optimize", "none"),
        ["none", "speed", "size"],
    )
    debug = kwargs.pop("wasm_debug", False)
    source_map = kwargs.pop("wasm_source_map", False)
    if not isinstance(debug, bool) or not isinstance(source_map, bool):
        fail("rust target wasm_debug and wasm_source_map must be bools")
    if source_map and kind != "wasm_browser":
        fail("rust target wasm_source_map is supported only by rust_wasm_browser_package")
    if source_map and not debug:
        fail("rust target wasm_source_map requires wasm_debug = True")
    header = kwargs.pop("wasm_header", None)
    if link_kind == "static":
        if header == None:
            fail("rust WASM static libraries require a package-local wasm_header")
        header = _package_file("wasm_header", header)
    if link_kind != "static" and header != None:
        fail("rust target wasm_header is supported only by rust_wasm_static_library")
    wit = kwargs.pop("wit", None)
    world = kwargs.pop("wit_world", "")
    adapter = kwargs.pop("component_adapter", "none")
    if kind == "wasm_component":
        if not isinstance(world, str) or world == "":
            fail("rust_wasm_component requires package-local wit and non-empty wit_world")
        wit = _package_file("wit", wit)
        _validate_choice(
            "component_adapter",
            adapter,
            ["none", "wasi-preview1-reactor"],
        )
        if abi == "bare" and adapter != "none":
            fail("rust WASM component bare ABI requires component_adapter = \"none\"")
        if abi == "wasi" and adapter == "none":
            fail("rust WASM component WASI ABI requires an explicit preview1 adapter")
    elif wit != None or world != "" or adapter != "none":
        fail("rust component WIT/adapter arguments require rust_wasm_component")
    runtime = {
        "wasm": "webassembly",
        "wasi": "wasi-preview1",
        "wasm_static": "link-only",
        "wasi_static": "link-only",
        "wasm_browser": "browser",
        "wasm_component": "wasmtime-component",
    }[kind]
    surface = "wasm:v2:%s:%s:allocator=rust:libc=%s:exceptions=trap:runtime=%s" % (
        abi,
        link_kind,
        "wasi-libc" if abi == "wasi" else "none",
        runtime,
    )
    labels = kwargs.get("labels", []) or []
    variant_labels = [
        "kind:wasm",
        "wasm:%s" % link_kind,
        "wasm_abi:%s" % abi,
        "wasm_target:%s" % expected_target,
    ]
    if abi == "wasi":
        variant_labels.append("wasm:wasi")
    if kind == "wasi_static":
        variant_labels.append("kind:wasi_static")
    kwargs["labels"] = labels + variant_labels
    return {
        "wasm_abi": abi,
        "wasm_target": expected_target,
        "wasm_link_kind": link_kind,
        "wasm_allocator": "rust",
        "wasm_libc": "wasi-libc" if abi == "wasi" else "none",
        "wasm_exception_policy": "trap",
        "wasm_runtime": runtime,
        "wasm_header": header,
        "exported_functions": exported,
        "wasm_optimize": optimize,
        "wasm_debug": debug,
        "wasm_source_map": source_map,
        "wit": wit,
        "wit_world": world,
        "component_adapter": adapter,
        "module_surface": surface,
    }

def wasm_contract_rule_attrs():
    return {
        "wasm_abi": attrs.string(default = ""),
        "wasm_target": attrs.string(default = ""),
        "wasm_link_kind": attrs.string(default = ""),
        "wasm_allocator": attrs.string(default = ""),
        "wasm_libc": attrs.string(default = ""),
        "wasm_exception_policy": attrs.string(default = ""),
        "wasm_runtime": attrs.string(default = ""),
        "wasm_header": attrs.option(attrs.source(), default = None),
        "exported_functions": attrs.list(attrs.string(), default = []),
        "wasm_optimize": attrs.string(default = "none"),
        "wasm_debug": attrs.bool(default = False),
        "wasm_source_map": attrs.bool(default = False),
        "wit": attrs.option(attrs.source(), default = None),
        "wit_world": attrs.string(default = ""),
        "component_adapter": attrs.string(default = "none"),
    }

def rust_wasm_module_surface(name, link_kind):
    module_surface(
        name = name + "__surface",
        module_kind = "rust-wasm-" + link_kind,
        source_roots = ["src"],
        artifact_mapping_policy = "rust-wasm:v2:" + link_kind,
        watch_hints = ["Cargo.toml", "Cargo.lock", "src", "wit"],
    )

__all__ = [
    "WASM_KINDS",
    "is_wasm_kind",
    "prepare_wasm_contract",
    "rust_wasm_module_surface",
    "wasm_contract_rule_attrs",
]
