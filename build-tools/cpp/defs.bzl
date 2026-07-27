load("@prelude//:rules.bzl", "cxx_library", "cxx_binary", "cxx_test")
load(
    "@viberoots//build-tools/lang:defs_common.bzl",
    "dedupe_preserve",
    "merge_link_intent_deps",
    "normalize_labels",
    "prepare_language_wiring",
    "validate_link_closure_overrides",
    "wire_package_local_planner_visible_stub",
    "wire_package_local_wasm_planner_visible_stub",
)
load("@viberoots//build-tools/lang:native_abi.bzl", "SELECTED_LLVM_COMPILER", "selected_native_target_triple")
load("@viberoots//build-tools/cpp/private:sanitize.bzl", _cpp_sanitize_probe="cpp_sanitize_probe")
load("@viberoots//build-tools/lang:sanitize.bzl", "sanitize_name")
load("@viberoots//build-tools/cpp/private:nix_test.bzl", "cpp_nix_test")
load("@viberoots//build-tools/cpp/private:nix_build.bzl", "cpp_nix_build")
load("@viberoots//build-tools/cpp/private:headers.bzl", _nix_cpp_headers = "nix_cpp_headers")
load("@viberoots//build-tools/cpp/private:runtime_inputs.bzl", "cpp_runtime_nix_inputs")
load("@workspace_providers//:auto_map.bzl", "MODULE_PROVIDERS")
load(
    "@viberoots//build-tools/cpp:wasm_defs.bzl",
    _nix_cpp_wasm_static_lib = "nix_cpp_wasm_static_lib",
    _nix_cpp_wasm_emscripten_lib = "nix_cpp_wasm_emscripten_lib",
)

def _cpp_common(name, kind, kwargs):
    nix_inputs = cpp_runtime_nix_inputs()
    kw = dict(kwargs)
    deps = kw.pop("deps", []) or []
    link_deps = kw.pop("link_deps", []) or []
    header_deps = kw.pop("header_deps", []) or []
    link_closure = kw.pop("link_closure", "direct") or "direct"
    link_closure_overrides = kw.pop("link_closure_overrides", {}) or {}
    link_mode = kw.pop("link_mode", None)
    language_standard = kw.pop("language_standard", "c++17")
    compiler_family = kw.pop("compiler_family", "llvm")
    compiler_identity = kw.pop("compiler_identity", SELECTED_LLVM_COMPILER)
    stl = kw.pop("stl", "libc++")
    target_triple = kw.pop("target_triple", selected_native_target_triple())
    if target_triple != selected_native_target_triple():
        fail("nix_cpp_%s: target_triple must match the selected native target %s" % (kind, selected_native_target_triple()))
    if compiler_family != "llvm" or compiler_identity != SELECTED_LLVM_COMPILER:
        fail("nix_cpp_%s: only the pinned llvm compiler identity is supported" % kind)
    if (language_standard == "c11" and stl != "none") or (language_standard == "c++17" and stl != "libc++"):
        fail("nix_cpp_%s: language_standard and stl must be c11/none or c++17/libc++" % kind)
    if language_standard not in ["c11", "c++17"]:
        fail("nix_cpp_%s: language_standard must be c11 or c++17" % kind)
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
        language_standard = language_standard,
        compiler_family = compiler_family,
        compiler_identity = compiler_identity,
        stl = stl,
        target_triple = target_triple,
        module_surface = "native:v1:%s:%s" % (kind, link_mode),
        nixpkgs_profile = prepared.get("nixpkgs_profile", "default"),
        nixpkg_pins = prepared.get("nixpkg_pins", {}),
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
    _nix_cpp_headers(name, kwargs)


def nix_cpp_test(name, **kwargs):
    # Define a planner-visible cxx_test (not executed) and an external runner test (executed)
    kw = dict(kwargs)
    remote_execution = kw.pop("remote_execution", None)
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
    wiring = wire_package_local_planner_visible_stub(
        name = planner_name,
        out = planner_name + ".stamp",
        kwargs = kw,
        lang = "cpp",
        kind = "test",
        deps = merged,
        srcs = [],
        MODULE_PROVIDERS = MODULE_PROVIDERS,
    )
    prepared = wiring.kwargs
    # Executed: external runner builds the corresponding flake attr for planner_name and runs it
    attrs = {
        "name": name,
        "out": name + ".stamp",
        "planner_label": "//%s:%s" % (native.package_name(), planner_name),
        "planner": ":%s" % planner_name,
        "nix_inputs": cpp_runtime_nix_inputs(),
        "labels": prepared.get("labels", []) or [],
    }
    if remote_execution != None:
        attrs["remote_execution"] = remote_execution
    cpp_nix_test(**attrs)


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
