load("@prelude//:rules.bzl", "genrule")
load(
    "//lang:defs_common.bzl",
    "attach_importer_patch_inputs",
    "importer_from_labels",
    "merge_provider_edges",
    "prepare_importer_genrule_kwargs",
    "require_single_importer_lockfile_label",
    "stamp_labels",
)
load("//lang:global_inputs.bzl", "attach_global_nix_inputs")
load("//node/private:nix_test.bzl", "node_nix_test")

# NOTE: Prebuild guard ensures this load is valid before builds/tests run.
MODULE_PROVIDERS = {}
load("//lang:auto_map.bzl", "MODULE_PROVIDERS")

def nix_node_gen(name, srcs = [], out = None, cmd = None, deps = [], labels = [], lockfile_label = None, kind = "gen", **kwargs):
    prepare_importer_genrule_kwargs(
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
    if out != None:
        kwargs["out"] = out
    if cmd != None:
        kwargs["cmd"] = cmd
    genrule(**kwargs)

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
    # Prepare kwargs and label stamping
    kw = { "name": name }
    kw["labels"] = labels or []
    require_single_importer_lockfile_label(kw, lockfile_label)
    stamp_labels(kw, "node", kind)

    # Derive importer from the single required lockfile label (shared helper)
    _importer = importer_from_labels(kw)

    # Include importer-local node patches as inputs so changes invalidate tests precisely
    kw["srcs"] = list(srcs)
    attach_importer_patch_inputs(kw, "node")
    attach_global_nix_inputs(kw, into = "srcs")
    merged_srcs = kw.get("srcs", []) or []

    # Forward to external runner rule; ignore legacy 'cmd'
    node_nix_test(
        name = name,
        importer = _importer,
        patterns = ([] if patterns == None else patterns),
        env = (env or {}),
        timeout_sec = timeout_sec,
        srcs = merged_srcs,
        deps = merge_provider_edges(name, deps, MODULE_PROVIDERS = MODULE_PROVIDERS),
        labels = kw.get("labels", []),
        out = (out if out != None else (name + ".stamp")),
        **kwargs
    )

def nix_node_lib(name, **kwargs):
    nix_node_gen(name = name, kind = "lib", **kwargs)

def nix_node_bin(name, **kwargs):
    nix_node_gen(name = name, kind = "bin", **kwargs)


