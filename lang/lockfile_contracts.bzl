"""
Lockfile contracts (Starlark side).

This file intentionally mirrors build-tools/tools/lib/lockfile-contracts.ts.
"""

LOCKFILE_BASENAMES_BY_LANG = {
    "node": ["pnpm-lock.yaml"],
    "python": ["uv.lock"],
}

def lockfile_basenames_for_lang(lang):
    if not isinstance(lang, str) or lang == "":
        return None
    return LOCKFILE_BASENAMES_BY_LANG.get(lang)

def default_lockfile_basename_for_lang(lang):
    basenames = lockfile_basenames_for_lang(lang)
    if basenames == None or len(basenames) == 0:
        fail("missing lockfile basename for lang: %s" % lang)
    return basenames[0]

def _lockfile_contract_probe_impl(ctx):
    basenames = lockfile_basenames_for_lang(ctx.attrs.lang) or []
    out = ctx.actions.declare_output(ctx.attrs.out)
    lines = ["basename:%s" % b for b in basenames]
    ctx.actions.write(out, "\n".join(lines) + "\n")
    return [DefaultInfo(default_output = out)]

_lockfile_contract_probe = rule(
    impl = _lockfile_contract_probe_impl,
    attrs = {
        "lang": attrs.string(),
        "out": attrs.string(),
    },
)

def lockfile_contract_probe(name, lang):
    _lockfile_contract_probe(
        name = name,
        lang = lang,
        out = "lockfile-contract-%s.txt" % lang,
    )

__all__ = [
    "LOCKFILE_BASENAMES_BY_LANG",
    "lockfile_basenames_for_lang",
    "default_lockfile_basename_for_lang",
    "lockfile_contract_probe",
]
