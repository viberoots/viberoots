load("@viberoots//build-tools/lang:defs_common.bzl", "dedupe_preserve")
load("@viberoots//build-tools/tools/buck:zx_test.bzl", "zx_test")
load(
    "@viberoots//build-tools/tools/tests:deployment_conventions.bzl",
    "deployment_convention_for_script",
    "validate_deployment_convention",
)
load(
    "@viberoots//build-tools/tools/tests:isolated_test_conventions.bzl",
    "isolated_test_convention_for_script",
)
load(
    "@viberoots//build-tools/tools/tests:resource_limited_conventions.bzl",
    "resource_limited_convention_for_script",
    "validate_resource_limited_convention",
)
load(
    "@viberoots//build-tools/tools/tests:template_conventions.bzl",
    "template_convention_for_script",
    "validate_template_convention",
)

def _name_from(path: str) -> str:
    # Strip the build-tools/tools/tests/ prefix and extension, flatten to underscores.
    n = path
    if n.startswith("build-tools/tools/tests/"):
        n = n[len("build-tools/tools/tests/"):]
    if n.endswith(".ts"):
        n = n[:-3]
    # Drop trailing ".test" segment if present to preserve legacy target names
    if n.endswith(".test"):
        n = n[:-5]
    # Normalize separators/hyphens to underscores for stable legacy labels
    n = n.replace("/", "_").replace(".", "_").replace("-", "_")
    # Buck target names must be reasonably short; keep as-is for now.
    return n

def auto_zx_tests(root = "build-tools/tools/tests", patterns = ["**/*.test.ts"]):
    files = []
    for p in patterns:
        for f in native.glob(["%s/%s" % (root, p)], exclude=["**/node_modules/**", "**/.direnv/**"]):
            files.append(f)
    for f in sorted(files):
        name = _name_from(f)
        convention = template_convention_for_script(f)
        labels = []
        template_inputs = []
        if convention != None:
            labels = convention.get("labels", [])
            input_globs = convention.get("template_input_globs", [])
            for g in input_globs:
                template_inputs.extend(native.glob([g], exclude=["**/node_modules/**", "**/.direnv/**"]))
        deployment_convention = deployment_convention_for_script(f)
        if deployment_convention != None:
            labels = dedupe_preserve(labels + deployment_convention.get("labels", []))
        isolated_test_convention = isolated_test_convention_for_script(f)
        if isolated_test_convention != None:
            labels = dedupe_preserve(labels + isolated_test_convention.get("labels", []))
        resource_limited_convention = resource_limited_convention_for_script(f)
        if resource_limited_convention != None:
            labels = dedupe_preserve(labels + resource_limited_convention.get("labels", []))
        validate_template_convention(f, labels, template_inputs)
        validate_deployment_convention(f, labels)
        validate_resource_limited_convention(f, labels)
        zx_test(
            name = name,
            script = f,
            out = name + ".stamp",
            test_rule_timeout_ms = 20 * 60 * 1000,
            labels = labels,
            template_inputs = sorted(template_inputs),
        )
