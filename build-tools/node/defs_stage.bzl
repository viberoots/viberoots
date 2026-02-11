load("@prelude//:rules.bzl", "genrule")
load(
    "//build-tools/lang:defs_common.bzl",
    "default_lockfile_label_from_package",
    "default_lockfile_path_from_package",
    "ensure_default_lockfile_exists",
    "extract_lockfile_labels",
    "prepare_language_wiring",
)
load(
    "//build-tools/lang:nix_shell.bzl",
    "nix_calling_env_export_buck_graph_json",
    "nix_calling_genrule_bootstrap",
)
MODULE_PROVIDERS = {}
load("//build-tools/lang:auto_map.bzl", "MODULE_PROVIDERS")

def _is_label_ref(v):
    return isinstance(v, str) and (v.startswith("//") or v.startswith(":"))

def _to_abs_label(v):
    if v.startswith(":"):
        return "//%s:%s" % (native.package_name(), v[1:])
    return v

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

    stage_srcs = [app]
    copy_assets = []
    for a in assets:
        src = a["src"]
        dest = a["dest"]
        stage_srcs.append(src)
        copy_assets.append(
            "if [ \"$#\" -lt 1 ]; then "
            + "echo \"node_asset_stage: missing staged asset input for %s\" >&2; exit 2; "
            + "fi; "
            + "ASSET_SRC=\"$1\"; shift; "
            + "if [ ! -e \"$ASSET_SRC\" ] && [ -e \"$SRCDIR/$ASSET_SRC\" ]; then ASSET_SRC=\"$SRCDIR/$ASSET_SRC\"; fi; "
            + "if [ ! -e \"$ASSET_SRC\" ] && [ -e \"$WORKSPACE_ROOT/$ASSET_SRC\" ]; then ASSET_SRC=\"$WORKSPACE_ROOT/$ASSET_SRC\"; fi; "
            + "if [ -d \"$ASSET_SRC\" ]; then "
            + "  if [ -f \"$ASSET_SRC/top.wasm\" ]; then ASSET_SRC=\"$ASSET_SRC/top.wasm\"; "
            + "  else ASSET_WASM=\"\"; for f in \"$ASSET_SRC\"/*.wasm \"$ASSET_SRC\"/*/*.wasm \"$ASSET_SRC\"/*/*/*.wasm; do "
            + "    if [ -f \"$f\" ]; then ASSET_WASM=\"$f\"; break; fi; "
            + "  done; "
            + "    if [ -n \"$ASSET_WASM\" ]; then ASSET_SRC=\"$ASSET_WASM\"; "
            + "    else echo \"node_asset_stage: no wasm file found in asset output dir: $ASSET_SRC\" >&2; exit 2; fi; "
            + "  fi; "
            + "fi; "
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
            timeout_sec = 240,
            include_pnpm_store = False,
            source_workspace_root_env = True,
        )
        + nix_calling_env_export_buck_graph_json()
        + "set -- $SRCS; "
        + "if [ \"$#\" -lt %s ]; then echo \"node_asset_stage: missing app/assets inputs\" >&2; exit 2; fi; " % (len(assets) + 1)
        + "APP_OUT=\"$1\"; shift; "
        + "if [ ! -e \"$APP_OUT\" ] && [ -e \"$SRCDIR/$APP_OUT\" ]; then APP_OUT=\"$SRCDIR/$APP_OUT\"; fi; "
        + "if [ ! -e \"$APP_OUT\" ] && [ -e \"$WORKSPACE_ROOT/$APP_OUT\" ]; then APP_OUT=\"$WORKSPACE_ROOT/$APP_OUT\"; fi; "
        + "mkdir -p \"$OUT_ABS\"; "
        + "if [ -d \"$APP_OUT\" ]; then "
        + "cp -R \"$APP_OUT\"/. \"$OUT_ABS\"; "
        + "else cp -f \"$APP_OUT\" \"$OUT_ABS\"; fi; "
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

def node_wasm_inline_module(name, src, out = None, labels = [], lockfile_label = None, deps = [], **kwargs):
    if src == None or src == "":
        fail("node_wasm_inline_module: src is required")
    if out == None:
        out = "index.js"
    lockfile_label = _apply_default_lockfile_label(lockfile_label, labels, "node_wasm_inline_module")
    src_ref = src
    if _is_label_ref(src):
        src_ref = "$(location %s)" % _to_abs_label(src)
    cmd = (
        "SCRATCH=\"$PWD\"; OUT_ABS=\"$SCRATCH/$OUT\"; "
        + nix_calling_genrule_bootstrap(
            timeout_sec = 180,
            include_pnpm_store = False,
            source_workspace_root_env = True,
        )
        + nix_calling_env_export_buck_graph_json()
        + ("SRC_PATH=\"%s\"; " % src_ref)
        + "if [ ! -e \"$SRC_PATH\" ]; then "
        + "  set -- $SRCS; "
        + "  if [ \"$#\" -ge 1 ]; then SRC_PATH=\"$1\"; fi; "
        + "fi; "
        + "if [ ! -e \"$SRC_PATH\" ] && [ -e \"$SRCDIR/$SRC_PATH\" ]; then SRC_PATH=\"$SRCDIR/$SRC_PATH\"; fi; "
        + "if [ ! -e \"$SRC_PATH\" ] && [ -e \"$WORKSPACE_ROOT/$SRC_PATH\" ]; then SRC_PATH=\"$WORKSPACE_ROOT/$SRC_PATH\"; fi; "
        + "if [ -d \"$SRC_PATH\" ]; then "
        + "  if [ -f \"$SRC_PATH/top.wasm\" ]; then SRC_PATH=\"$SRC_PATH/top.wasm\"; "
        + "  else SRC_WASM=\"\"; for f in \"$SRC_PATH\"/*.wasm \"$SRC_PATH\"/*/*.wasm \"$SRC_PATH\"/*/*/*.wasm; do "
        + "    if [ -f \"$f\" ]; then SRC_WASM=\"$f\"; break; fi; "
        + "  done; "
        + "    if [ -n \"$SRC_WASM\" ]; then SRC_PATH=\"$SRC_WASM\"; "
        + "    else echo \"node_wasm_inline_module: no wasm file found in source dir: $SRC_PATH\" >&2; exit 2; fi; "
        + "  fi; "
        + "fi; "
        + "if [ ! -f \"$SRC_PATH\" ]; then echo \"node_wasm_inline_module: source not found: $SRC_PATH\" >&2; exit 2; fi; "
        + "SRC_PATH=\"$SRC_PATH\" OUT_ABS=\"$OUT_ABS\" node -e \""
        + "const fs=require('node:fs');"
        + "const path=require('node:path');"
        + "const src=process.env.SRC_PATH;"
        + "const out=process.env.OUT_ABS;"
        + "const b64=fs.readFileSync(src).toString('base64');"
        + "const data=["
        + "'export const wasmBytesBase64 = '+JSON.stringify(b64)+';',"
        + "'const decodeBase64 = (value) => {',"
        + "'  if (typeof atob === \\\"function\\\") {',"
        + "'    const bin = atob(value);',"
        + "'    const out = new Uint8Array(bin.length);',"
        + "'    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);',"
        + "'    return out;',"
        + "'  }',"
        + "'  if (typeof Buffer !== \\\"undefined\\\") {',"
        + "'    return Uint8Array.from(Buffer.from(value, \\\"base64\\\"));',"
        + "'  }',"
        + "'  throw new Error(\\\"wasm inline module: no base64 decoder available\\\");',"
        + "'};',"
        + "'export const wasmBytes = () => decodeBase64(wasmBytesBase64);',"
        + "''"
        + "].join('\\\\n');"
        + "fs.mkdirSync(path.dirname(out),{recursive:true});"
        + "fs.writeFileSync(out,data);\"; "
    )
    kw = dict(kwargs) if kwargs != None else {}
    wiring = _prepare_node_nix_calling_genrule(
        name = name,
        kwargs = kw,
        srcs = [src],
        deps = list(deps or []),
        labels = labels,
        lockfile_label = lockfile_label,
    )
    kw = wiring.kwargs
    kw["out"] = out
    kw["cmd"] = cmd
    genrule(**kw)
