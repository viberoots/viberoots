load("//lang:sanitize.bzl", "sanitize_name")
load("//lang:nix_shell.bzl", "nix_bootstrap_env", "nix_timeout_wrapper_var")

def _node_nix_test_impl(ctx):
    imp = ctx.attrs.importer
    if imp == None or imp == "":
        fail("node_nix_test: importer is required (derived from lockfile label at macro call)")

    # Sanitize importer using canonical helper (mirrors flake-side sanitizeName)
    imp_attr = sanitize_name(imp)
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
        # Skip unified pnpm prewarm at bootstrap; we'll do it only if tests exist
        "export BNX_SKIP_REQUIRE_UNIFIED_PNPM_STORE=1; "
        + nix_bootstrap_env()
        + ("".join(env_pairs))
        + nix_timeout_wrapper_var(var_name = "TIMEOUT", default_sec = (tout if isinstance(tout, int) and tout > 0 else 600))
        + ("echo '[node_nix_test] importer=%s (attr=%s)' >&2; " % (imp, imp_attr))
        + ("if ! (cd \"$WORKSPACE_ROOT/%s\" && (find . -type f -name \"*.test.ts\" -print -quit | grep -q . || find . -type f -name \"*.test.js\" -print -quit | grep -q .)); then echo '[node_nix_test] no tests matched; passing' >&2; exit 0; fi; " % imp)
        # Prewarm unified pnpm store only when tests will actually run
        + "if [ ! -f \"$WORKSPACE_ROOT/buck-out/.unified-pnpm-store/path\" ]; then "
        + "  if command -v node >/dev/null 2>&1; then "
        + "    (node \"$FLK_ROOT/tools/dev/require-unified-pnpm-store.ts\" >/dev/null 2>&1 || true); "
        + "  elif command -v nix >/dev/null 2>&1; then "
        + "    (nix run --accept-flake-config \"$FLK_ROOT\"#zx-wrapper -- \"$FLK_ROOT/tools/dev/require-unified-pnpm-store.ts\" >/dev/null 2>&1 || true); "
        + "  fi; "
        + "fi; "
        + "if [ -f \"$WORKSPACE_ROOT/buck-out/.unified-pnpm-store/path\" ]; then "
        + "  export NIX_USE_PREFETCHED_PNPM_STORE=1; "
        + "  export LOCAL_PNPM_STORE=\"$(cat \"$WORKSPACE_ROOT/buck-out/.unified-pnpm-store/path\" 2>/dev/null || true)\"; "
        + "fi; "
        + "NIX_MAXJ=\"${NIX_MAX_JOBS:-1}\"; NIX_CORES=\"${NIX_CORES:-1}\"; "
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


