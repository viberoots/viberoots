load("//lang:label_stamping.bzl", "stamp_patch_scope_for_lang", "stamp_wasm_variant")
load("//lang:macro_kwargs.bzl", "pop_package_local_patch_dirs_and_nixpkg_deps")
load("//lang:patch_inputs.bzl", "include_package_local_patches")
load("//lang:planner_visible_wiring.bzl", "wire_package_local_planner_visible_stub", "wire_planner_visible_inputs")

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

    stamp_wasm_variant(kwargs, lang, variant)
    info = pop_package_local_patch_dirs_and_nixpkg_deps(kwargs, lang, append_labels = True)
    stamp_patch_scope_for_lang(kwargs, lang)
    include_package_local_patches(kwargs, lang, info.local_patch_dirs)

    labels = kwargs.get("labels", []) or []
    srcs = kwargs.get("srcs", []) or []
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
    return struct(
        deps = wired["deps"],
        srcs = wired["srcs"],
        labels = labels,
        local_patch_dirs = info.local_patch_dirs,
        nixpkg_deps = info.nixpkg_deps,
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
    Wrapper for planner-visible package-local WASM stubs.

    Ensures wasm stamping happens before delegating to the canonical
    package-local planner-visible stub wiring helper.
    """
    stamp_wasm_variant(kwargs, lang, variant)
    return wire_package_local_planner_visible_stub(
        name = name,
        out = out,
        kwargs = kwargs,
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
    "wire_package_local_wasm_planner_visible_stub",
]



