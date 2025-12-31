load("@prelude//:rules.bzl", "genrule")
load(
    "//lang:defs_common.bzl",
    "prepare_importer_genrule_kwargs",
    "prepare_importer_non_genrule_nix_calling_wiring",
)
load("//node/private:nix_test.bzl", "node_nix_test")

# NOTE: Prebuild guard ensures this load is valid before builds/tests run.
MODULE_PROVIDERS = {}
load("//lang:auto_map.bzl", "MODULE_PROVIDERS")

def nix_node_gen(name, srcs = [], out = None, cmd = None, deps = [], labels = [], lockfile_label = None, kind = "gen", **kwargs):
    wiring = prepare_importer_genrule_kwargs(
        name = name,
        kwargs = kwargs,
        srcs = srcs,
        deps = deps,
        lang = "node",
        kind = kind,
        labels = labels,
        lockfile_label = lockfile_label,
        MODULE_PROVIDERS = MODULE_PROVIDERS,
    )
    kw = wiring.kwargs
    if out != None:
        kw["out"] = out
    if cmd != None:
        kw["cmd"] = cmd
    genrule(**kw)

def nix_node_test(
    name,
    # Backward-compat args (ignored by runner; 'out' forwarded for stamp name)
    srcs = [],
    out = None,
    cmd = None,
    # New runner args
    patterns = None,
    env = {},
    timeout_sec = 600,
    deps = [],
    labels = [],
    lockfile_label = None,
    kind = "test",
    **kwargs
):
    wiring = prepare_importer_non_genrule_nix_calling_wiring(
        name = name,
        kwargs = {},
        deps = deps,
        lang = "node",
        kind = kind,
        labels = (labels or []),
        lockfile_label = lockfile_label,
        patch_into = "srcs",
        patch_base = list(srcs),
        MODULE_PROVIDERS = MODULE_PROVIDERS,
        global_inputs_into = "srcs",
        global_inputs_stamp = False,
    )
    kw = wiring.kwargs

    # Forward to external runner rule; ignore legacy 'cmd'
    node_nix_test(
        name = name,
        importer = wiring.importer,
        patterns = ([] if patterns == None else patterns),
        env = (env or {}),
        timeout_sec = timeout_sec,
        srcs = (kw.get("srcs", []) or []),
        deps = wiring.deps,
        labels = kw.get("labels", []),
        out = (out if out != None else (name + ".stamp")),
        **kwargs
    )

def nix_node_lib(name, **kwargs):
    nix_node_gen(name = name, kind = "lib", **kwargs)

def nix_node_bin(name, **kwargs):
    nix_node_gen(name = name, kind = "bin", **kwargs)


