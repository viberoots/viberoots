load("@prelude//:rules.bzl", "genrule")
load("//build-tools/lang:defs_common.bzl", "default_lockfile_label_from_package", "default_lockfile_path_from_package", "ensure_default_lockfile_exists", "extract_lockfile_labels", "prepare_language_wiring")
load("//build-tools/lang:nix_shell.bzl", "nix_build_out_path_cmd", "nix_calling_env_export_buck_graph_json", "nix_calling_genrule_bootstrap", "nix_calling_node_patch_requirements_preflight")
load("//build-tools/node/private:wasm_source_resolver.bzl", "asset_with_selector", "sh_quote", "validate_wasm_selector_args", "wasm_source_resolver_shell")
MODULE_PROVIDERS = {}
load("//build-tools/lang:auto_map.bzl", "MODULE_PROVIDERS")
def _is_label_ref(v):
    return isinstance(v, str) and (v.startswith("//") or v.startswith(":"))
def _to_abs_label(v):
    if v.startswith(":"):
        return "//%s:%s" % (native.package_name(), v[1:])
    return v
def _label_package(v):
    if not _is_label_ref(v):
        return ""
    if v.startswith(":"):
        return native.package_name()
    trimmed = v[2:]
    i = trimmed.find(":")
    if i < 0:
        return trimmed
    return trimmed[:i]
def _apply_default_lockfile_label(lockfile_label, labels, macro_name):
    if (lockfile_label == None or lockfile_label == "") and len(extract_lockfile_labels(labels or [])) == 0:
        default_path = default_lockfile_path_from_package()
        ensure_default_lockfile_exists(default_path, macro_name)
        return default_lockfile_label_from_package()
    return lockfile_label
def _prepare_node_nix_calling_genrule(name, kwargs, srcs, deps, labels, lockfile_label):
    return prepare_language_wiring(
        name = name,
        kwargs = kwargs,
        srcs = srcs,
        deps = deps,
        lang = "node",
        kind = "gen",
        labels = labels,
        lockfile_label = lockfile_label,
        MODULE_PROVIDERS = MODULE_PROVIDERS,
        inject_workspace_root_env = True,
        global_inputs_into = "srcs",
        global_inputs_stamp = True,
        wiring = "nix_calling_genrule",
    )
def _selected_route_build_cmd(selected_route_target):
    return (
        ("BNX_NODE_ROUTE_TARGET=%s; " % sh_quote(selected_route_target))
        + "if [ -n \"$BNX_NODE_ROUTE_TARGET\" ]; then "
        + nix_build_out_path_cmd(
            "\"path:$WORKSPACE_ROOT#graph-generator-selected\"",
            timeout_var = "TIMEOUT",
            impure = True,
            build_prefix = "env BUCK_TEST_SRC=\"$WORKSPACE_ROOT\" BUCK_TARGET=\"$BNX_NODE_ROUTE_TARGET\" ",
        )
        + "fi; "
    )

def node_asset_stage(
        name,
        app,
        assets = [],
        out = None,
        deps = [],
        labels = [],
        lockfile_label = None,
        **kwargs):
    if app == None or app == "":
        fail("node_asset_stage: app is required")
    if out == None:
        out = "dist"
    lockfile_label = _apply_default_lockfile_label(lockfile_label, labels, "node_asset_stage")
    app_ref = app
    app_pkg = ""
    selected_route_target = ""
    if _is_label_ref(app):
        app_ref = "$(location %s)" % _to_abs_label(app)
        app_pkg = _label_package(app)

    stage_srcs = [app]
    copy_assets = []
    for a in assets:
        selected = asset_with_selector(a)
        src = selected.src
        dest = selected.dest
        stage_srcs.append(src)
        copy_assets.append(
            "if [ \"$#\" -lt 1 ]; then "
            + ("echo \"node_asset_stage: missing staged asset input for %s\" >&2; exit 2; " % src)
            + "fi; "
            + "ASSET_HINT=\"$1\"; shift; "
            + ("ASSET_RAW=%s; " % sh_quote(src))
            + ("ASSET_NAME=%s; " % sh_quote(selected.artifact_name))
            + ("ASSET_GLOB=%s; " % sh_quote(selected.artifact_glob))
            + "if resolve_node_source_path node_asset_stage \"$ASSET_RAW\" \"$ASSET_HINT\"; then "
            + "ASSET_SRC=\"$BNX_WASM_RESOLVED_PATH\"; "
            + "else ASSET_SRC=\"$SRCDIR\"; fi; "
            + "resolve_node_wasm_artifact node_asset_stage \"$ASSET_RAW\" \"$ASSET_SRC\" \"$ASSET_NAME\" \"$ASSET_GLOB\" || exit $?; "
            + "ASSET_SRC=\"$BNX_WASM_RESOLVED_PATH\"; "
            + ("DEST=\"$OUT_ABS/%s\"; " % dest)
            + "if [ -e \"$DEST\" ] && [ ! -f \"$DEST\" ]; then "
            + "echo \"node_asset_stage: destination is not a file: $DEST\" >&2; exit 2; "
            + "fi; "
            + "DEST_DIR=\"${DEST%/*}\"; "
            + "if [ \"$DEST_DIR\" = \"$DEST\" ]; then DEST_DIR=\"$OUT_ABS\"; fi; "
            + "mkdir -p \"$DEST_DIR\"; "
            + "cp -f \"$ASSET_SRC\" \"$DEST\"; "
        )

    cmd = (
        "SCRATCH=\"$PWD\"; OUT_ABS=\"$SCRATCH/$OUT\"; "
        + nix_calling_genrule_bootstrap(
            timeout_var = "TIMEOUT",
            timeout_sec = 240,
            include_pnpm_store = False,
            source_workspace_root_env = True,
        )
        + nix_calling_env_export_buck_graph_json()
        + nix_calling_node_patch_requirements_preflight(native.package_name())
        + _selected_route_build_cmd(selected_route_target)
        + wasm_source_resolver_shell()
        + "if [ -n \"$SRCDIR\" ] && [ \"${SRCDIR#/}\" = \"$SRCDIR\" ]; then SRCDIR=\"$SCRATCH/$SRCDIR\"; fi; "
        + "set -- $SRCS; "
        + "if [ \"$#\" -lt %s ]; then echo \"node_asset_stage: missing app/assets inputs\" >&2; exit 2; fi; " % (len(assets) + 1)
        + ("APP_HINT=\"%s\"; " % app_ref)
        + ("APP_PKG=%s; " % sh_quote(app_pkg))
        + "if [ ! -e \"$APP_HINT\" ]; then APP_HINT=\"$1\"; fi; "
        + "if [ -n \"$APP_HINT\" ] && [ \"${APP_HINT#/}\" = \"$APP_HINT\" ]; then APP_HINT=\"$SCRATCH/$APP_HINT\"; fi; "
        + "shift; "
        + "APP_OUT=\"$APP_HINT\"; "
        + "if [ ! -e \"$APP_OUT\" ] && [ -e \"$SRCDIR/$APP_OUT\" ]; then APP_OUT=\"$SRCDIR/$APP_OUT\"; fi; "
        + "if [ ! -e \"$APP_OUT\" ] && [ -e \"$WORKSPACE_ROOT/$APP_OUT\" ]; then APP_OUT=\"$WORKSPACE_ROOT/$APP_OUT\"; fi; "
        + "if [ ! -e \"$APP_OUT\" ] && [ -n \"$APP_PKG\" ] && [ -d \"$WORKSPACE_ROOT/$APP_PKG/dist\" ]; then APP_OUT=\"$WORKSPACE_ROOT/$APP_PKG/dist\"; fi; "
        + "mkdir -p \"$OUT_ABS\"; "
        + "if [ -e \"$APP_OUT\" ]; then "
        + "  if [ -d \"$APP_OUT\" ]; then cp -R \"$APP_OUT\"/. \"$OUT_ABS\"; "
        + "  else cp -f \"$APP_OUT\" \"$OUT_ABS\"; fi; "
        + "fi; "
        + "".join(copy_assets)
    )
    kw = dict(kwargs) if kwargs != None else {}
    wiring = _prepare_node_nix_calling_genrule(
        name = name,
        kwargs = kw,
        srcs = stage_srcs,
        deps = list(deps or []),
        labels = labels,
        lockfile_label = lockfile_label,
    )
    kw = wiring.kwargs
    kw["out"] = out
    kw["cmd"] = cmd
    genrule(**kw)

def node_wasm_inline_module(
        name,
        src,
        out = None,
        artifact_name = None,
        artifact_glob = None,
        labels = [],
        lockfile_label = None,
        deps = [],
        **kwargs):
    if src == None or src == "":
        fail("node_wasm_inline_module: src is required")
    validate_wasm_selector_args("node_wasm_inline_module", artifact_name, artifact_glob)
    if out == None:
        out = "index.js"
    lockfile_label = _apply_default_lockfile_label(lockfile_label, labels, "node_wasm_inline_module")
    src_ref = src
    selected_route_target = ""
    if _is_label_ref(src):
        src_ref = "$(location %s)" % _to_abs_label(src)
    cmd = (
        "SCRATCH=\"$PWD\"; OUT_ABS=\"$SCRATCH/$OUT\"; "
        + ("BNX_NODE_ROUTE_TARGET=%s; " % sh_quote(selected_route_target))
        + "if [ -n \"$BNX_NODE_ROUTE_TARGET\" ]; then "
        + nix_calling_genrule_bootstrap(
            timeout_var = "TIMEOUT",
            timeout_sec = 180,
            include_pnpm_store = False,
            source_workspace_root_env = True,
        )
        + nix_calling_env_export_buck_graph_json()
        + nix_calling_node_patch_requirements_preflight(native.package_name())
        + _selected_route_build_cmd(selected_route_target)
        + "fi; "
        + wasm_source_resolver_shell()
        + "if [ -n \"$SRCDIR\" ] && [ \"${SRCDIR#/}\" = \"$SRCDIR\" ]; then SRCDIR=\"$SCRATCH/$SRCDIR\"; fi; "
        + "set -- $SRCS; "
        + "SRC_WAIT_HINT=\"\"; "
        + "if [ \"$#\" -ge 1 ]; then SRC_WAIT_HINT=\"$1\"; fi; "
        + "if [ -n \"$SRC_WAIT_HINT\" ] && [ \"${SRC_WAIT_HINT#/}\" = \"$SRC_WAIT_HINT\" ]; then SRC_WAIT_HINT=\"$SCRATCH/$SRC_WAIT_HINT\"; fi; "
        + "WAIT_SECS=0; "
        + "while [ -n \"$SRC_WAIT_HINT\" ] && [ ! -e \"$SRC_WAIT_HINT\" ] && [ \"$WAIT_SECS\" -lt 120 ]; do "
        + "  sleep 1; WAIT_SECS=`expr \"$WAIT_SECS\" + 1`; "
        + "done; "
        + ("SRC_HINT=\"%s\"; " % src_ref)
        + "if [ ! -e \"$SRC_HINT\" ]; then "
        + "  if [ \"$#\" -ge 1 ]; then SRC_HINT=\"$1\"; fi; "
        + "fi; "
        + "if [ -n \"$SRC_HINT\" ] && [ \"${SRC_HINT#/}\" = \"$SRC_HINT\" ]; then SRC_HINT=\"$SCRATCH/$SRC_HINT\"; fi; "
        + ("SRC_RAW=%s; " % sh_quote(src))
        + ("SRC_NAME=%s; " % sh_quote(artifact_name))
        + ("SRC_GLOB=%s; " % sh_quote(artifact_glob))
        + "if resolve_node_source_path node_wasm_inline_module \"$SRC_RAW\" \"$SRC_HINT\"; then "
        + "SRC_PATH=\"$BNX_WASM_RESOLVED_PATH\"; "
        + "else SRC_PATH=\"$SRCDIR\"; "
        + "fi; "
        + "resolve_node_wasm_artifact node_wasm_inline_module \"$SRC_RAW\" \"$SRC_PATH\" \"$SRC_NAME\" \"$SRC_GLOB\" || exit $?; "
        + "SRC_PATH=\"$BNX_WASM_RESOLVED_PATH\"; "
        + "if [ ! -f \"$SRC_PATH\" ]; then echo \"node_wasm_inline_module: source not found: $SRC_PATH\" >&2; exit 2; fi; "
        + "b64=\"\"; b64=`base64 < \"$SRC_PATH\" | tr -d '\\n'`; "
        + "OUT_DIR=\"${OUT_ABS%/*}\"; "
        + "mkdir -p \"$OUT_DIR\"; "
        + "printf '%s\\n' "
        + "\"export const wasmBytesBase64 = '$b64';\" "
        + "\"const decodeBase64 = (value) => {\" "
        + "\"  if (typeof atob === \\\"function\\\") {\" "
        + "\"    const bin = atob(value);\" "
        + "\"    const out = new Uint8Array(bin.length);\" "
        + "\"    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);\" "
        + "\"    return out;\" "
        + "\"  }\" "
        + "\"  if (typeof Buffer !== \\\"undefined\\\") {\" "
        + "\"    return Uint8Array.from(Buffer.from(value, \\\"base64\\\"));\" "
        + "\"  }\" "
        + "\"  throw new Error(\\\"wasm inline module: no base64 decoder available\\\");\" "
        + "\"};\" "
        + "\"export const wasmBytes = () => decodeBase64(wasmBytesBase64);\" "
        + "\"\" "
        + "> \"$OUT_ABS\"; "
    )
    kw = dict(kwargs) if kwargs != None else {}
    wiring_deps = list(deps or [])
    if _is_label_ref(src):
        wiring_deps.append(src)
    wiring = _prepare_node_nix_calling_genrule(
        name = name,
        kwargs = kw,
        srcs = [src],
        deps = wiring_deps,
        labels = labels,
        lockfile_label = lockfile_label,
    )
    kw = wiring.kwargs
    kw["out"] = out
    kw["cmd"] = cmd
    genrule(**kw)
