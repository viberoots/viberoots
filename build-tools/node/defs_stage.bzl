load("@prelude//:rules.bzl", "genrule")

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
