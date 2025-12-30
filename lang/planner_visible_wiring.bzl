load("//lang:planner_stub.bzl", "planner_stub", "planner_stub_with_package_local_patches")
load("//lang:macro_kwargs.bzl", "extract_package_local_patch_dirs_and_nixpkg_deps", "pop_package_local_patch_dirs_and_nixpkg_deps")
load("//lang:label_stamping.bzl", "stamp_labels", "stamp_patch_scope_for_lang")
load("//lang:provider_edges.bzl", "realize_provider_edges", "strip_provider_targets")

def wire_planner_visible_inputs(
        name,
        MODULE_PROVIDERS = None,
        deps = [],
        srcs = [],
        extra_srcs = [],
        srcs_include_deps = False,
        # Provider realization vocabulary:
        # - None: do not realize provider edges here
        # - "deps": realize provider edges into deps
        # - "inputs": realize provider edges into srcs (for rule shapes that cannot accept deps)
        provider_realization_mode = None,
        # Back-compat: older call sites used "deps"|"srcs".
        realize_providers_into = None,
        # Planner-visible targets should be safe-by-default: avoid provider targets in deps unless asked.
        strip_providers_from_deps = True):
    """
    Standard wiring for planner-visible targets.

    Use this helper when:
    - a macro needs a planner-visible graph node (stubs and shims)
    - provider edges must be realized into a non-deps attribute (e.g. `srcs`)
    - planner-visible deps must exclude provider targets
    """
    deps_out = deps or []
    srcs_out = srcs or []

    if srcs_include_deps:
        srcs_out = srcs_out + deps_out

    if extra_srcs:
        srcs_out = srcs_out + extra_srcs

    if strip_providers_from_deps:
        deps_out = strip_provider_targets(deps_out)

    if provider_realization_mode != None and realize_providers_into != None:
        fail("wire_planner_visible_inputs: set only one of provider_realization_mode or realize_providers_into")

    realize_mode = provider_realization_mode
    if realize_mode == None:
        realize_mode = realize_providers_into

    if realize_mode != None:
        if realize_mode not in ("deps", "inputs", "srcs"):
            fail(
                "wire_planner_visible_inputs: provider realization must be None, 'deps', or 'inputs' (legacy: 'srcs'); got: %s" %
                realize_mode,
            )
        if MODULE_PROVIDERS == None:
            fail("wire_planner_visible_inputs: MODULE_PROVIDERS is required when provider realization is set")

        if realize_mode == "deps":
            deps_out = realize_provider_edges(MODULE_PROVIDERS, name, base = deps_out)
        else:
            # "inputs" (and legacy "srcs") means: realize provider edges into srcs.
            srcs_out = realize_provider_edges(MODULE_PROVIDERS, name, into = "srcs", base = srcs_out)

    return {
        "deps": deps_out,
        "srcs": srcs_out,
    }


def wire_planner_visible_stub(
        name,
        lang = None,
        local_patch_dirs = None,
        out = "",
        deps = [],
        srcs = [],
        labels = [],
        visibility = [],
        MODULE_PROVIDERS = None,
        provider_realization_mode = None,
        # Back-compat: older call sites used "deps"|"srcs".
        realize_providers_into = None,
        strip_providers_from_deps = True,
        **kwargs):
    """
    Canonical planner-visible stub wiring.

    This composes:
    - provider-edge realization (into deps or srcs)
    - provider stripping for planner-only stubs
    - optional package-local patch input inclusion (when `lang` is provided)
    """
    wired = wire_planner_visible_inputs(
        name = name,
        MODULE_PROVIDERS = MODULE_PROVIDERS,
        deps = deps,
        srcs = srcs,
        provider_realization_mode = provider_realization_mode,
        realize_providers_into = realize_providers_into,
        strip_providers_from_deps = strip_providers_from_deps,
    )

    if lang:
        planner_stub_with_package_local_patches(
            name = name,
            lang = lang,
            local_patch_dirs = local_patch_dirs,
            out = out,
            deps = wired["deps"],
            srcs = wired["srcs"],
            labels = labels,
            visibility = visibility,
            **kwargs
        )
        return

    planner_stub(
        name = name,
        out = out,
        deps = wired["deps"],
        srcs = wired["srcs"],
        labels = labels,
        visibility = visibility,
        **kwargs
    )


def wire_package_local_planner_visible_stub(
        *,
        name,
        out = "",
        kwargs,
        lang,
        kind = None,
        deps = [],
        srcs = [],
        MODULE_PROVIDERS = None,
        provider_realization_mode = None,
        # Back-compat: older call sites used "deps"|"srcs".
        realize_providers_into = None,
        strip_providers_from_deps = True):
    """
    Shared helper for package-local, planner-visible stub targets.

    This composes:
    - pop package-local patch dirs (and optional nixpkg_deps) + append nixpkg labels
    - stamp patch_scope:* for the language
    - stamp lang:* and kind:* (kind may be non-standard, e.g. "carchive")
    - create a planner-visible stub with optional provider-edge realization and optional provider stripping
    - attach package-local patch files as stub inputs (via wire_planner_visible_stub(lang=...))

    Returns a struct with: { local_patch_dirs, nixpkg_deps }.
    """
    if not isinstance(name, str) or name == "":
        fail("wire_package_local_planner_visible_stub: name must be a non-empty string")
    if not isinstance(kwargs, dict):
        fail("wire_package_local_planner_visible_stub: kwargs must be a dict")
    if not isinstance(lang, str) or lang == "":
        fail("wire_package_local_planner_visible_stub: lang must be a non-empty string")

    info = pop_package_local_patch_dirs_and_nixpkg_deps(kwargs, lang, append_labels = True)
    stamp_patch_scope_for_lang(kwargs, lang)
    stamp_labels(kwargs, lang, kind)

    wire_planner_visible_stub(
        name = name,
        out = out,
        lang = lang,
        local_patch_dirs = info.local_patch_dirs,
        deps = deps,
        srcs = srcs,
        labels = kwargs.get("labels", []) or [],
        visibility = kwargs.get("visibility", []),
        MODULE_PROVIDERS = MODULE_PROVIDERS,
        provider_realization_mode = provider_realization_mode,
        realize_providers_into = realize_providers_into,
        strip_providers_from_deps = strip_providers_from_deps,
    )
    return struct(
        local_patch_dirs = info.local_patch_dirs,
        nixpkg_deps = info.nixpkg_deps,
    )


def wire_package_local_planner_visible_stub_v2(
        *,
        name,
        out = "",
        kwargs,
        lang,
        kind = None,
        deps = [],
        srcs = [],
        MODULE_PROVIDERS = None,
        provider_realization_mode = None,
        # Back-compat: older call sites used "deps"|"srcs".
        realize_providers_into = None,
        strip_providers_from_deps = True):
    """
    Non-mutating variant of wire_package_local_planner_visible_stub.

    This returns a struct with:
      - kwargs: prepared kwargs dict (with local_patch_dirs/nixpkg_deps removed and labels stamped)
      - local_patch_dirs
      - nixpkg_deps
    """
    if not isinstance(name, str) or name == "":
        fail("wire_package_local_planner_visible_stub_v2: name must be a non-empty string")
    if not isinstance(kwargs, dict):
        fail("wire_package_local_planner_visible_stub_v2: kwargs must be a dict")
    if not isinstance(lang, str) or lang == "":
        fail("wire_package_local_planner_visible_stub_v2: lang must be a non-empty string")

    info = extract_package_local_patch_dirs_and_nixpkg_deps(kwargs, lang, append_labels = True)
    kw = info.kwargs
    stamp_patch_scope_for_lang(kw, lang)
    stamp_labels(kw, lang, kind)

    wire_planner_visible_stub(
        name = name,
        out = out,
        lang = lang,
        local_patch_dirs = info.local_patch_dirs,
        deps = deps,
        srcs = srcs,
        labels = kw.get("labels", []) or [],
        visibility = kw.get("visibility", []),
        MODULE_PROVIDERS = MODULE_PROVIDERS,
        provider_realization_mode = provider_realization_mode,
        realize_providers_into = realize_providers_into,
        strip_providers_from_deps = strip_providers_from_deps,
    )
    return struct(
        kwargs = kw,
        local_patch_dirs = info.local_patch_dirs,
        nixpkg_deps = info.nixpkg_deps,
    )



