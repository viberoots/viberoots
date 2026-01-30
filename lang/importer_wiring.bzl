load("//lang:dict_inputs.bzl", "PATCH_INPUTS_KEY_PREFIX", "PROVIDER_EDGES_KEY_PREFIX")
load("//lang:importer_wiring_primitives.bzl", "attach_importer_patch_inputs", "require_single_importer_lockfile_label")
load("//lang:provider_edges.bzl", "merge_provider_edges")
load("//lang:label_stamping.bzl", "stamp_labels", "stamp_patch_scope_for_lang")
load("//lang:lockfile_labels.bzl", "importer_from_labels")
load(
    "//lang:patch_inputs.bzl",
    "synthetic_dep_for_importer_patches_from_labels",
)

def _clone_container_or_none(v):
    if isinstance(v, dict):
        return dict(v)
    if isinstance(v, list):
        return list(v)
    return v

def _prepare_non_mutating_kwargs(kwargs, patch_into, provider_into):
    kw = dict(kwargs) if kwargs != None else {}
    kw["labels"] = list(kw.get("labels", []) or []) if isinstance(kw.get("labels", []), list) else []

    if patch_into != None and patch_into in kw:
        kw[patch_into] = _clone_container_or_none(kw.get(patch_into))
    if provider_into != None and provider_into != "deps" and provider_into in kw:
        kw[provider_into] = _clone_container_or_none(kw.get(provider_into))
    return kw

def prepare_importer_non_genrule_wiring(
        name,
        kwargs,
        deps,
        lang,
        kind,
        labels = [],
        lockfile_label = None,
        patch_into = "srcs",
        patch_base = None,
        patch_dict_safe = None,
        patch_key_prefix = PATCH_INPUTS_KEY_PREFIX,
        provider_into = "deps",
        provider_base = None,
        provider_dict_safe = None,
        provider_key_prefix = PROVIDER_EDGES_KEY_PREFIX,
        MODULE_PROVIDERS = None):
    """
    Non-mutating importer-scoped wiring for rule shapes that accept a kwargs dict.

    Returns a struct:
      - importer
      - kwargs: prepared kwargs dict
      - deps: provider edges realized deterministically (when provider_into == "deps")
    """
    kw = _prepare_non_mutating_kwargs(kwargs, patch_into, provider_into)
    base_deps = list(deps) if isinstance(deps, list) else []

    kw["name"] = name
    kw["labels"] = (kw.get("labels", []) or []) + (labels or [])
    require_single_importer_lockfile_label(kw, lockfile_label)
    stamp_patch_scope_for_lang(kw, lang)
    stamp_labels(kw, lang, kind)
    importer = importer_from_labels(kw)

    if patch_into != None:
        if patch_base != None:
            kw[patch_into] = dict(patch_base) if isinstance(patch_base, dict) else list(patch_base)
        elif kw.get(patch_into) == None:
            kw[patch_into] = []

        is_dict = isinstance(kw.get(patch_into), dict)
        dict_safe = is_dict if patch_dict_safe == None else patch_dict_safe
        attach_importer_patch_inputs(
            kw,
            lang,
            into = patch_into,
            dict_safe = dict_safe,
            key_prefix = patch_key_prefix,
        )

    wired_deps = base_deps
    if provider_into == "deps":
        wired_deps = merge_provider_edges(
            name,
            base_deps,
            MODULE_PROVIDERS = MODULE_PROVIDERS,
        )
    else:
        base = provider_base if provider_base != None else kw.get(provider_into)
        is_dict = isinstance(base, dict)
        dict_safe = is_dict if provider_dict_safe == None else provider_dict_safe
        if base == None:
            base = {} if dict_safe else []
        kw[provider_into] = merge_provider_edges(
            name,
            base_deps,
            into = provider_into,
            base = base,
            dict_safe = dict_safe,
            key_prefix = provider_key_prefix,
            MODULE_PROVIDERS = MODULE_PROVIDERS,
        )

    return struct(
        importer = importer,
        kwargs = kw,
        deps = wired_deps,
    )

def prepare_importer_genrule_kwargs(
        name,
        kwargs,
        srcs,
        deps,
        lang,
        kind,
        labels = [],
        lockfile_label = None,
        MODULE_PROVIDERS = None,
        patch_key_prefix = PATCH_INPUTS_KEY_PREFIX,
        provider_key_prefix = PROVIDER_EDGES_KEY_PREFIX):
    """
    Non-mutating importer-scoped wiring for genrule-style macros.

    Returns a struct:
      - kwargs: prepared kwargs dict ready for genrule(**kwargs)
    """
    kw = _prepare_non_mutating_kwargs(kwargs, patch_into = "srcs", provider_into = "srcs")
    base_deps = list(deps) if isinstance(deps, list) else []
    base_srcs = dict(srcs) if isinstance(srcs, dict) else list(srcs)

    kw["name"] = name
    kw["labels"] = (kw.get("labels", []) or []) + (labels or [])
    require_single_importer_lockfile_label(kw, lockfile_label)
    stamp_patch_scope_for_lang(kw, lang)
    stamp_labels(kw, lang, kind)

    is_dict_srcs = isinstance(base_srcs, dict)
    kw["srcs"] = base_srcs

    if is_dict_srcs:
        attach_importer_patch_inputs(
            kw,
            lang,
            into = "srcs",
            dict_safe = True,
            key_prefix = patch_key_prefix,
        )
        kw["srcs"] = merge_provider_edges(
            name,
            base_deps,
            into = "srcs",
            base = (kw.get("srcs", {}) or {}),
            dict_safe = True,
            key_prefix = provider_key_prefix,
            MODULE_PROVIDERS = MODULE_PROVIDERS,
        )
        prepared = kw
    else:
        attach_importer_patch_inputs(kw, lang, into = "srcs")
        merged_srcs = kw.get("srcs", []) or []
        kw["srcs"] = merge_provider_edges(
            name,
            (merged_srcs + base_deps),
            into = "srcs",
            MODULE_PROVIDERS = MODULE_PROVIDERS,
        )
        prepared = kw

    return struct(
        kwargs = prepared,
    )

def prepare_importer_srcsless_rule_wiring(
        name,
        kwargs,
        deps,
        lang,
        kind,
        labels = [],
        lockfile_label = None,
        patch_dep_into = "resources",
        patch_dep_suffix = "__patch_inputs",
        MODULE_PROVIDERS = None):
    """
    Non-mutating importer-scoped wiring for rule shapes that cannot accept srcs.

    Returns a struct:
      - importer
      - kwargs: prepared kwargs dict
      - patch_dep: synthetic dep carrying importer-local patches as action inputs
      - merge_deps(base_deps): merges provider edges deterministically and includes patch_dep
    """
    kw = _prepare_non_mutating_kwargs(kwargs, patch_into = None, provider_into = "deps")
    base_deps = list(deps) if isinstance(deps, list) else []

    kw["name"] = name
    kw["labels"] = (kw.get("labels", []) or []) + (labels or [])
    require_single_importer_lockfile_label(kw, lockfile_label)
    stamp_patch_scope_for_lang(kw, lang)
    stamp_labels(kw, lang, kind)
    importer = importer_from_labels(kw)

    patch_dep = synthetic_dep_for_importer_patches_from_labels(
        parent_name = name,
        labels = (kw.get("labels", []) or []),
        lang = lang,
        into = patch_dep_into,
        suffix = patch_dep_suffix,
    )
    def merge_deps(base_deps2):
        return merge_provider_edges(
            name,
            (list(base_deps2) if isinstance(base_deps2, list) else []) + [patch_dep.dep],
            MODULE_PROVIDERS = MODULE_PROVIDERS,
        )

    res = struct(
        importer = importer,
        kwargs = kw,
        patch_dep = patch_dep,
        merge_deps = merge_deps,
    )
    return struct(
        importer = res.importer,
        kwargs = res.kwargs,
        patch_dep = res.patch_dep,
        merge_deps = res.merge_deps,
    )

__all__ = [
    "prepare_importer_genrule_kwargs",
    "prepare_importer_non_genrule_wiring",
    "prepare_importer_srcsless_rule_wiring",
]