load("//build-tools/node:defs_core.bzl", "nix_node_gen")

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
    srcs = [app]
    copy_assets = []
    for a in assets:
        src = a["src"]
        dest = a["dest"]
        srcs.append(src)
        copy_assets.append(
            (
                "if [ \"$#\" -lt 1 ]; then "
                + "echo \"node_asset_stage: missing staged asset input for %s\" >&2; exit 2; "
                + "fi; "
                + "SRC=\"$1\"; shift; "
                + "DEST=\"$OUT_ABS/%s\"; "
            ) % (dest, dest)
            +
            "if [ -e \"$DEST\" ] && [ ! -f \"$DEST\" ]; then "
            + "echo \"node_asset_stage: destination is not a file: $DEST\" >&2; exit 2; "
            + "fi; "
            + "DEST_DIR=\"${DEST%/*}\"; "
            + "if [ \"$DEST_DIR\" = \"$DEST\" ]; then DEST_DIR=\"$OUT_ABS\"; fi; "
            + "mkdir -p \"$DEST_DIR\"; "
            + "cp -f \"$SRC\" \"$DEST\"; "
        )
    cmd = (
        "set -euo pipefail; "
        + "OUT_ABS=\"$PWD/$OUT\"; "
        + "set -- $SRCS; "
        + "if [ \"$#\" -lt 1 ]; then echo \"node_asset_stage: missing app input\" >&2; exit 2; fi; "
        + "APP_OUT=\"$1\"; shift; "
        + "mkdir -p \"$OUT_ABS\"; "
        + "cp -R \"$APP_OUT\"/. \"$OUT_ABS\"; "
        + "".join(copy_assets)
    )
    nix_node_gen(
        name = name,
        srcs = srcs,
        out = out,
        cmd = cmd,
        deps = deps,
        labels = labels,
        lockfile_label = lockfile_label,
        kind = "gen",
        **kwargs
    )

def node_wasm_inline_module(name, src, out = None, labels = [], lockfile_label = None, **kwargs):
    if src == None or src == "":
        fail("node_wasm_inline_module: src is required")
    if out == None:
        out = "index.js"
    tool = "//build-tools/tools/node:gen-wasm-inline-module"
    cmd = (
        "set -euo pipefail; "
        + "set -- $SRCS; "
        + "if [ \"$#\" -lt 2 ]; then echo \"node_wasm_inline_module: expected wasm src and tool\" >&2; exit 2; fi; "
        + "SRC_PATH=\"$1\"; TOOL_PATH=\"$2\"; "
        + "SRC=\"$SRC_PATH\" OUT_PATH=\"$OUT\" zx-wrapper \"$TOOL_PATH\""
    )
    nix_node_gen(
        name = name,
        srcs = [src, tool],
        out = out,
        cmd = cmd,
        labels = labels,
        lockfile_label = lockfile_label,
        kind = "gen",
        **kwargs
    )
