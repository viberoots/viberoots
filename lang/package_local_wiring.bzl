load("//lang:macro_kwargs.bzl", "pop_package_local_patch_dirs_and_nixpkg_deps")
load("//lang:patch_inputs.bzl", "include_package_local_patches")
load("//lang:label_stamping.bzl", "stamp_labels")
load("//lang:provider_edges.bzl", "realize_provider_edges", "target_key_for_current_package")
load("@prelude//:rules.bzl", "genrule")

def prepare_package_local_wiring(
        *,
        name,
        kwargs,
        lang,
        MODULE_PROVIDERS,
        base_deps,
        kind = None,
        stamp = True):
    """
    Shared macro wiring helper for package-local patching languages.

    This helper composes:
    - pop `local_patch_dirs` (default: `default_package_patch_dirs(lang)`)
    - pop `nixpkg_deps` and append normalized `nixpkg:*` labels
    - stamp `lang:*` and `kind:*` labels (optional; set stamp=False when another stamper is used)
    - include package-local patch files as action inputs (via `include_package_local_patches`)
    - realize provider edges deterministically (via `realize_provider_edges`)

    Returns a struct: { local_patch_dirs, nixpkg_deps, deps }.
    """
    if not isinstance(name, str) or name == "":
        fail("prepare_package_local_wiring: name must be a non-empty string")
    if not isinstance(kwargs, dict):
        fail("prepare_package_local_wiring: kwargs must be a dict")
    if not isinstance(lang, str) or lang == "":
        fail("prepare_package_local_wiring: lang must be a non-empty string")
    if not isinstance(base_deps, list):
        fail("prepare_package_local_wiring: base_deps must be a list")

    info = pop_package_local_patch_dirs_and_nixpkg_deps(kwargs, lang, append_labels = True)
    if stamp and kind != None:
        stamp_labels(kwargs, lang, kind)
    include_package_local_patches(kwargs, lang, info.local_patch_dirs)
    deps = realize_provider_edges(MODULE_PROVIDERS, name, base = base_deps)
    return struct(
        local_patch_dirs = info.local_patch_dirs,
        nixpkg_deps = info.nixpkg_deps,
        deps = deps,
    )

def package_local_wiring_probe(
        name,
        lang,
        kind,
        base_deps = [],
        providers = [],
        local_patch_dirs = None,
        nixpkg_deps = None,
        stamp = True):
    """
    Probe helper for tests. Writes a newline-delimited file of:
    - dep:<dep> (in returned order)
    - label:<label> (post-stamping + nixpkg label append)
    - src:<src> (post patch inclusion)
    """
    kw = {}
    if local_patch_dirs != None:
        kw["local_patch_dirs"] = local_patch_dirs
    if nixpkg_deps != None:
        kw["nixpkg_deps"] = nixpkg_deps

    MODULE_PROVIDERS = {
        target_key_for_current_package(name): providers,
    }
    info = prepare_package_local_wiring(
        name = name,
        kwargs = kw,
        lang = lang,
        kind = kind,
        MODULE_PROVIDERS = MODULE_PROVIDERS,
        base_deps = base_deps,
        stamp = stamp,
    )
    out = []
    for d in info.deps:
        out.append("dep:%s" % d)
    for l in (kw.get("labels", []) or []):
        out.append("label:%s" % l)
    for s in (kw.get("srcs", []) or []):
        out.append("src:%s" % s)
    genrule(
        name = name,
        srcs = kw.get("srcs", []) or [],
        out = name + ".items.txt",
        cmd = "cat > $OUT <<'EOF'\n%s\nEOF" % "\n".join(out),
        labels = ["kind:probe"],
    )

__all__ = [
    "prepare_package_local_wiring",
    "package_local_wiring_probe",
]


