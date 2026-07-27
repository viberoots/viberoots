load("@viberoots//build-tools/lang:native_abi.bzl", "SELECTED_LLVM_COMPILER", "selected_native_target_triple")

_INTEROP_GENERATOR = "viberoots-rust-bindings-1"

def _require_choice(macro, field, value, allowed):
    if value not in allowed:
        fail("%s: %s must be one of %s" % (macro, field, ", ".join(allowed)))

def prepare_interop_kwargs(
        kwargs,
        macro,
        interop_kind,
        binding_config,
        artifact,
        panic_strategy,
        exception_policy,
        allocator,
        thread_safety,
        language_standard,
        compiler_family,
        stl):
    if not isinstance(binding_config, str) or binding_config == "":
        fail("%s: binding_config must be one package-relative JSON file" % macro)
    if binding_config.startswith("/") or "\\" in binding_config or ".." in binding_config.split("/"):
        fail("%s: binding_config must remain within the package" % macro)
    _require_choice(macro, "artifact", artifact, ["static", "shared"])
    _require_choice(macro, "panic_strategy", panic_strategy, ["abort"])
    _require_choice(macro, "exception_policy", exception_policy, ["none", "noexcept", "contained"])
    _require_choice(macro, "allocator", allocator, ["caller", "rust"])
    _require_choice(macro, "thread_safety", thread_safety, ["send-sync"])
    _require_choice(macro, "compiler_family", compiler_family, ["llvm"])
    if interop_kind == "c" and exception_policy != "none":
        fail("%s: C FFI requires exception_policy=\"none\"" % macro)
    if interop_kind == "c" and (language_standard != "c11" or stl != "none"):
        fail("%s: C FFI requires c11 and stl=\"none\"" % macro)
    if interop_kind == "cxx":
        if language_standard != "c++17" or stl != "libc++":
            fail("%s: cxx_standard must match the pinned C++ bridge standard c++17" % macro)
        if exception_policy == "none":
            fail("%s: C++ bridges require noexcept or contained exception policy" % macro)
    kw = dict(kwargs)
    if "compiler_identity" in kw:
        fail("%s: compiler_identity is internal and derives from the selected pinned LLVM toolchain" % macro)
    selected_target = selected_native_target_triple()
    supplied_target = kw.get("target_triple")
    if supplied_target != None and supplied_target != selected_target:
        fail("%s: target_triple must match the selected native target %s" % (macro, selected_target))
    fixed_type = "staticlib" if artifact == "static" else "cdylib"
    supplied_type = kw.get("crate_type")
    if supplied_type != None and supplied_type != fixed_type:
        fail("%s: crate_type must be %s for artifact=%s" % (macro, fixed_type, artifact))
    kw["crate_type"] = fixed_type
    kw["link_mode"] = artifact
    kw["host_role"] = "target"
    kw["binding_config"] = binding_config
    kw["interop_kind"] = interop_kind
    kw["interop_generator"] = _INTEROP_GENERATOR
    kw["panic_strategy"] = panic_strategy
    kw["exception_policy"] = exception_policy
    kw["allocator"] = allocator
    kw["thread_safety"] = thread_safety
    kw["cxx_standard"] = language_standard if interop_kind == "cxx" else ""
    kw["c_standard"] = language_standard if interop_kind == "c" else ""
    kw["compiler_family"] = compiler_family
    kw["compiler_identity"] = SELECTED_LLVM_COMPILER
    kw["target_triple"] = selected_target
    kw["stl"] = stl
    kw["module_surface"] = "rust-abi:v1:%s:%s:native" % (interop_kind, artifact)
    kw["labels"] = (kw.get("labels", []) or []) + [
        "rust-interop:" + interop_kind,
        "abi:c-v1" if interop_kind == "c" else "abi:cxx-v1",
        "link-mode:" + artifact,
    ]
    kw["srcs"] = (kw.get("srcs", []) or []) + [binding_config]
    return kw

__all__ = ["prepare_interop_kwargs"]
