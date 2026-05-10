VERIFY_ISOLATED_LABEL = "verify:isolated"

ISOLATED_TESTS = {
    "build-tools/tools/tests/dev/verify.orphan-owned-process-cleanup.test.ts": True,
    "build-tools/tools/tests/dev/verify.temp-repo-buck-cleanup.scoped.test.ts": True,
}

def isolated_test_convention_for_script(path):
    if ISOLATED_TESTS.get(path, False):
        return {
            "labels": [VERIFY_ISOLATED_LABEL],
        }
    return None
