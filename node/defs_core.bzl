load("@prelude//:rules.bzl", "genrule")
load(
    "//lang:defs_common.bzl",
    "attach_importer_patch_inputs",
    "dedupe_preserve",
    "importer_from_labels",
    "merge_provider_edges",
    "require_single_importer_lockfile_label",
    "stamp_labels",
)
load("//lang:global_inputs.bzl", "global_nix_inputs")
load("//node/private:nix_test.bzl", "node_nix_test")

# NOTE: Prebuild guard ensures this load is valid before builds/tests run.
MODULE_PROVIDERS = {}
load("//lang:auto_map.bzl", "MODULE_PROVIDERS")

def nix_node_gen(name, srcs = [], out = None, cmd = None, deps = [], labels = [], lockfile_label = None, kind = "gen", **kwargs):
    kwargs["name"] = name
    # Merge explicit deps and provider deps into srcs so edges are realized even if genrule doesn't support `deps`.
    _srcs_is_dict = isinstance(srcs, dict)
    merged_srcs = (dict(srcs) if _srcs_is_dict else list(srcs))
    kwargs["labels"] = labels
    require_single_importer_lockfile_label(kwargs, lockfile_label)
    stamp_labels(kwargs, "node", kind)
    if _srcs_is_dict:
        kwargs["srcs"] = merged_srcs
        attach_importer_patch_inputs(kwargs, "node", into = "srcs", dict_safe = True, key_prefix = "__patch_inputs__")
        kwargs["srcs"] = merge_provider_edges(
            name,
            deps,
            into = "srcs",
            base = kwargs.get("srcs", {}),
            dict_safe = True,
            key_prefix = "__provider_edges__",
            MODULE_PROVIDERS = MODULE_PROVIDERS,
        )
    else:
        # Include importer-local node patches in srcs so Buck invalidates precisely on patch changes
        kwargs["srcs"] = merged_srcs
        attach_importer_patch_inputs(kwargs, "node")
        merged_srcs = kwargs.get("srcs", [])
        merged_srcs = merge_provider_edges(
            name,
            (merged_srcs + deps),
            into = "srcs",
            MODULE_PROVIDERS = MODULE_PROVIDERS,
        )
        kwargs["srcs"] = merged_srcs
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
    merged_srcs = list(srcs)
    kw["srcs"] = merged_srcs
    attach_importer_patch_inputs(kw, "node")
    merged_srcs = dedupe_preserve(kw.get("srcs", []) or [])
    merged_srcs = dedupe_preserve(merged_srcs + global_nix_inputs())

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


