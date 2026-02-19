load("//build-tools/tools/buck:zx_test.bzl", "zx_test")
load(
    "//build-tools/tools/tests:template_conventions.bzl",
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
        validate_template_convention(f, labels, template_inputs)
        zx_test(
            name = name,
            script = f,
            out = name + ".stamp",
            test_rule_timeout_ms = 20 * 60 * 1000,
            labels = labels,
            template_inputs = sorted(template_inputs),
        )


