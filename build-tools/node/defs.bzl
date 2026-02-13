load("//build-tools/node:defs_core.bzl", _nix_node_gen = "nix_node_gen", _nix_node_test = "nix_node_test", _nix_node_lib = "nix_node_lib", _nix_node_bin = "nix_node_bin")
load("//build-tools/node:defs_nix.bzl", _node_webapp = "node_webapp", _nix_node_cli_bin = "nix_node_cli_bin")
load(
    "//build-tools/node:defs_stage.bzl",
    _node_asset_stage = "node_asset_stage",
    _node_wasm_inline_module = "node_wasm_inline_module",
)

def nix_node_gen(name, srcs = [], out = None, cmd = None, deps = [], labels = [], lockfile_label = None, patch_options = None, kind = "gen", **kwargs):
    _nix_node_gen(
        name = name,
        srcs = srcs,
        out = out,
        cmd = cmd,
        deps = deps,
        labels = labels,
        lockfile_label = lockfile_label,
        patch_options = patch_options,
        kind = kind,
        **kwargs
    )

def nix_node_test(
    name,
    srcs = [],
    out = None,
    cmd = None,
    patterns = None,
    env = {},
    timeout_sec = 600,
    deps = [],
    labels = [],
    lockfile_label = None,
    kind = "test",
    **kwargs
):
    _nix_node_test(
        name = name,
        srcs = srcs,
        out = out,
        cmd = cmd,
        patterns = patterns,
        env = env,
        timeout_sec = timeout_sec,
        deps = deps,
        labels = labels,
        lockfile_label = lockfile_label,
        kind = kind,
        **kwargs
    )

def nix_node_lib(name, patch_options = None, **kwargs):
    _nix_node_lib(name = name, patch_options = patch_options, **kwargs)

def nix_node_bin(name, **kwargs):
    _nix_node_bin(name = name, **kwargs)

def node_webapp(name, labels = [], lockfile_label = None, importer = None, out = None, **kwargs):
    _node_webapp(
        name = name,
        labels = labels,
        lockfile_label = lockfile_label,
        importer = importer,
        out = out,
        **kwargs
    )

def node_asset_stage(name, app, assets = [], out = None, **kwargs):
    _node_asset_stage(
        name = name,
        app = app,
        assets = assets,
        out = out,
        **kwargs
    )

def node_wasm_inline_module(
    name,
    src,
    out = None,
    artifact_name = None,
    artifact_glob = None,
    labels = [],
    lockfile_label = None,
    **kwargs
):
    _node_wasm_inline_module(
        name = name,
        src = src,
        out = out,
        artifact_name = artifact_name,
        artifact_glob = artifact_glob,
        labels = labels,
        lockfile_label = lockfile_label,
        **kwargs
    )

def nix_node_cli_bin(
    name,
    entry = None,
    out = None,
    labels = [],
    deps = [],
    lockfile_label = None,
    bundle = False,
    importer = None,
    **kwargs
):
    _nix_node_cli_bin(
        name = name,
        entry = entry,
        out = out,
        labels = labels,
        deps = deps,
        lockfile_label = lockfile_label,
        bundle = bundle,
        importer = importer,
        **kwargs
    )

