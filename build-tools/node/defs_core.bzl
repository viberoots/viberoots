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
    "nix_build_out_path_cmd",
    "nix_calling_env_export_buck_graph_json",
    "nix_calling_genrule_bootstrap",
)
load("//build-tools/node/private:nix_test.bzl", "node_nix_test")

# NOTE: Prebuild guard ensures this load is valid before builds/tests run.
MODULE_PROVIDERS = {}
load("//build-tools/lang:auto_map.bzl", "MODULE_PROVIDERS")

def nix_node_gen(name, srcs = [], out = None, cmd = None, deps = [], labels = [], lockfile_label = None, kind = "gen", planner_only = False, **kwargs):
    if (lockfile_label == None or lockfile_label == "") and len(extract_lockfile_labels(labels or [])) == 0:
        default_path = default_lockfile_path_from_package()
        ensure_default_lockfile_exists(default_path, "nix_node_gen")
        lockfile_label = default_lockfile_label_from_package()
    if cmd == None or cmd == "":
        fail("nix_node_gen: cmd is required")
    effective_out = out if out != None else name
    planner_name = name + "__planner"
    planner_wiring = prepare_language_wiring(
        name = planner_name,
        kwargs = kwargs,
        srcs = srcs,
        deps = deps,
        lang = "node",
        kind = kind,
        labels = labels,
        lockfile_label = lockfile_label,
        MODULE_PROVIDERS = MODULE_PROVIDERS,
        wiring = "genrule",
    )
    planner_kw = planner_wiring.kwargs
    planner_kw["out"] = effective_out
    planner_kw["cmd"] = cmd
    genrule(**planner_kw)
    if planner_only:
        return

    wiring = prepare_language_wiring(
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
    kw = wiring.kwargs
    raw = "//%s:%s" % (native.package_name(), planner_name)
    wrapper_cmd = (
        "SCRATCH=\"$PWD\"; OUT_ABS=\"$SCRATCH/$OUT\"; "
        + nix_calling_genrule_bootstrap(
            timeout_sec = 180,
            include_pnpm_store = False,
            source_workspace_root_env = True,
        )
        + nix_calling_env_export_buck_graph_json()
        + nix_build_out_path_cmd(
            "\"path:$WORKSPACE_ROOT#graph-generator-selected\"",
            timeout_var = "TIMEOUT",
            impure = True,
            build_prefix = ("env BUCK_TEST_SRC=\"$WORKSPACE_ROOT\" BUCK_TARGET=\"%s\" " % raw),
        )
        + ("EXPECTED=\"$outPath/%s\"; " % effective_out)
        + "if [ ! -e \"$EXPECTED\" ]; then "
        + "  echo \"nix_node_gen: expected output missing: $EXPECTED\" >&2; "
        + "  exit 2; "
        + "fi; "
        + "if [ -d \"$EXPECTED\" ]; then cp -R \"$EXPECTED\" \"$OUT_ABS\"; else cp -f \"$EXPECTED\" \"$OUT_ABS\"; fi; "
        + "if [ -f \"$OUT_ABS\" ]; then chmod +x \"$OUT_ABS\"; fi; "
    )
    kw["out"] = effective_out
    kw["cmd"] = wrapper_cmd
    genrule(**kw)

def nix_node_test(
    name,
    # Backward-compat args (ignored by runner; 'out' forwarded for stamp name)
    srcs = [],
    out = None,
    cmd = None,
    # New runner args
    patterns = None,
    env = {},
    timeout_sec = 600,
    deps = [],
    labels = [],
    lockfile_label = None,
    kind = "test",
    **kwargs
):
    if (lockfile_label == None or lockfile_label == "") and len(extract_lockfile_labels(labels or [])) == 0:
        default_path = default_lockfile_path_from_package()
        ensure_default_lockfile_exists(default_path, "nix_node_test")
        lockfile_label = default_lockfile_label_from_package()
    wiring = prepare_language_wiring(
        name = name,
        kwargs = {},
        deps = deps,
        lang = "node",
        kind = kind,
        labels = (labels or []),
        lockfile_label = lockfile_label,
        patch_into = "srcs",
        patch_base = list(srcs),
        MODULE_PROVIDERS = MODULE_PROVIDERS,
        global_inputs_into = "srcs",
        global_inputs_stamp = False,
        wiring = "non_genrule_nix_calling",
    )
    kw = wiring.kwargs

    # Forward to external runner rule; ignore legacy 'cmd'
    node_nix_test(
        name = name,
        importer = wiring.importer,
        patterns = ([] if patterns == None else patterns),
        env = (env or {}),
        timeout_sec = timeout_sec,
        srcs = (kw.get("srcs", []) or []),
        deps = wiring.deps,
        labels = kw.get("labels", []),
        out = (out if out != None else (name + ".stamp")),
        **kwargs
    )

def nix_node_lib(name, **kwargs):
    nix_node_gen(name = name, kind = "lib", **kwargs)

def nix_node_bin(name, **kwargs):
    nix_node_gen(name = name, kind = "bin", **kwargs)


