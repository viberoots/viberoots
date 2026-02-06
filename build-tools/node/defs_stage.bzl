load("@prelude//:rules.bzl", "genrule")
load("//build-tools/node:defs_core.bzl", "nix_node_gen")

def node_asset_stage(name, app, assets = [], out = None, **kwargs):
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
            "SRC=\"$(location %s)\"; DEST=\"$OUT_ABS/%s\"; "
            % (src, dest) +
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
        + "APP_OUT=\"$(location %s)\"; " % app
        + "mkdir -p \"$OUT_ABS\"; "
        + "cp -R \"$APP_OUT\"/. \"$OUT_ABS\"; "
        + "".join(copy_assets)
    )
    genrule(
        name = name,
        srcs = srcs,
        out = out,
        cmd = cmd,
        **kwargs
    )

def node_wasm_inline_module(name, src, out = None, labels = [], lockfile_label = None, **kwargs):
    if src == None or src == "":
        fail("node_wasm_inline_module: src is required")
    if out == None:
        out = "index.js"
    tool = "//build-tools/tools/node:gen-wasm-inline-module"
    cmd = (
        "SRC=\"$(location %s)\" OUT_PATH=\"$OUT\" " % src +
        "zx-wrapper \"$(location %s)\"" % tool
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
