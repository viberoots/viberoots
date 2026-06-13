load("@viberoots//build-tools/tools/tests:resource_limited_taxonomy.bzl", "RESOURCE_LIMITED_TESTS")

VERIFY_RESOURCE_LIMITED_LABEL = "verify:resource-limited"

def resource_limited_convention_for_script(path):
    if RESOURCE_LIMITED_TESTS.get(path, False):
        return {
            "labels": [VERIFY_RESOURCE_LIMITED_LABEL],
        }
    return None

def validate_resource_limited_convention(path, labels):
    has_label = VERIFY_RESOURCE_LIMITED_LABEL in (labels or [])
    if not has_label:
        return
    if path.startswith("build-tools/tools/tests/deployments/"):
        return
    if not RESOURCE_LIMITED_TESTS.get(path, False):
        fail("non-deployment resource-limited test must be listed in RESOURCE_LIMITED_TESTS: %s" % path)
