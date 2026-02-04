load("//build-tools/lang:dict_inputs.bzl", "GLOBAL_NIX_INPUTS_KEY_PREFIX", "PATCH_INPUTS_KEY_PREFIX", "PROVIDER_EDGES_KEY_PREFIX")
load(
    "//build-tools/lang/internal:importer_wiring.bzl",
    "prepare_importer_genrule_kwargs",
    "prepare_importer_non_genrule_wiring",
    "prepare_importer_srcsless_rule_wiring",
)
load(
    "//build-tools/lang/internal:importer_wiring_nix_calling.bzl",
    "prepare_importer_non_genrule_nix_calling_wiring",
)
load("//build-tools/lang:lang_contracts.bzl", "patch_invalidation_strategy_for_lang")
load(
    "//build-tools/lang/internal:nix_calling_importer_genrule_wiring.bzl",
    "prepare_importer_nix_calling_genrule_wiring",
)
load("//build-tools/lang/internal:package_local_wiring.bzl", "prepare_package_local_wiring")
load("//build-tools/lang:wasm_package_local_wiring.bzl", "prepare_package_local_wasm_wiring")

def _clone_labels(labels):
    if labels == None:
        return []
    if isinstance(labels, list):
        return list(labels)
    return []

def _apply_labels(kwargs, labels):
    kw = dict(kwargs) if kwargs != None else {}
    extra = _clone_labels(labels)
    if len(extra) == 0:
        return kw
    current = kw.get("labels", []) or []
    if not isinstance(current, list):
        current = []
    kw["labels"] = current + extra
    return kw

def _require_strategy(lang):
    if not isinstance(lang, str) or lang == "":
        fail("prepare_language_wiring: lang must be a non-empty string")
    strategy = patch_invalidation_strategy_for_lang(lang)
    if strategy == None:
        fail("prepare_language_wiring: unsupported lang %s" % lang)
    return strategy

def prepare_language_wiring(
        *,
        name,
        kwargs,
        lang,
        kind,
        deps = [],
        labels = [],
        lockfile_label = None,
        MODULE_PROVIDERS = None,
        wiring = "non_genrule",
        srcs = None,
        patch_into = "srcs",
        patch_base = None,
        patch_dict_safe = None,
        patch_key_prefix = PATCH_INPUTS_KEY_PREFIX,
        provider_into = "deps",
        provider_base = None,
        provider_dict_safe = None,
        provider_key_prefix = PROVIDER_EDGES_KEY_PREFIX,
        patch_dep_into = "resources",
        patch_dep_suffix = "__patch_inputs",
        global_inputs_into = None,
        global_inputs_stamp = None,
        global_inputs_key_prefix = GLOBAL_NIX_INPUTS_KEY_PREFIX,
        inject_workspace_root_env = False,
        workspace_root_env_src = "root//build-tools/tools/buck:workspace-root.env",
        wasm_variant = None,
        wasm_extra_srcs = [],
        wasm_srcs_include_deps = False,
        wasm_provider_realization_mode = "deps",
        wasm_strip_providers_from_deps = False,
        stamp = True):
    """
    Unified macro wiring entrypoint that selects package-local vs importer-scoped wiring
    using the language contract. Call sites should not branch on patch scope.
    """
    strategy = _require_strategy(lang)
    deps2 = list(deps) if isinstance(deps, list) else []

    if strategy.patch_scope == "package-local":
        kw = _apply_labels(kwargs, labels)
        if wasm_variant != None:
            return prepare_package_local_wasm_wiring(
                name = name,
                kwargs = kw,
                lang = lang,
                variant = wasm_variant,
                MODULE_PROVIDERS = MODULE_PROVIDERS,
                deps = deps2,
                extra_srcs = wasm_extra_srcs,
                srcs_include_deps = wasm_srcs_include_deps,
                provider_realization_mode = wasm_provider_realization_mode,
                strip_providers_from_deps = wasm_strip_providers_from_deps,
            )
        return prepare_package_local_wiring(
            name = name,
            kwargs = kw,
            lang = lang,
            kind = kind,
            MODULE_PROVIDERS = MODULE_PROVIDERS,
            base_deps = deps2,
            stamp = stamp,
        )

    if strategy.patch_scope != "importer-local":
        fail("prepare_language_wiring: unknown patch_scope %s for %s" % (strategy.patch_scope, lang))

    if wiring == "non_genrule":
        return prepare_importer_non_genrule_wiring(
            name = name,
            kwargs = kwargs,
            deps = deps2,
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

    if wiring == "non_genrule_nix_calling":
        global_into = global_inputs_into if global_inputs_into != None else "srcs"
        global_stamp = global_inputs_stamp if global_inputs_stamp != None else False
        return prepare_importer_non_genrule_nix_calling_wiring(
            name = name,
            kwargs = kwargs,
            deps = deps2,
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
            global_inputs_into = global_into,
            global_inputs_stamp = global_stamp,
            global_inputs_key_prefix = global_inputs_key_prefix,
        )

    if wiring == "genrule":
        if srcs == None:
            fail("prepare_language_wiring: srcs is required when wiring=genrule")
        return prepare_importer_genrule_kwargs(
            name = name,
            kwargs = kwargs,
            srcs = srcs,
            deps = deps2,
            lang = lang,
            kind = kind,
            labels = labels,
            lockfile_label = lockfile_label,
            MODULE_PROVIDERS = MODULE_PROVIDERS,
            patch_key_prefix = patch_key_prefix,
            provider_key_prefix = provider_key_prefix,
        )

    if wiring == "nix_calling_genrule":
        if srcs == None:
            fail("prepare_language_wiring: srcs is required when wiring=nix_calling_genrule")
        global_into = global_inputs_into if global_inputs_into != None else "srcs"
        global_stamp = global_inputs_stamp if global_inputs_stamp != None else True
        return prepare_importer_nix_calling_genrule_wiring(
            name = name,
            kwargs = kwargs,
            srcs = srcs,
            deps = deps2,
            lang = lang,
            kind = kind,
            labels = labels,
            lockfile_label = lockfile_label,
            MODULE_PROVIDERS = MODULE_PROVIDERS,
            patch_key_prefix = patch_key_prefix,
            provider_key_prefix = provider_key_prefix,
            inject_workspace_root_env = inject_workspace_root_env,
            workspace_root_env_src = workspace_root_env_src,
            global_inputs_into = global_into,
            global_inputs_stamp = global_stamp,
            global_inputs_key_prefix = global_inputs_key_prefix,
        )

    if wiring == "srcsless_rule":
        return prepare_importer_srcsless_rule_wiring(
            name = name,
            kwargs = kwargs,
            deps = deps2,
            lang = lang,
            kind = kind,
            labels = labels,
            lockfile_label = lockfile_label,
            patch_dep_into = patch_dep_into,
            patch_dep_suffix = patch_dep_suffix,
            MODULE_PROVIDERS = MODULE_PROVIDERS,
        )

    fail("prepare_language_wiring: unsupported wiring mode %s" % wiring)

__all__ = [
    "prepare_language_wiring",
]
