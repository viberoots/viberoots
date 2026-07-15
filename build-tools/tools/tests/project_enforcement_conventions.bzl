VERIFY_PROJECT_ENFORCEMENT_LABEL = "verify:project-enforcement"
PROJECT_ENFORCEMENT_SUFFIX = ".project-enforcement.test.ts"

def project_enforcement_convention_for_script(path):
    if path.endswith(PROJECT_ENFORCEMENT_SUFFIX):
        return {
            "labels": [VERIFY_PROJECT_ENFORCEMENT_LABEL],
        }
    return None

def validate_project_enforcement_convention(path, labels):
    has_label = VERIFY_PROJECT_ENFORCEMENT_LABEL in (labels or [])
    if path.endswith(PROJECT_ENFORCEMENT_SUFFIX):
        if not has_label:
            fail("project-enforcement test must include %s: %s" % (VERIFY_PROJECT_ENFORCEMENT_LABEL, path))
        return
    if has_label:
        fail("non-project-enforcement test must not include %s: %s" % (VERIFY_PROJECT_ENFORCEMENT_LABEL, path))

def _project_enforcement_convention_probe_impl(ctx):
    validate_project_enforcement_convention(ctx.attrs.script_path, ctx.attrs.test_labels)
    return [DefaultInfo()]

project_enforcement_convention_probe = rule(
    impl = _project_enforcement_convention_probe_impl,
    attrs = {
        "script_path": attrs.string(),
        "test_labels": attrs.list(attrs.string()),
    },
)
