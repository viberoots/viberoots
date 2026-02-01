load("//lang:planner_stub.bzl", "planner_stub", "planner_stub_with_package_local_patches")
load("//lang:macro_kwargs.bzl", "extract_package_local_patch_dirs_and_nixpkg_deps")
load("//lang:label_stamping.bzl", "stamp_labels", "stamp_patch_scope_for_lang")
load("//lang:provider_edges.bzl", "merge_provider_edges", "strip_provider_targets")
load("//lang:dict_inputs.bzl", "PROVIDER_EDGES_KEY_PREFIX")

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
        strip_providers_from_deps = True,
        provider_dict_safe = False,
        provider_key_prefix = PROVIDER_EDGES_KEY_PREFIX):
    """
    Standard wiring for planner-visible targets.

    Use this helper when:
    - a macro needs a planner-visible graph node (stubs and shims)
    - provider edges must be realized into a non-deps attribute (e.g. `srcs`)
    - planner-visible deps must exclude provider targets
    """
    deps_out = deps or []
    srcs_out = srcs or []

    extra_inputs = []
    if srcs_include_deps:
        if isinstance(srcs_out, list):
            srcs_out = srcs_out + deps_out
        else:
            extra_inputs = extra_inputs + deps_out

    if extra_srcs:
        if isinstance(srcs_out, list):
            srcs_out = srcs_out + extra_srcs
        else:
            extra_inputs = extra_inputs + extra_srcs

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
            deps_out = merge_provider_edges(
                name,
                deps_out,
                base = deps_out,
                MODULE_PROVIDERS = MODULE_PROVIDERS,
            )
        else:
            # "inputs" (and legacy "srcs") means: realize provider edges into srcs.
            if isinstance(srcs_out, dict):
                if not provider_dict_safe:
                    fail("wire_planner_visible_inputs: provider_dict_safe must be true when srcs is dict-shaped")
                inputs_base = extra_inputs
                srcs_out = merge_provider_edges(
                    name,
                    inputs_base,
                    into = "srcs",
                    base = srcs_out,
                    dict_safe = True,
                    key_prefix = provider_key_prefix,
                    MODULE_PROVIDERS = MODULE_PROVIDERS,
                )
            else:
                inputs_base = srcs_out if isinstance(srcs_out, list) else extra_inputs
                srcs_out = merge_provider_edges(
                    name,
                    inputs_base,
                    into = "srcs",
                    base = inputs_base,
                    MODULE_PROVIDERS = MODULE_PROVIDERS,
                )

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
        provider_dict_safe = False,
        provider_key_prefix = PROVIDER_EDGES_KEY_PREFIX,
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
        provider_dict_safe = provider_dict_safe,
        provider_key_prefix = provider_key_prefix,
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
        strip_providers_from_deps = True,
        provider_dict_safe = False,
        provider_key_prefix = PROVIDER_EDGES_KEY_PREFIX):
    """
    Non-mutating variant of wire_package_local_planner_visible_stub.

    This returns a struct with:
      - kwargs: prepared kwargs dict (with local_patch_dirs/nixpkg_deps removed and labels stamped)
      - local_patch_dirs
      - nixpkg_deps
    """
    if not isinstance(name, str) or name == "":
        fail("wire_package_local_planner_visible_stub: name must be a non-empty string")
    if not isinstance(kwargs, dict):
        fail("wire_package_local_planner_visible_stub: kwargs must be a dict")
    if not isinstance(lang, str) or lang == "":
        fail("wire_package_local_planner_visible_stub: lang must be a non-empty string")

    info = extract_package_local_patch_dirs_and_nixpkg_deps(kwargs, lang, append_labels = True)
    kw = info.kwargs
    stamp_patch_scope_for_lang(kw, lang)
    stamp_labels(kw, lang, kind)

    # Preserve link-intent attrs on planner-visible stubs so export-graph can surface them.
    # This keeps the macro-level contract visible to planners and tests.
    link_deps = kw.get("link_deps", []) or []
    header_deps = kw.get("header_deps", []) or []
    link_closure = kw.get("link_closure", "direct") or "direct"
    link_closure_overrides = kw.get("link_closure_overrides", {}) or {}
    link_mode = kw.get("link_mode", "static") or "static"

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
        provider_dict_safe = provider_dict_safe,
        provider_key_prefix = provider_key_prefix,
        link_deps = link_deps,
        header_deps = header_deps,
        link_closure = link_closure,
        link_closure_overrides = link_closure_overrides,
        link_mode = link_mode,
    )
    return struct(
        kwargs = kw,
        local_patch_dirs = info.local_patch_dirs,
        nixpkg_deps = info.nixpkg_deps,
    )




