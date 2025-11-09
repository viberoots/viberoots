def _node_nix_test_impl(ctx):
    imp = ctx.attrs.importer
    if imp == None or imp == "":
        fail("node_nix_test: importer is required (derived from lockfile label at macro call)")

    # Sanitize importer to match flake attr naming (see tools/nix/templates-common.nix sanitizeName)
    def _sanitize_importer_attr(s):
        return s.replace("//", "").replace(":", "-").replace("/", "-").replace(" ", "-")

    imp_attr = _sanitize_importer_attr(imp)
    tout = ctx.attrs.timeout_sec

    # Prepare environment exports (user env + optional patterns)
    env_pairs = []
    # Stable order for determinism
    for k in sorted(ctx.attrs.env.keys()):
        v = ctx.attrs.env[k]
        if not isinstance(k, str) or not isinstance(v, str):
            continue
        env_pairs.append("export %s=\"%s\"; " % (k, v))

    pat = ctx.attrs.patterns or []
    if len(pat) > 0:
        # Newline-separated patterns passed via NIX_NODE_TEST_PATTERNS
        joined = "\n".join(pat)
        env_pairs.append("export NIX_NODE_TEST_PATTERNS=\"%s\"; " % joined)

    # Compose runner command
    run_cmd = (
        "set -euo pipefail; "
        + "export WORKSPACE_ROOT=\"${WORKSPACE_ROOT:-$(pwd)}\"; cd \"$WORKSPACE_ROOT\"; "
        + "FLK_ROOT=\"$WORKSPACE_ROOT\"; if [ ! -f \"$FLK_ROOT/flake.nix\" ]; then FLK_ROOT=\"$(git -C \"$WORKSPACE_ROOT\" rev-parse --show-toplevel 2>/dev/null || echo \"$WORKSPACE_ROOT\")\"; fi; "
        + "test -f \"$FLK_ROOT/flake.nix\"; "
        + ("".join(env_pairs))
        + ("TOUT=%d; " % (tout if isinstance(tout, int) and tout > 0 else 600))
        + ("echo '[node_nix_test] importer=%s (attr=%s)' >&2; " % (imp, imp_attr))
        + ("if ! (cd \"$WORKSPACE_ROOT/%s\" && (find . -type f -name \"*.test.ts\" -print -quit | grep -q . || find . -type f -name \"*.test.js\" -print -quit | grep -q .)); then echo '[node_nix_test] no tests matched; passing' >&2; exit 0; fi; " % imp)
        + "NIX_MAXJ=\"${NIX_MAX_JOBS:-1}\"; NIX_CORES=\"${NIX_CORES:-1}\"; "
        + "if command -v timeout >/dev/null 2>&1; then "
        + "  TIMEOUT=\"timeout -k 2s ${TOUT}s\"; "
        + "elif command -v gtimeout >/dev/null 2>&1; then "
        + "  TIMEOUT=\"gtimeout -k 2s ${TOUT}s\"; "
        + "else "
        + "  TIMEOUT=\"\"; "
        + "fi; "
        + "$TIMEOUT nix build \"path:$FLK_ROOT#node-test.%s\" --impure --accept-flake-config --show-trace --print-build-logs --max-jobs \"$NIX_MAXJ\" --option cores \"$NIX_CORES\"; " % imp_attr
    )

    # Declare a tiny deterministic output so builds have an artifact
    stamp = ctx.actions.declare_output(ctx.attrs.out)
    ctx.actions.write(stamp, "node_nix_test\n")

    return [
        DefaultInfo(
            default_output = stamp,
            # Ensure srcs are inputs so changes to patch files/others invalidate correctly
            # Note: deps edges are carried by attrs.deps
            other_outputs = [],
        ),
        ExternalRunnerTestInfo(
            type = "custom",
            command = ["bash", "-c", run_cmd],
            labels = [],
            contacts = [],
        ),
    ]


node_nix_test = rule(
    impl = _node_nix_test_impl,
    attrs = {
        # Importer directory like "apps/web" or "."
        "importer": attrs.string(),
        # Optional newline-separated test patterns (forwarded via env)
        "patterns": attrs.list(attrs.string(), default = []),
        # Env to merge into runner environment
        "env": attrs.dict(key = attrs.string(), value = attrs.string(), default = {}),
        # External timeout in seconds (default 600)
        "timeout_sec": attrs.int(default = 600),
        # Inputs that affect invalidation (e.g., importer-local patches)
        "srcs": attrs.list(attrs.source(), default = []),
        # Additional deps (e.g., provider stamps)
        "deps": attrs.list(attrs.dep(), default = []),
        # Pass-through target labels for graph/exporter tooling
        "labels": attrs.list(attrs.string(), default = []),
        # Deterministic tiny output file name
        "out": attrs.string(default = "node_nix_test.stamp"),
    },
)


