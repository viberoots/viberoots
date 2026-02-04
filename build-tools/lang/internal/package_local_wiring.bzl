load("//build-tools/lang:macro_kwargs.bzl", "extract_package_local_patch_dirs_and_nixpkg_deps")
load("//build-tools/lang:patch_inputs.bzl", "include_package_local_patches")
load("//build-tools/lang:label_stamping.bzl", "stamp_labels", "stamp_patch_scope_for_lang")
load("//build-tools/lang:provider_edges.bzl", "merge_provider_edges", "target_key_for_current_package")
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
    Non-mutating variant of prepare_package_local_wiring.

    Returns a struct:
      - kwargs: prepared kwargs dict for the underlying rule call
      - local_patch_dirs
      - nixpkg_deps
      - deps: provider edges realized deterministically, preserving base_deps order
    """
    if not isinstance(name, str) or name == "":
        fail("prepare_package_local_wiring: name must be a non-empty string")
    if not isinstance(kwargs, dict):
        fail("prepare_package_local_wiring: kwargs must be a dict")
    if not isinstance(lang, str) or lang == "":
        fail("prepare_package_local_wiring: lang must be a non-empty string")
    if not isinstance(base_deps, list):
        fail("prepare_package_local_wiring: base_deps must be a list")

    info = extract_package_local_patch_dirs_and_nixpkg_deps(kwargs, lang, append_labels = True)
    kw = info.kwargs
    stamp_patch_scope_for_lang(kw, lang)
    if stamp and kind != None:
        stamp_labels(kw, lang, kind)
    include_package_local_patches(kw, lang, info.local_patch_dirs)
    deps = merge_provider_edges(name, base_deps, MODULE_PROVIDERS = MODULE_PROVIDERS)
    return struct(
        kwargs = kw,
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
    for l in (info.kwargs.get("labels", []) or []):
        out.append("label:%s" % l)
    for s in (info.kwargs.get("srcs", []) or []):
        out.append("src:%s" % s)
    genrule(
        name = name,
        srcs = info.kwargs.get("srcs", []) or [],
        out = name + ".items.txt",
        cmd = "cat > $OUT <<'EOF'\n%s\nEOF" % "\n".join(out),
        labels = ["kind:probe"],
    )

def package_local_wiring_mutation_probe(
        name,
        lang,
        kind,
        base_deps = [],
        providers = [],
        local_patch_dirs = None,
        nixpkg_deps = None):
    """
    Probe helper for tests. Asserts the v2 helper does not mutate the input dict.

    Writes a newline-delimited file of:
      - pre_has:<key>:true|false
      - post_has:<key>:true|false
    """
    kw = {
        "labels": ["probe:v2"],
    }
    if local_patch_dirs != None:
        kw["local_patch_dirs"] = local_patch_dirs
    if nixpkg_deps != None:
        kw["nixpkg_deps"] = nixpkg_deps

    pre_keys = {
        "local_patch_dirs": "local_patch_dirs" in kw,
        "nixpkg_deps": "nixpkg_deps" in kw,
    }
    MODULE_PROVIDERS = {
        target_key_for_current_package(name): providers,
    }
    _ = prepare_package_local_wiring(
        name = name,
        kwargs = kw,
        lang = lang,
        kind = kind,
        MODULE_PROVIDERS = MODULE_PROVIDERS,
        base_deps = base_deps,
    )
    post_keys = {
        "local_patch_dirs": "local_patch_dirs" in kw,
        "nixpkg_deps": "nixpkg_deps" in kw,
    }

    out = []
    for k in ["local_patch_dirs", "nixpkg_deps"]:
        out.append("pre_has:%s:%s" % (k, "true" if pre_keys[k] else "false"))
        out.append("post_has:%s:%s" % (k, "true" if post_keys[k] else "false"))

    genrule(
        name = name,
        srcs = [],
        out = name + ".items.txt",
        cmd = "cat > $OUT <<'EOF'\n%s\nEOF" % "\n".join(out),
        labels = ["kind:probe"],
    )

__all__ = [
    "prepare_package_local_wiring",
    "package_local_wiring_probe",
    "package_local_wiring_mutation_probe",
]
