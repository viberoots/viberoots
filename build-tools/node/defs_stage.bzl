load("@prelude//:rules.bzl", "genrule")
load("@viberoots//build-tools/lang:defs_common.bzl", "default_lockfile_label_from_package", "default_lockfile_path_from_package", "ensure_default_lockfile_exists", "extract_lockfile_labels", "prepare_language_wiring")
load("@viberoots//build-tools/lang:nix_shell.bzl", "nix_calling_env_export_buck_graph_json", "nix_calling_genrule_bootstrap", "nix_calling_node_patch_requirements_preflight")
load("@viberoots//build-tools/lang:nix_action_runner.bzl", "nix_action_build_selected_out_path_cmd")
load("@viberoots//build-tools/lang:remote_action_policy.bzl", "stamp_local_only_genrule_labels")
load("@viberoots//build-tools/node/private:wasm_source_resolver.bzl", "asset_with_selector", "sh_quote", "validate_wasm_selector_args", "wasm_source_resolver_shell")
MODULE_PROVIDERS = {}
load("@workspace_providers//:auto_map.bzl", "MODULE_PROVIDERS")
WASM_ASSET_MANIFEST_TOOL = "@viberoots//build-tools/tools/node:wasm-asset-manifest.ts"
def _is_label_ref(v):
    return isinstance(v, str) and (
        v.startswith("//") or
        v.startswith(":") or
        (v.startswith("@") and "//" in v)
    )
def _to_abs_label(v):
    return "//%s:%s" % (native.package_name(), v[1:]) if v.startswith(":") else v
def _label_package(v):
    if not _is_label_ref(v):
        return ""
    if v.startswith(":"):
        return native.package_name()
    trimmed = v.split("//", 1)[1] if v.startswith("@") else v[2:]
    i = trimmed.find(":")
    return trimmed if i < 0 else trimmed[:i]
def _apply_default_lockfile_label(lockfile_label, labels, macro_name):
    if (lockfile_label == None or lockfile_label == "") and len(extract_lockfile_labels(labels or [])) == 0:
        default_path = default_lockfile_path_from_package()
        ensure_default_lockfile_exists(default_path, macro_name)
        return default_lockfile_label_from_package()
    return lockfile_label
def _prepare_node_nix_calling_genrule(name, kwargs, srcs, deps, labels, lockfile_label):
    kind = None if [l for l in (labels or []) if l.startswith("kind:")] else "gen"
    return prepare_language_wiring(
        name = name,
        kwargs = kwargs,
        srcs = srcs,
        deps = deps,
        lang = "node",
        kind = kind,
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
        ("VBR_NODE_ROUTE_TARGET=%s; " % sh_quote(selected_route_target))
        + "if [ -n \"$VBR_NODE_ROUTE_TARGET\" ]; then "
        + nix_action_build_selected_out_path_cmd(
            target_label = "$VBR_NODE_ROUTE_TARGET",
            out_var = "outPath",
            raw_var = "OUT_RAW",
            status_var = "NIX_STATUS",
            log_file = "$WORKSPACE_ROOT/buck-out/tmp/build-selected/node_stage.log",
            escape_cmd_subst = True,
        )
        + "if [ \"$NIX_STATUS\" -ne 0 ] || [ -z \"$outPath\" ]; then cat \"$WORKSPACE_ROOT/buck-out/tmp/build-selected/node_stage.log\" >&2 2>/dev/null || true; exit \"${NIX_STATUS:-2}\"; fi; "
        + "fi; "
    )
def _finish_node_nix_genrule(kw, out, cmd):
    kw.update({"out": out, "cmd": cmd, "labels": stamp_local_only_genrule_labels(kw.get("labels", []) or [])})
    genrule(**kw)
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
    app_output_subdir = "dist" if (
        "webapp:static" in labels or
        "webapp:ssr" in labels
    ) else ""
    app_ref = app
    app_pkg = ""
    selected_route_target = ""
    if _is_label_ref(app):
        app_ref = "$(location %s)" % _to_abs_label(app)
        app_pkg = _label_package(app)
    stage_srcs = [app, WASM_ASSET_MANIFEST_TOOL]
    copy_assets = []
    for a in assets:
        selected = asset_with_selector(a)
        src = selected.src
        dest = selected.dest
        stage_srcs.append(src)
        resolve_provenance = "PROVENANCE_PATH=''; "
        if selected.provenance:
            stage_srcs.append(selected.provenance)
            provenance_hint = "$(location %s)" % _to_abs_label(selected.provenance)
            resolve_provenance = (
                ("PROVENANCE_RAW=%s; PROVENANCE_HINT=%s; " % (sh_quote(selected.provenance), sh_quote(provenance_hint)))
                + "resolve_node_source_path node_asset_stage \"$PROVENANCE_RAW\" \"$PROVENANCE_HINT\" || exit $?; "
                + "PROVENANCE_PATH=\"$VBR_WASM_RESOLVED_PATH\"; "
            )
        asset_hint_assign = ("ASSET_HINT=%s; " % sh_quote(src))
        if _is_label_ref(src):
            asset_hint_assign = ("ASSET_HINT=\"$(location %s)\"; " % _to_abs_label(src))
        resolve_asset = (
            asset_hint_assign
            + ("ASSET_RAW=%s; " % sh_quote(src))
            + ("ASSET_NAME=%s; " % sh_quote(selected.artifact_name))
            + ("ASSET_GLOB=%s; " % sh_quote(selected.artifact_glob))
            + "if resolve_node_source_path node_asset_stage \"$ASSET_RAW\" \"$ASSET_HINT\"; then "
            + "ASSET_SRC=\"$VBR_WASM_RESOLVED_PATH\"; "
            + "else ASSET_SRC=\"$SRCDIR\"; fi; "
        )
        if selected.kind == "wasm":
            resolve_asset += (
                "resolve_node_wasm_artifact node_asset_stage \"$ASSET_RAW\" \"$ASSET_SRC\" \"$ASSET_NAME\" \"$ASSET_GLOB\" || exit $?; "
                + "ASSET_SRC=\"$VBR_WASM_RESOLVED_PATH\"; "
            )
        else:
            resolve_asset += (
                "if [ ! -f \"$ASSET_SRC\" ]; then "
                + "echo \"node_asset_stage: raw asset is not a file for '$ASSET_RAW': $ASSET_SRC\" >&2; exit 2; "
                + "fi; "
            )
        copy_asset = (
            ("DEST=\"$OUT_ABS/%s\"; " % dest)
            + "if [ -e \"$DEST\" ] && [ ! -f \"$DEST\" ]; then "
            + "echo \"node_asset_stage: destination is not a file: $DEST\" >&2; exit 2; "
            + "fi; "
            + "DEST_DIR=\"${DEST%/*}\"; "
            + "if [ \"$DEST_DIR\" = \"$DEST\" ]; then DEST_DIR=\"$OUT_ABS\"; fi; "
            + "mkdir -p \"$DEST_DIR\"; "
            + "if [ \"$ASSET_SRC\" != \"$DEST\" ]; then cp -f \"$ASSET_SRC\" \"$DEST\"; fi; "
        )
        if selected.kind == "wasm":
            copy_asset += resolve_provenance
            copy_asset += ("NODE_OPTIONS= \"$VBR_ARTIFACT_TOOLS_ROOT/bin/node\" --experimental-strip-types \"$VBR_ARTIFACT_TOOLS_ROOT/share/viberoots-source/build-tools/tools/node/wasm-asset-manifest.ts\" \"$ASSET_RAW\" \"$ASSET_SRC\" %s \"$DEST\" \"$ASSET_MANIFEST\" \"$PROVENANCE_PATH\"; " % sh_quote(dest))
        copy_assets.append(resolve_asset + copy_asset)
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
        + "if [ \"$#\" -lt 1 ]; then echo \"node_asset_stage: missing app input\" >&2; exit 2; fi; "
        + ("APP_HINT=\"%s\"; " % app_ref)
        + ("APP_PKG=%s; " % sh_quote(app_pkg))
        + "if [ ! -e \"$APP_HINT\" ]; then APP_HINT=\"$1\"; fi; "
        + "if [ -n \"$APP_HINT\" ] && [ \"${APP_HINT#/}\" = \"$APP_HINT\" ]; then APP_HINT=\"$SCRATCH/$APP_HINT\"; fi; "
        + "APP_OUT=\"$APP_HINT\"; "
        + "if [ ! -e \"$APP_OUT\" ] && [ -e \"$SRCDIR/$APP_OUT\" ]; then APP_OUT=\"$SRCDIR/$APP_OUT\"; fi; "
        + "if [ ! -e \"$APP_OUT\" ] && [ -e \"$WORKSPACE_ROOT/$APP_OUT\" ]; then APP_OUT=\"$WORKSPACE_ROOT/$APP_OUT\"; fi; "
        + "if [ ! -e \"$APP_OUT\" ] && [ -n \"$APP_PKG\" ] && [ -d \"$WORKSPACE_ROOT/$APP_PKG/dist\" ]; then APP_OUT=\"$WORKSPACE_ROOT/$APP_PKG/dist\"; fi; "
        + ("APP_OUTPUT_SUBDIR=%s; " % sh_quote(app_output_subdir))
        + "APP_CONTENT=\"$APP_OUT\"; "
        + "if [ -n \"$APP_OUTPUT_SUBDIR\" ]; then "
        + "  if [ ! -d \"$APP_OUT/$APP_OUTPUT_SUBDIR\" ]; then echo \"node_asset_stage: declared webapp parent output is missing $APP_OUTPUT_SUBDIR: $APP_OUT\" >&2; exit 2; fi; "
        + "  APP_CONTENT=\"$APP_OUT/$APP_OUTPUT_SUBDIR\"; "
        + "fi; "
        + "mkdir -p \"$OUT_ABS\"; "
        + "if [ -e \"$APP_CONTENT\" ]; then "
        + "  if [ -d \"$APP_CONTENT\" ]; then "
        + "    if [ \"`cd \"$APP_CONTENT\" && pwd -P`\" != \"`cd \"$OUT_ABS\" && pwd -P`\" ]; then cp -R \"$APP_CONTENT\"/. \"$OUT_ABS\"; fi; "
        + "  elif [ \"$APP_CONTENT\" != \"$OUT_ABS\" ]; then cp -f \"$APP_CONTENT\" \"$OUT_ABS\"; fi; "
        + "fi; "
        + "ASSET_MANIFEST=\"$OUT_ABS/asset-manifest.json\"; "
        + "printf '%s\\n' '{\"schemaVersion\":\"viberoots.node-wasm-assets.v1\",\"assets\":[]}' > \"$ASSET_MANIFEST\"; "
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
    _finish_node_nix_genrule(kw, out, cmd)
def node_wasm_inline_module(
        name,
        src,
        out = None,
        artifact_name = None,
        artifact_glob = None,
        provenance = None,
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
    provenance_ref = "$(location %s)" % _to_abs_label(provenance) if provenance else ""
    cmd = (
        "SCRATCH=\"$PWD\"; OUT_ABS=\"$SCRATCH/$OUT\"; "
        + nix_calling_genrule_bootstrap(
            timeout_var = "TIMEOUT",
            timeout_sec = 180,
            include_pnpm_store = False,
            source_workspace_root_env = True,
        )
        + ("VBR_NODE_ROUTE_TARGET=%s; " % sh_quote(selected_route_target))
        + "if [ -n \"$VBR_NODE_ROUTE_TARGET\" ]; then "
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
        + "SRC_PATH=\"$VBR_WASM_RESOLVED_PATH\"; "
        + "else SRC_PATH=\"$SRCDIR\"; "
        + "fi; "
        + "resolve_node_wasm_artifact node_wasm_inline_module \"$SRC_RAW\" \"$SRC_PATH\" \"$SRC_NAME\" \"$SRC_GLOB\" || exit $?; "
        + "SRC_PATH=\"$VBR_WASM_RESOLVED_PATH\"; "
        + "if [ ! -f \"$SRC_PATH\" ]; then echo \"node_wasm_inline_module: source not found: $SRC_PATH\" >&2; exit 2; fi; "
        + ("PROVENANCE_RAW=%s; PROVENANCE_HINT=%s; " % (sh_quote(provenance), sh_quote(provenance_ref)))
        + "PROVENANCE_PATH=''; "
        + "if [ -n \"$PROVENANCE_RAW\" ]; then resolve_node_source_path node_wasm_inline_module \"$PROVENANCE_RAW\" \"$PROVENANCE_HINT\" || exit $?; PROVENANCE_PATH=\"$VBR_WASM_RESOLVED_PATH\"; fi; "
        + "PRODUCER_JSON=`NODE_OPTIONS= \"$VBR_ARTIFACT_TOOLS_ROOT/bin/node\" --experimental-strip-types \"$VBR_ARTIFACT_TOOLS_ROOT/share/viberoots-source/build-tools/tools/node/wasm-asset-manifest.ts\" --lineage \"$SRC_PATH\" \"$PROVENANCE_PATH\"`; "
        + "b64=\"\"; b64=`base64 < \"$SRC_PATH\" | tr -d '\\n'`; "
        + "OUT_DIR=\"${OUT_ABS%/*}\"; "
        + "mkdir -p \"$OUT_DIR\"; "
        + "printf '%s\\n' "
        + "\"export const wasmBytesBase64 = '$b64';\" "
        + "\"export const wasmProducer = $PRODUCER_JSON;\" "
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
    if provenance:
        wiring_deps.append(provenance)
    wiring = _prepare_node_nix_calling_genrule(
        name = name,
        kwargs = kw,
        srcs = [src, provenance, WASM_ASSET_MANIFEST_TOOL] if provenance else [src, WASM_ASSET_MANIFEST_TOOL],
        deps = wiring_deps,
        labels = labels,
        lockfile_label = lockfile_label,
    )
    kw = wiring.kwargs
    _finish_node_nix_genrule(kw, out, cmd)
