RustCrateInfo = provider(fields = [
    "cargo_root",
    "package_id",
    "member_manifest",
    "lock",
    "lock_identity",
    "sources",
    "features",
    "target",
    "profile",
    "pyemscripten_abi",
    "public_crate",
    "crate_type",
    "host_role",
    "generated_outputs",
    "closure_sources",
    "closure_manifests",
    "closure_locks",
    "closure_entries",
])

def _dedupe_artifacts(values):
    result = []
    seen = {}
    for value in values:
        key = str(value)
        if key not in seen:
            seen[key] = True
            result.append(value)
    return result

def rust_crate_info(ctx):
    closure_sources = list(ctx.attrs.srcs)
    closure_manifests = [ctx.attrs.cargo_manifest]
    closure_locks = [ctx.attrs.cargo_lock]
    closure_entries = []
    for dep in ctx.attrs.deps:
        if RustCrateInfo in dep:
            info = dep[RustCrateInfo]
            closure_sources.extend(info.closure_sources)
            closure_manifests.extend(info.closure_manifests)
            closure_locks.extend(info.closure_locks)
            closure_entries.extend(info.closure_entries)
    closure_entries.append(struct(
        label = str(ctx.label),
        cargo_root = ctx.attrs.cargo_root or ctx.label.package,
        package_id = ctx.attrs.cargo_package or ctx.attrs.crate,
        sources = ctx.attrs.srcs,
        manifest = ctx.attrs.cargo_manifest,
        lock = ctx.attrs.cargo_lock,
        lock_identity = ctx.attrs.cargo_lock_identity or str(ctx.attrs.cargo_lock),
        public_crate = ctx.attrs.public_crate or ctx.attrs.crate,
        crate_type = ctx.attrs.crate_type,
        host_role = ctx.attrs.host_role,
        generated_outputs = ctx.attrs.generated_outputs or [ctx.attrs.out],
    ))
    return RustCrateInfo(
        cargo_root = ctx.attrs.cargo_root or ctx.label.package,
        package_id = ctx.attrs.cargo_package or ctx.attrs.crate,
        member_manifest = ctx.attrs.cargo_manifest,
        lock = ctx.attrs.cargo_lock,
        lock_identity = ctx.attrs.cargo_lock_identity or str(ctx.attrs.cargo_lock),
        sources = ctx.attrs.srcs,
        features = ctx.attrs.features,
        target = ctx.attrs.target,
        profile = ctx.attrs.profile,
        pyemscripten_abi = ctx.attrs.pyemscripten_abi,
        public_crate = ctx.attrs.public_crate or ctx.attrs.crate,
        crate_type = ctx.attrs.crate_type,
        host_role = ctx.attrs.host_role,
        generated_outputs = ctx.attrs.generated_outputs or [ctx.attrs.out],
        closure_sources = _dedupe_artifacts(closure_sources),
        closure_manifests = _dedupe_artifacts(closure_manifests),
        closure_locks = _dedupe_artifacts(closure_locks),
        closure_entries = closure_entries,
    )

def rust_crate_closure_inputs(ctx):
    sources = []
    manifests = []
    locks = []
    for dep in ctx.attrs.deps:
        if RustCrateInfo in dep:
            info = dep[RustCrateInfo]
            sources.extend(info.closure_sources)
            manifests.extend(info.closure_manifests)
            locks.extend(info.closure_locks)
    return _dedupe_artifacts(sources + manifests + locks)

def rust_crate_contract_attrs():
    return {
        "cargo_root": attrs.string(default = ""),
        "cargo_package": attrs.string(default = ""),
        "cargo_lock_identity": attrs.string(default = ""),
        "pyemscripten_abi": attrs.string(default = ""),
        "public_crate": attrs.string(default = ""),
        "crate_type": attrs.string(default = "rlib"),
        "host_role": attrs.string(default = "target"),
        "generated_outputs": attrs.list(attrs.string(), default = []),
    }

__all__ = [
    "RustCrateInfo",
    "rust_crate_closure_inputs",
    "rust_crate_contract_attrs",
    "rust_crate_info",
]
