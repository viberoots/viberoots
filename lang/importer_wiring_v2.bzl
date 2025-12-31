load("//lang:dict_inputs.bzl", "PATCH_INPUTS_KEY_PREFIX", "PROVIDER_EDGES_KEY_PREFIX")
load(
    "//lang:importer_wiring.bzl",
    "prepare_importer_genrule_kwargs_legacy_mutating",
    "prepare_importer_non_genrule_wiring_legacy_mutating",
    "prepare_importer_srcsless_rule_wiring_legacy_mutating",
)
load("@prelude//:rules.bzl", "genrule")

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
    Non-mutating variant of prepare_importer_non_genrule_wiring.

    Returns a struct:
      - importer
      - kwargs: prepared kwargs dict
      - deps: provider edges realized deterministically (when provider_into == "deps")
    """
    kw = _prepare_non_mutating_kwargs(kwargs, patch_into, provider_into)
    base_deps = list(deps) if isinstance(deps, list) else []
    res = prepare_importer_non_genrule_wiring_legacy_mutating(
        name = name,
        kwargs = kw,
        deps = base_deps,
        lang = lang,
        kind = kind,
        labels = labels,
        lockfile_label = lockfile_label,
        patch_into = patch_into,
        patch_base = patch_base,
        patch_dict_safe = patch_dict_safe,
        patch_key_prefix = patch_key_prefix,
        provider_into = provider_into,
        provider_base = provider_base,
        provider_dict_safe = provider_dict_safe,
        provider_key_prefix = provider_key_prefix,
        MODULE_PROVIDERS = MODULE_PROVIDERS,
    )
    return struct(
        importer = res["importer"],
        kwargs = res["kwargs"],
        deps = res["deps"],
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
    Non-mutating variant of prepare_importer_genrule_kwargs.

    Returns a struct:
      - kwargs: prepared kwargs dict ready for genrule(**kwargs)
    """
    kw = _prepare_non_mutating_kwargs(kwargs, patch_into = "srcs", provider_into = "srcs")
    base_deps = list(deps) if isinstance(deps, list) else []
    base_srcs = dict(srcs) if isinstance(srcs, dict) else list(srcs)
    prepared = prepare_importer_genrule_kwargs_legacy_mutating(
        name = name,
        kwargs = kw,
        srcs = base_srcs,
        deps = base_deps,
        lang = lang,
        kind = kind,
        labels = labels,
        lockfile_label = lockfile_label,
        MODULE_PROVIDERS = MODULE_PROVIDERS,
        patch_key_prefix = patch_key_prefix,
        provider_key_prefix = provider_key_prefix,
    )
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
    Non-mutating variant of prepare_importer_srcsless_rule_wiring.

    Returns a struct:
      - importer
      - kwargs: prepared kwargs dict
      - patch_dep: synthetic dep carrying importer-local patches as action inputs
      - merge_deps(base_deps): merges provider edges deterministically and includes patch_dep
    """
    kw = _prepare_non_mutating_kwargs(kwargs, patch_into = None, provider_into = "deps")
    base_deps = list(deps) if isinstance(deps, list) else []
    res = prepare_importer_srcsless_rule_wiring_legacy_mutating(
        name = name,
        kwargs = kw,
        deps = base_deps,
        lang = lang,
        kind = kind,
        labels = labels,
        lockfile_label = lockfile_label,
        patch_dep_into = patch_dep_into,
        patch_dep_suffix = patch_dep_suffix,
        MODULE_PROVIDERS = MODULE_PROVIDERS,
    )
    return struct(
        importer = res.importer,
        kwargs = res.kwargs,
        patch_dep = res.patch_dep,
        merge_deps = res.merge_deps,
    )

def importer_wiring_mutation_probe(name, lang, kind):
    """
    Probe helper for tests. Asserts importer wiring v2 does not mutate the input dict.
    """
    kw = {"labels": ["probe:v2"]}
    def _has_prefix(xs, prefix):
        for x in xs:
            if isinstance(x, str) and x.startswith(prefix):
                return True
        return False
    pre_labels = kw.get("labels", []) or []
    pre = {
        "srcs": "srcs" in kw,
        "labels_has_patch_scope": _has_prefix(pre_labels, "patch_scope:"),
        "labels_has_lockfile": _has_prefix(pre_labels, "lockfile:"),
    }
    _ = prepare_importer_non_genrule_wiring(
        name = name,
        kwargs = kw,
        deps = [],
        lang = lang,
        kind = kind,
        lockfile_label = "lockfile:apps/demo/uv.lock#apps/demo",
        MODULE_PROVIDERS = {},
    )
    post_labels = kw.get("labels", []) or []
    post = {
        "srcs": "srcs" in kw,
        "labels_has_patch_scope": _has_prefix(post_labels, "patch_scope:"),
        "labels_has_lockfile": _has_prefix(post_labels, "lockfile:"),
    }

    out = []
    for k in ["srcs", "labels_has_patch_scope", "labels_has_lockfile"]:
        out.append("pre:%s:%s" % (k, "true" if pre[k] else "false"))
        out.append("post:%s:%s" % (k, "true" if post[k] else "false"))

    genrule(
        name = name,
        srcs = [],
        out = name + ".items.txt",
        cmd = "cat > $OUT <<'EOF'\n%s\nEOF" % "\n".join(out),
        labels = ["kind:probe"],
    )

__all__ = [
    "prepare_importer_genrule_kwargs",
    "prepare_importer_non_genrule_wiring",
    "prepare_importer_srcsless_rule_wiring",
    "importer_wiring_mutation_probe",
]


