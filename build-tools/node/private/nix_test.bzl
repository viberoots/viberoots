load("//build-tools/lang:sanitize.bzl", "sanitize_name")
load("//build-tools/lang:nix_shell.bzl", "nix_bootstrap_env_core", "nix_bootstrap_env_pnpm_store", "nix_timeout_wrapper_var")
load("@prelude//test:inject_test_run_info.bzl", "inject_test_run_info")

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
        + nix_bootstrap_env_core()
        + ("".join(env_pairs))
        + nix_timeout_wrapper_var(var_name = "TIMEOUT", default_sec = (tout if tout > 0 else 600))
        + ("echo '[node_nix_test] importer=%s (attr=%s)' >&2; " % (imp, imp_attr))
        + ("if ! (cd \"$WORKSPACE_ROOT/%s\" && (find . -type f -name \"*.test.ts\" -print -quit | grep -q . || find . -type f -name \"*.test.js\" -print -quit | grep -q .)); then echo '[node_nix_test] no tests matched; passing' >&2; exit 0; fi; " % imp)
        # If the main repo root already has a unified pnpm store, reuse it in temp workspaces
        + "if [ -n \"${REPO_ROOT:-}\" ] && [ -f \"$REPO_ROOT/buck-out/.unified-pnpm-store/path\" ]; then "
        + "  export NIX_USE_PREFETCHED_PNPM_STORE=1; "
        + "  export LOCAL_PNPM_STORE=\"$(cat \"$REPO_ROOT/buck-out/.unified-pnpm-store/path\" 2>/dev/null || true)\"; "
        + "fi; "
        + "export BNX_SKIP_REQUIRE_UNIFIED_PNPM_STORE=0; "
        + nix_bootstrap_env_pnpm_store()
        + "NIX_MAXJ=\"${NIX_MAX_JOBS:-0}\"; NIX_CORES=\"${NIX_CORES:-0}\"; "
        + "JOBS_FLAG=\"\"; if [ -n \"$NIX_MAXJ\" ] && [ \"$NIX_MAXJ\" != \"0\" ]; then JOBS_FLAG=\"--max-jobs $NIX_MAXJ\"; fi; "
        + "CORES_FLAG=\"\"; if [ -n \"$NIX_CORES\" ] && [ \"$NIX_CORES\" != \"0\" ]; then CORES_FLAG=\"--option cores $NIX_CORES\"; fi; "
        + "$TIMEOUT nix build \"path:$FLK_ROOT#node-test.%s\" --impure --accept-flake-config --show-trace --print-build-logs --builders \"\" $JOBS_FLAG $CORES_FLAG; " % imp_attr
    )

    # Declare a tiny deterministic output so builds have an artifact
    stamp = ctx.actions.declare_output(ctx.attrs.out)
    cmd = cmd_args(
        ["bash", "-c", "echo node_nix_test > \"$1\"", "stamp", stamp.as_output()],
        hidden = ctx.attrs.srcs,
    )
    ctx.actions.run(cmd, category = "node_nix_test_stamp")

    return inject_test_run_info(ctx, ExternalRunnerTestInfo(
            type = "custom",
            command = ["bash", "-c", run_cmd],
            labels = ctx.attrs.labels,
            contacts = [],
        )) + [
        DefaultInfo(
            default_output = stamp,
            # Ensure srcs are inputs so changes to patch files/others invalidate correctly
            # Note: deps edges are carried by attrs.deps
            other_outputs = [],
        ),
    ]


node_nix_test = rule(
    impl = _node_nix_test_impl,
    attrs = {
        # Importer directory like "projects/apps/web" or "."
        "importer": attrs.string(),
        # Optional newline-separated test patterns (forwarded via env)
        "patterns": attrs.list(attrs.string(), default = []),
        # Env to merge into runner environment
        "env": attrs.dict(key = attrs.string(), value = attrs.string(), default = {}),
        # External timeout in seconds (default 600)
        "timeout_sec": attrs.int(default = 1800),
        "test_rule_timeout_ms": attrs.option(attrs.int(), default = None),
        # Inputs that affect invalidation (e.g., importer-local patches)
        "srcs": attrs.list(attrs.source(), default = []),
        # Additional deps (e.g., provider stamps)
        "deps": attrs.list(attrs.dep(), default = []),
        # Pass-through target labels for graph/exporter tooling
        "labels": attrs.list(attrs.string(), default = []),
        # Deterministic tiny output file name
        "out": attrs.string(default = "node_nix_test.stamp"),
        "_inject_test_env": attrs.default_only(attrs.dep(default = "prelude//test/tools:inject_test_env")),
    },
)
