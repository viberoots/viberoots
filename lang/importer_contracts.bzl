"""
Importer-scoped contract surface (Starlark side).

This file intentionally mirrors build-tools/tools/lib/lang-contracts.ts for importer patch inclusion policy.
"""

IMPORTER_PATCH_INCLUSION_BY_LANG = {
    "node": "all",
    "python": "effective-set-only",
}

def importer_patch_inclusion_for_lang(lang):
    if not isinstance(lang, str) or lang == "":
        return None
    return IMPORTER_PATCH_INCLUSION_BY_LANG.get(lang)

def _importer_contract_probe_impl(ctx):
    policy = importer_patch_inclusion_for_lang(ctx.attrs.lang)
    out = ctx.actions.declare_output(ctx.attrs.out)
    if policy == None:
        ctx.actions.write(out, "missing\n")
    else:
        ctx.actions.write(out, "importer_patch_inclusion:%s\n" % policy)
    return [DefaultInfo(default_output = out)]

_importer_contract_probe = rule(
    impl = _importer_contract_probe_impl,
    attrs = {
        "lang": attrs.string(),
        "out": attrs.string(),
    },
)

def importer_contract_probe(name, lang):
    _importer_contract_probe(
        name = name,
        lang = lang,
        out = "importer-contract-%s.txt" % lang,
    )

__all__ = [
    "IMPORTER_PATCH_INCLUSION_BY_LANG",
    "importer_patch_inclusion_for_lang",
    "importer_contract_probe",
]
