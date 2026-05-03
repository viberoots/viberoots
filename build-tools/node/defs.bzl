load("//build-tools/node:defs_core.bzl", _nix_node_gen = "nix_node_gen", _nix_node_test = "nix_node_test", _nix_node_lib = "nix_node_lib", _nix_node_bin = "nix_node_bin")
load("//build-tools/node:defs_nix.bzl", _node_webapp = "node_webapp", _nix_node_cli_bin = "nix_node_cli_bin")
load("//build-tools/node:defs_service.bzl", _node_service_artifact = "node_service_artifact")
load("//build-tools/node:defs_vercel.bzl", _node_vercel_next_artifact = "node_vercel_next_artifact")
load("//build-tools/lang:collections.bzl", "dedupe_preserve")
load("//build-tools/lang:label_stamping.bzl", "normalize_labels")
load("//build-tools/lang:module_surface.bzl", "module_surface")
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
    timeout_sec = 1800,
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
    kw = dict(kwargs)
    ts_module_roots = kw.pop("ts_module_roots", ["src"])
    _nix_node_lib(name = name, patch_options = patch_options, **kw)
    module_surface(
        name = name + "__surface",
        module_kind = "ts",
        source_roots = ts_module_roots,
        artifact_mapping_policy = "node-ts-lib-v1",
        watch_hints = ts_module_roots,
        visibility = ["PUBLIC"],
    )

def nix_node_bin(name, **kwargs):
    _nix_node_bin(name = name, **kwargs)

def _runtime_mapping_policy(labels):
    labs = labels or []
    if "framework:next" in labs:
        return "node-next-v1"
    if "framework:vite" in labs:
        return "node-vite-v1"
    return "node-static-v1"

def _normalize_module_dep_label(dep):
    if not isinstance(dep, str) or dep == "":
        fail("node_asset_stage: module_deps entries must be non-empty string labels")
    if dep.startswith(":"):
        if len(dep) == 1:
            fail("node_asset_stage: module_deps local label cannot be empty")
        return "//%s:%s" % (native.package_name(), dep[1:])
    if not dep.startswith("//"):
        fail("node_asset_stage: module_deps entries must start with // or :")
    if ":" in dep:
        return dep
    pkg = dep[2:]
    if pkg == "":
        fail("node_asset_stage: module_deps package label cannot be empty")
    pkg_parts = pkg.split("/")
    base = pkg_parts[-1]
    if base == "":
        fail("node_asset_stage: module_deps package label cannot end with '/'")
    return "%s:%s" % (dep, base)

def _surface_label_for_module_dep(dep):
    normalized = _normalize_module_dep_label(dep)
    body = normalized[2:]
    parts = body.split(":")
    if len(parts) != 2 or parts[0] == "" or parts[1] == "":
        fail("node_asset_stage: failed to normalize module_dep '%s'" % dep)
    return "//%s:%s__surface" % (parts[0], parts[1])

def node_webapp(
        name,
        labels = [],
        lockfile_label = None,
        importer = None,
        out = None,
        ts_module_roots = ["src/ts-modules"],
        **kwargs):
    _node_webapp(
        name = name,
        labels = labels,
        lockfile_label = lockfile_label,
        importer = importer,
        out = out,
        **kwargs
    )
    module_surface(
        name = name + "__ts_surface",
        module_kind = "ts",
        source_roots = ts_module_roots,
        artifact_mapping_policy = _runtime_mapping_policy(labels),
        watch_hints = ts_module_roots,
        visibility = ["PUBLIC"],
    )

def node_vercel_next_artifact(
        name,
        labels = [],
        lockfile_label = None,
        importer = None,
        vercel_config = "vercel.project.json",
        out = None,
        **kwargs):
    _node_vercel_next_artifact(
        name = name,
        labels = labels,
        lockfile_label = lockfile_label,
        importer = importer,
        vercel_config = vercel_config,
        out = out,
        **kwargs
    )

def node_service_artifact(
        name,
        labels = [],
        lockfile_label = None,
        importer = None,
        runtime_contract = "service.runtime.json",
        out = None,
        deps = [],
        **kwargs):
    _node_service_artifact(
        name = name,
        labels = labels,
        lockfile_label = lockfile_label,
        importer = importer,
        runtime_contract = runtime_contract,
        out = out,
        deps = deps,
        **kwargs
    )

def node_asset_stage(
        name,
        app,
        assets = [],
        out = None,
        deps = [],
        wasm_module_roots = [],
        module_deps = [],
        module_surface_deps = [],
        **kwargs):
    kw = dict(kwargs)
    labels = kw.get("labels", []) or []
    inferred_surface_deps = [_surface_label_for_module_dep(d) for d in module_deps]
    explicit_surface_deps = normalize_labels(native.package_name(), module_surface_deps)
    merged_surface_deps = dedupe_preserve(inferred_surface_deps + explicit_surface_deps)
    merged_deps = dedupe_preserve((deps or []) + merged_surface_deps)
    _node_asset_stage(
        name = name,
        app = app,
        assets = assets,
        out = out,
        deps = merged_deps,
        **kw
    )
    if len(wasm_module_roots) > 0:
        module_surface(
            name = name + "__wasm_surface",
            module_kind = "wasm",
            source_roots = wasm_module_roots,
            artifact_mapping_policy = _runtime_mapping_policy(labels),
            watch_hints = wasm_module_roots,
            visibility = ["PUBLIC"],
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
