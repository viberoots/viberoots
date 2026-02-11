load("@prelude//:rules.bzl", "cxx_library", "cxx_binary", "cxx_test")
load(
    "//build-tools/lang:defs_common.bzl",
    "dedupe_preserve",
    "merge_link_intent_deps",
    "normalize_labels",
    "prepare_language_wiring",
    "validate_link_closure_overrides",
    "wire_package_local_planner_visible_stub",
    "wire_package_local_wasm_planner_visible_stub",
)
load("//build-tools/lang:global_inputs.bzl", "global_nix_inputs")
load("//build-tools/cpp/private:sanitize.bzl", _cpp_sanitize_probe="cpp_sanitize_probe")
load("//build-tools/lang:sanitize.bzl", "sanitize_name")
load("//build-tools/cpp/private:nix_test.bzl", "cpp_nix_test")
load("//build-tools/cpp/private:nix_build.bzl", "cpp_nix_build")
load("//build-tools/lang:auto_map.bzl", "MODULE_PROVIDERS")
load(
    "//build-tools/cpp:wasm_defs.bzl",
    _nix_cpp_wasm_static_lib = "nix_cpp_wasm_static_lib",
    _nix_cpp_wasm_emscripten_lib = "nix_cpp_wasm_emscripten_lib",
)

def _cpp_common(name, kind, kwargs):
    nix_inputs = global_nix_inputs()
    kw = dict(kwargs)
    deps = kw.pop("deps", []) or []
    link_deps = kw.pop("link_deps", []) or []
    header_deps = kw.pop("header_deps", []) or []
    link_closure = kw.pop("link_closure", "direct") or "direct"
    link_closure_overrides = kw.pop("link_closure_overrides", {}) or {}
    link_mode = kw.pop("link_mode", None)
    link_kind = kw.pop("link_kind", None)
    if link_mode == None and link_kind != None:
        link_mode = link_kind
    if link_mode == None:
        link_mode = "static"
    validate_link_closure_overrides(link_deps, link_closure_overrides)
    # Preserve normalized values for downstream tooling and for passing through to the underlying rule.
    kw["link_deps"] = link_deps
    kw["header_deps"] = header_deps
    kw["link_closure"] = link_closure
    kw["link_closure_overrides"] = link_closure_overrides
    kw["link_mode"] = link_mode

    merged = merge_link_intent_deps(deps, link_deps, header_deps)
    extra = normalize_labels(native.package_name(), kw.pop("extra_module_providers", []) or [])
    base_deps = merged + extra
    labels = kw.get("labels", []) or []
    if kind == "addon":
        addon_name = kw.get("addon_name", None)
        if addon_name:
            labels = dedupe_preserve(labels + ["addon_name:%s" % addon_name])
    kw["labels"] = labels

    wiring = prepare_language_wiring(
        name = name,
        kwargs = kw,
        lang = "cpp",
        kind = kind,
        MODULE_PROVIDERS = MODULE_PROVIDERS,
        deps = base_deps,
    )
    prepared = wiring.kwargs
    srcs = prepared.get("srcs", []) or []

    out = sanitize_name("//%s:%s" % (native.package_name(), name))
    if kind == "lib":
        if link_mode == "shared":
            out = out + ".so"
        else:
            out = out + ".a"
    elif kind == "addon":
        out = out + ".node"

    cpp_nix_build(
        name = name,
        out = out,
        kind = kind,
        self_label = "//%s:%s" % (native.package_name(), name),
        deps = wiring.deps,
        link_deps = prepared.get("link_deps", []) or [],
        header_deps = prepared.get("header_deps", []) or [],
        link_closure = prepared.get("link_closure", link_closure),
        link_closure_overrides = prepared.get("link_closure_overrides", link_closure_overrides),
        link_mode = prepared.get("link_mode", link_mode),
        srcs = srcs,
        labels = prepared.get("labels", []) or [],
        nix_inputs = nix_inputs,
        visibility = prepared.get("visibility", []),
    )


def nix_cpp_library(name, **kwargs):
    _cpp_common(name, "lib", kwargs)

def nix_cpp_binary(name, **kwargs):
    _cpp_common(name, "bin", kwargs)

def nix_cpp_headers(name, **kwargs):
    # Header-only C++ target routed through the Nix planner template (cppHeaders).
    kw = dict(kwargs)
    deps = kw.pop("deps", []) or []
    link_deps = kw.pop("link_deps", []) or []
    header_deps = kw.pop("header_deps", []) or []
    link_closure = kw.pop("link_closure", "direct") or "direct"
    link_mode = kw.pop("link_mode", None)
    link_kind = kw.pop("link_kind", None)
    if link_mode == None and link_kind != None:
        link_mode = link_kind
    if link_mode == None:
        link_mode = "static"
    if link_mode == "shared":
        fail("nix_cpp_headers: link_mode=\"shared\" is invalid for header-only targets; use nix_cpp_library instead")
    kw["link_deps"] = link_deps
    kw["header_deps"] = header_deps
    kw["link_closure"] = link_closure
    kw["link_mode"] = link_mode
    merged = merge_link_intent_deps(deps, link_deps, header_deps)
    wiring = prepare_language_wiring(
        name = name,
        kwargs = kw,
        lang = "cpp",
        kind = "headers",
        deps = merged,
        MODULE_PROVIDERS = MODULE_PROVIDERS,
    )
    prepared = wiring.kwargs
    cpp_nix_build(
        name = name,
        out = name + ".stamp",
        kind = "headers",
        self_label = "//%s:%s" % (native.package_name(), name),
        deps = wiring.deps,
        link_deps = prepared.get("link_deps", []) or [],
        header_deps = prepared.get("header_deps", []) or [],
        link_closure = prepared.get("link_closure", link_closure),
        link_mode = prepared.get("link_mode", link_mode),
        srcs = prepared.get("srcs", []) or [],
        labels = prepared.get("labels", []) or [],
        nix_inputs = global_nix_inputs(),
        visibility = prepared.get("visibility", []),
    )


def nix_cpp_test(name, **kwargs):
    # Define a planner-visible cxx_test (not executed) and an external runner test (executed)
    kw = dict(kwargs)
    deps = kw.pop("deps", []) or []
    link_deps = kw.pop("link_deps", []) or []
    header_deps = kw.pop("header_deps", []) or []
    link_closure = kw.pop("link_closure", "direct") or "direct"
    link_closure_overrides = kw.pop("link_closure_overrides", {}) or {}
    link_mode = kw.pop("link_mode", None)
    link_kind = kw.pop("link_kind", None)
    if link_mode == None and link_kind != None:
        link_mode = link_kind
    if link_mode == None:
        link_mode = "static"
    validate_link_closure_overrides(link_deps, link_closure_overrides)
    kw["link_deps"] = link_deps
    kw["header_deps"] = header_deps
    kw["link_closure"] = link_closure
    kw["link_closure_overrides"] = link_closure_overrides
    kw["link_mode"] = link_mode
    merged = merge_link_intent_deps(deps, link_deps, header_deps)
    planner_name = name + "__planner"
    # Planner-visible stub: Nix builds the test; this node exists for planner discovery and invalidation.
    # Provider deps are stripped to avoid visibility / graph-shape problems on the planner-visible boundary.
    wire_package_local_planner_visible_stub(
        name = planner_name,
        out = planner_name + ".stamp",
        kwargs = kw,
        lang = "cpp",
        kind = "test",
        deps = merged,
        srcs = [],
        MODULE_PROVIDERS = MODULE_PROVIDERS,
    )
    # Executed: external runner builds the corresponding flake attr for planner_name and runs it
    cpp_nix_test(
        name = name,
        out = name + ".stamp",
        planner_label = "//%s:%s" % (native.package_name(), planner_name),
        planner = ":%s" % planner_name,
        nix_inputs = global_nix_inputs(),
    )


def cpp_sanitize_probe(name, label):
    _cpp_sanitize_probe(name = name, label = label)

def nix_cpp_node_addon(name, **kwargs):
    # Node-API addon producing a .node shared library via the Nix planner.
    #
    # Contract:
    # - This macro stamps labels ["lang:cpp", "kind:addon"] and includes local patch dirs
    #   in srcs so patch edits precisely invalidate reverse deps.
    # - addon_name (optional) is recorded as a non-functional label "addon_name:<name>"
    #   to aid planner tooling and documentation. It does not change the build artifact
    #   filename selected here.
    # - The build artifact is a single ".node" shared library. Downstream Node packaging
    #   should copy/rename this artifact to a stable runtime path such as
    #   "native/<addon_name or sanitized target name>.node" for loading from JS/TS.
    _cpp_common(name, "addon", kwargs)

def nix_cpp_wasm_static_lib(name, **kwargs):
    _nix_cpp_wasm_static_lib(name, **kwargs)

def nix_cpp_wasm_emscripten_lib(name, **kwargs):
    _nix_cpp_wasm_emscripten_lib(name, **kwargs)

__all__ = [
    "nix_cpp_library",
    "nix_cpp_binary",
    "nix_cpp_headers",
    "nix_cpp_test",
    "nix_cpp_node_addon",
    "nix_cpp_wasm_static_lib",
    "nix_cpp_wasm_emscripten_lib",
    "cpp_sanitize_probe",
]

