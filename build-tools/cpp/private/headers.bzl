load(
    "@viberoots//build-tools/lang:defs_common.bzl",
    "merge_link_intent_deps",
    "prepare_language_wiring",
)
load("@viberoots//build-tools/cpp/private:nix_build.bzl", "cpp_nix_build")
load("@viberoots//build-tools/cpp/private:runtime_inputs.bzl", "cpp_runtime_nix_inputs")
load("@viberoots//build-tools/lang:native_abi.bzl", "SELECTED_LLVM_COMPILER", "selected_native_target_triple")
load("@workspace_providers//:auto_map.bzl", "MODULE_PROVIDERS")

def nix_cpp_headers(name, kwargs):
    kw = dict(kwargs)
    language_standard = kw.pop("language_standard", "c++17")
    stl = kw.pop("stl", "libc++")
    compiler_family = kw.pop("compiler_family", "llvm")
    compiler_identity = kw.pop("compiler_identity", SELECTED_LLVM_COMPILER)
    target_triple = kw.pop("target_triple", selected_native_target_triple())
    if target_triple != selected_native_target_triple():
        fail("nix_cpp_headers: target_triple must match the selected native target %s" % selected_native_target_triple())
    if compiler_family != "llvm" or compiler_identity != SELECTED_LLVM_COMPILER:
        fail("nix_cpp_headers: only the pinned llvm compiler identity is supported")
    if (language_standard == "c11" and stl != "none") or (language_standard == "c++17" and stl != "libc++"):
        fail("nix_cpp_headers: language_standard and stl must be c11/none or c++17/libc++")
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
    wiring = prepare_language_wiring(
        name = name,
        kwargs = kw,
        lang = "cpp",
        kind = "headers",
        deps = merge_link_intent_deps(deps, link_deps, header_deps),
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
        language_standard = language_standard,
        compiler_family = compiler_family,
        compiler_identity = compiler_identity,
        stl = stl,
        target_triple = target_triple,
        module_surface = "native:v1:headers:none",
        nixpkgs_profile = prepared.get("nixpkgs_profile", "default"),
        nixpkg_pins = prepared.get("nixpkg_pins", {}),
        srcs = prepared.get("srcs", []) or [],
        labels = prepared.get("labels", []) or [],
        nix_inputs = cpp_runtime_nix_inputs(),
        visibility = prepared.get("visibility", []),
    )
