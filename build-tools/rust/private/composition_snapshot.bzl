load("@viberoots//build-tools/lang:remote_action_policy.bzl", "run_nix_action")
load("@viberoots//build-tools/lang:source_snapshot.bzl", "SourceSnapshotInfo")
load("@viberoots//build-tools/rust/private:crate_contract.bzl", "RustCrateInfo")

def _dedupe_artifacts(values):
    result = []
    seen = {}
    for value in values:
        key = str(value)
        if key not in seen:
            seen[key] = True
            result.append(value)
    return result

def _rooted_path(cargo_root, source):
    relative = source.short_path
    prefix = cargo_root + "/"
    return relative if relative.startswith(prefix) else prefix + relative

def _closure_entries(deps):
    entries = []
    for dep in deps:
        if RustCrateInfo in dep:
            entries.extend(dep[RustCrateInfo].closure_entries)
    return entries

def _entry_artifacts(entries):
    values = []
    for entry in entries:
        values.extend(entry.sources)
        values.extend([entry.manifest, entry.lock])
    return _dedupe_artifacts(values)

def _entry_args(entry):
    return [
        "--rust-composition-entry",
        entry.label,
        entry.cargo_root,
        _rooted_path(entry.cargo_root, entry.manifest),
        _rooted_path(entry.cargo_root, entry.lock),
        entry.lock_identity,
        entry.public_crate,
        entry.crate_type,
        entry.host_role,
        entry.package_id,
        entry.manifest,
        str(len(entry.generated_outputs)),
    ] + entry.generated_outputs

def _rust_composition_snapshot_impl(ctx):
    base_snapshot = ctx.attrs.base_snapshot
    base_manifest = ctx.attrs.base_manifest
    graph = ctx.attrs.graph
    if ctx.attrs.base_bundle != None:
        if base_snapshot != None or base_manifest != None:
            fail("base_bundle cannot be combined with base_snapshot or base_manifest")
        info = ctx.attrs.base_bundle[SourceSnapshotInfo]
        base_snapshot = info.snapshot
        base_manifest = info.manifest
        graph = info.graph
    if base_snapshot == None or base_manifest == None:
        fail("Rust composition snapshot requires both a snapshot and manifest")
    snapshot = ctx.actions.declare_output(ctx.label.name + ".source-snapshot", dir = True)
    manifest = ctx.actions.declare_output(ctx.label.name + ".source-snapshot.manifest.json")
    dependency_entries = _closure_entries(ctx.attrs.deps)
    owner_entry = struct(
        label = ctx.attrs.owner_label,
        cargo_root = ctx.attrs.cargo_root,
        package_id = ctx.attrs.cargo_package,
        sources = ctx.attrs.srcs,
        manifest = ctx.attrs.cargo_manifest,
        lock = ctx.attrs.cargo_lock,
        lock_identity = ctx.attrs.cargo_lock_identity,
        public_crate = ctx.attrs.public_crate,
        crate_type = ctx.attrs.crate_type,
        host_role = ctx.attrs.host_role,
        generated_outputs = ctx.attrs.generated_outputs,
    )
    entries = dependency_entries + [owner_entry]
    closure = _dedupe_artifacts(_entry_artifacts(entries))
    args = [
        ctx.attrs._runner[RunInfo],
        "--out",
        snapshot.as_output(),
        "--manifest",
        manifest.as_output(),
        "--graph",
        graph,
        "--declared-root",
        snapshot.as_output(),
        "--declared-graph",
        graph,
        "--tree",
        base_snapshot,
    ]
    for entry in entries:
        args.extend(_entry_args(entry))
        entry_sources = entry.sources + [entry.manifest, entry.lock]
        option = "--require-matching-file" if entry.label == ctx.attrs.owner_label else "--file"
        for source in entry_sources:
            args.extend([option, _rooted_path(entry.cargo_root, source), source])
    declared = [
        ctx.attrs._runner[DefaultInfo].default_outputs,
        base_snapshot,
        base_manifest,
        graph,
    ] + closure
    run_nix_action(
        ctx,
        cmd_args(args, hidden = declared),
        "rust_composition_snapshot",
        declared_inputs = declared,
        publication = "orchestration",
        mode = "local-only",
    )
    return [
        DefaultInfo(default_output = snapshot, other_outputs = [manifest]),
        SourceSnapshotInfo(snapshot = snapshot, manifest = manifest, graph = graph),
    ]

rust_composition_snapshot = rule(
    impl = _rust_composition_snapshot_impl,
    attrs = {
        "base_bundle": attrs.option(attrs.dep(providers = [SourceSnapshotInfo]), default = None),
        "base_snapshot": attrs.option(attrs.source(), default = None),
        "base_manifest": attrs.option(attrs.source(), default = None),
        "deps": attrs.list(attrs.dep(), default = []),
        "owner_label": attrs.string(),
        "cargo_root": attrs.string(),
        "cargo_package": attrs.string(),
        "cargo_manifest": attrs.source(),
        "cargo_lock": attrs.source(),
        "cargo_lock_identity": attrs.string(),
        "public_crate": attrs.string(),
        "crate_type": attrs.string(),
        "host_role": attrs.string(),
        "generated_outputs": attrs.list(attrs.string()),
        "srcs": attrs.list(attrs.source(), default = []),
        "graph": attrs.source(default = "workspace_buck//:graph.json"),
        "_runner": attrs.dep(
            default = "@viberoots//build-tools/tools/dev:source-snapshot-runner",
            providers = [RunInfo],
        ),
    },
)

__all__ = ["rust_composition_snapshot"]
