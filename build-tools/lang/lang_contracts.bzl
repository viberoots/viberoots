"""
Language contracts (Starlark side).

This file intentionally mirrors `build-tools/tools/lib/lang-contracts.ts` for the subset of
contracts that must be usable at macro/probe time.

Patch invalidation strategy is a cross-language contract:
- package-local: patch files live under the owning Buck package and are included as action inputs.
- importer-local: patch files live under an importer directory; applying/removing patches requires glue refresh.
"""

PatchInvalidationStrategy = struct

# Canonical patch invalidation strategy mapping (Starlark view).
#
# Keep this in parity with:
# - `build-tools/tools/lib/lang-contracts.ts` (TS)
# - `build-tools/tools/tests/lang/lang-contracts.patch-model.parity.test.ts` (parity test)
PATCH_INVALIDATION_STRATEGY_BY_LANG = {
    "go": PatchInvalidationStrategy(patch_scope = "package-local", glue_on_apply_remove = False),
    "cpp": PatchInvalidationStrategy(patch_scope = "package-local", glue_on_apply_remove = False),
    "rust": PatchInvalidationStrategy(patch_scope = "package-local", glue_on_apply_remove = False),
    "node": PatchInvalidationStrategy(patch_scope = "importer-local", glue_on_apply_remove = True),
    "python": PatchInvalidationStrategy(patch_scope = "importer-local", glue_on_apply_remove = True),
}


def patch_invalidation_strategy_for_lang(lang):
    """
    Returns PatchInvalidationStrategy or None.
    """
    return PATCH_INVALIDATION_STRATEGY_BY_LANG.get(lang)


# Test-only probe: materialize the contract for a language as an artifact.
def _lang_contract_probe_impl(ctx):
    s = patch_invalidation_strategy_for_lang(ctx.attrs.lang)
    out = ctx.actions.declare_output(ctx.attrs.out)
    if s == None:
        ctx.actions.write(out, "missing\n")
    else:
        ctx.actions.write(
            out,
            "patch_scope:%s\nglue_on_apply_remove:%s\n" % (
                s.patch_scope,
                "true" if s.glue_on_apply_remove else "false",
            ),
        )
    return [DefaultInfo(default_output = out)]


_lang_contract_probe = rule(
    impl = _lang_contract_probe_impl,
    attrs = {
        "lang": attrs.string(),
        "out": attrs.string(),
    },
)


def lang_contract_probe(name, lang):
    _lang_contract_probe(
        name = name,
        lang = lang,
        out = "lang-contract-%s.txt" % lang,
    )


__all__ = [
    "PATCH_INVALIDATION_STRATEGY_BY_LANG",
    "patch_invalidation_strategy_for_lang",
    "lang_contract_probe",
]


