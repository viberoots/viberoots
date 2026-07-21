load(
    "@viberoots//build-tools/lang:defs_common.bzl",
    "default_lockfile_label_from_package",
    "default_lockfile_path_from_package",
    "ensure_default_lockfile_exists",
    "extract_lockfile_labels",
    "prepare_language_wiring",
)
load("@viberoots//build-tools/lang:filtered_source_policy.bzl", "FILTERED_ARTIFACT_SOURCE_GLOB_EXCLUDES")

def _node_importer_action_srcs(srcs):
    if not isinstance(srcs, dict):
        return srcs
    importer = native.package_name()
    declared = {}
    for source in native.glob(
        ["*", ".*", "**/*", "**/.*"],
        exclude = FILTERED_ARTIFACT_SOURCE_GLOB_EXCLUDES,
    ):
        declared["%s/%s" % (importer, source)] = source
    for destination, source in srcs.items():
        relative = destination
        if importer and not destination.startswith(importer + "/"):
            relative = "%s/%s" % (importer, destination)
        declared[relative] = source
    return declared

def fail_importer_arg_mismatch(macro_name, importer, lockfile_importer, lockfile_label):
    fail(
        ("%s: importer must match the importer suffix in the single lockfile label; " % macro_name) +
        ("importer=%s lockfile_importer=%s lockfile_label=%s" % (importer, lockfile_importer, lockfile_label)),
    )

def effective_lockfile_label_from_wiring(wiring):
    lf = extract_lockfile_labels(wiring.kwargs.get("labels", []) or [])
    if len(lf) == 1:
        return lf[0]
    return lf

def validate_optional_importer_arg_matches_wiring(importer, wiring, macro_name):
    if importer == None:
        return
    if importer != wiring.importer:
        fail_importer_arg_mismatch(
            macro_name = macro_name,
            importer = importer,
            lockfile_importer = wiring.importer,
            lockfile_label = effective_lockfile_label_from_wiring(wiring),
        )

def apply_default_lockfile_label(lockfile_label, labels, macro_name):
    if (lockfile_label == None or lockfile_label == "") and len(extract_lockfile_labels(labels or [])) == 0:
        default_path = default_lockfile_path_from_package()
        ensure_default_lockfile_exists(default_path, macro_name)
        return default_lockfile_label_from_package()
    return lockfile_label

def prepare_node_importer_nix_calling_genrule_kwargs(
        name,
        kwargs,
        srcs,
        deps,
        kind,
        MODULE_PROVIDERS,
        labels = [],
        lockfile_label = None):
    return prepare_language_wiring(
        name = name,
        kwargs = kwargs,
        srcs = _node_importer_action_srcs(srcs),
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
