load("@viberoots//build-tools/lang:label_stamping.bzl", "stamp_patch_scope_for_lang", "stamp_wasm_variant")
load("@viberoots//build-tools/lang:macro_kwargs.bzl", "extract_package_local_patch_dirs_and_nixpkg_deps")
load("@viberoots//build-tools/lang:patch_inputs.bzl", "include_package_local_patches")
load("@viberoots//build-tools/lang:planner_visible_wiring.bzl", "wire_package_local_planner_visible_stub", "wire_planner_visible_inputs")
load("@prelude//:rules.bzl", "genrule")

def prepare_package_local_wasm_wiring(
        *,
        name,
        kwargs,
        lang,
        variant,
        MODULE_PROVIDERS,
        deps = [],
        extra_srcs = [],
        srcs_include_deps = False,
        provider_realization_mode = "deps",
        strip_providers_from_deps = False):
    """
    Shared helper for package-local WASM macro wiring.

    Composes, in fixed order:
    - wasm stamping
    - patch_scope stamping
    - package-local patch input inclusion
    - provider-edge realization into deps or srcs (via wire_planner_visible_inputs)

    Returns: { deps, srcs, labels, local_patch_dirs, nixpkg_deps }.
    """
    if not isinstance(name, str) or name == "":
        fail("prepare_package_local_wasm_wiring: name must be a non-empty string")
    if not isinstance(kwargs, dict):
        fail("prepare_package_local_wasm_wiring: kwargs must be a dict")
    if not isinstance(lang, str) or lang == "":
        fail("prepare_package_local_wasm_wiring: lang must be a non-empty string")
    if not isinstance(variant, str) or variant == "":
        fail("prepare_package_local_wasm_wiring: variant must be a non-empty string")
    if not isinstance(deps, list):
        fail("prepare_package_local_wasm_wiring: deps must be a list")

    info = extract_package_local_patch_dirs_and_nixpkg_deps(kwargs, lang, append_labels = True)
    kw = info.kwargs

    stamp_wasm_variant(kw, lang, variant)
    stamp_patch_scope_for_lang(kw, lang)
    include_package_local_patches(kw, lang, info.local_patch_dirs)

    labels = kw.get("labels", []) or []
    srcs = kw.get("srcs", []) or []
    wired = wire_planner_visible_inputs(
        name = name,
        MODULE_PROVIDERS = MODULE_PROVIDERS,
        deps = deps,
        srcs = srcs,
        extra_srcs = extra_srcs,
        srcs_include_deps = srcs_include_deps,
        provider_realization_mode = provider_realization_mode,
        strip_providers_from_deps = strip_providers_from_deps,
    )
    kw["srcs"] = wired["srcs"]
    return struct(
        kwargs = kw,
        deps = wired["deps"],
        srcs = wired["srcs"],
        labels = kw.get("labels", []) or [],
        local_patch_dirs = info.local_patch_dirs,
        nixpkg_deps = info.nixpkg_deps,
    )

def package_local_wasm_wiring_mutation_probe(
        name,
        lang,
        variant,
        local_patch_dirs = None,
        nixpkg_deps = None):
    """
    Probe helper for tests. Asserts the v2 helper does not mutate the input dict.

    Writes a newline-delimited file of:
      - pre_has:<key>:true|false
      - post_has:<key>:true|false
      - post_labels_same:true|false
    """
    kw = {
        "labels": ["probe:v2"],
    }
    if local_patch_dirs != None:
        kw["local_patch_dirs"] = local_patch_dirs
    if nixpkg_deps != None:
        kw["nixpkg_deps"] = nixpkg_deps

    pre_keys = {
        "local_patch_dirs": "local_patch_dirs" in kw,
        "nixpkg_deps": "nixpkg_deps" in kw,
    }
    pre_labels = list(kw.get("labels", []) or [])

    _ = prepare_package_local_wasm_wiring(
        name = name,
        kwargs = kw,
        lang = lang,
        variant = variant,
        MODULE_PROVIDERS = {},
        deps = [],
    )

    post_keys = {
        "local_patch_dirs": "local_patch_dirs" in kw,
        "nixpkg_deps": "nixpkg_deps" in kw,
    }
    post_labels_same = (kw.get("labels", []) or []) == pre_labels

    out = []
    for k in ["local_patch_dirs", "nixpkg_deps"]:
        out.append("pre_has:%s:%s" % (k, "true" if pre_keys[k] else "false"))
        out.append("post_has:%s:%s" % (k, "true" if post_keys[k] else "false"))
    out.append("post_labels_same:%s" % ("true" if post_labels_same else "false"))

    genrule(
        name = name,
        srcs = [],
        out = name + ".items.txt",
        cmd = "cat > $OUT <<'EOF'\n%s\nEOF" % "\n".join(out),
        labels = ["kind:probe"],
    )

def wire_package_local_wasm_planner_visible_stub(
        *,
        name,
        out = "",
        kwargs,
        lang,
        variant,
        deps = [],
        srcs = [],
        MODULE_PROVIDERS = None,
        provider_realization_mode = None,
        strip_providers_from_deps = True):
    """
    Non-mutating wrapper for planner-visible package-local WASM stubs.

    This helper copies the caller kwargs dict, stamps WASM labels, then delegates
    to the canonical non-mutating package-local planner-visible stub helper.
    """
    if not isinstance(name, str) or name == "":
        fail("wire_package_local_wasm_planner_visible_stub: name must be a non-empty string")
    if not isinstance(kwargs, dict):
        fail("wire_package_local_wasm_planner_visible_stub: kwargs must be a dict")
    if not isinstance(lang, str) or lang == "":
        fail("wire_package_local_wasm_planner_visible_stub: lang must be a non-empty string")
    if not isinstance(variant, str) or variant == "":
        fail("wire_package_local_wasm_planner_visible_stub: variant must be a non-empty string")

    kw = dict(kwargs)
    kw["labels"] = list(kwargs.get("labels", []) or [])
    stamp_wasm_variant(kw, lang, variant)

    return wire_package_local_planner_visible_stub(
        name = name,
        out = out,
        kwargs = kw,
        lang = lang,
        kind = None,
        deps = deps,
        srcs = srcs,
        MODULE_PROVIDERS = MODULE_PROVIDERS,
        provider_realization_mode = provider_realization_mode,
        strip_providers_from_deps = strip_providers_from_deps,
    )

__all__ = [
    "prepare_package_local_wasm_wiring",
    "package_local_wasm_wiring_mutation_probe",
    "wire_package_local_wasm_planner_visible_stub",
]



