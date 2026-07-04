VERIFY_ENFORCEMENT_LABEL = "verify:enforcement"

def enforcement_convention_for_script(path):
    if path.endswith(".enforcement.test.ts"):
        return {
            "labels": [VERIFY_ENFORCEMENT_LABEL],
        }
    return None

def validate_enforcement_convention(path, labels):
    has_label = VERIFY_ENFORCEMENT_LABEL in (labels or [])
    if path.endswith(".enforcement.test.ts"):
        if not has_label:
            fail("enforcement test must include %s: %s" % (VERIFY_ENFORCEMENT_LABEL, path))
        return
    if has_label:
        fail("non-enforcement test must not include %s: %s" % (VERIFY_ENFORCEMENT_LABEL, path))
