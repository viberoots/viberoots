load("@viberoots//build-tools/tools/tests:heavy_fanout_taxonomy.bzl", "HEAVY_FANOUT_TESTS")

VERIFY_HEAVY_FANOUT_LABEL = "verify:heavy-fanout"
VERIFY_RESOURCE_LIMITED_LABEL = "verify:resource-limited"
VIBEROOTS_HEAVY_FANOUT_POOL = "@viberoots//:viberoots_heavy_fanout"

def heavy_fanout_convention_for_script(path):
    if not HEAVY_FANOUT_TESTS.get(path, False):
        return None
    return {
        "labels": [VERIFY_HEAVY_FANOUT_LABEL],
        "pool": VIBEROOTS_HEAVY_FANOUT_POOL,
    }

def validate_heavy_fanout_convention(path, labels, pool):
    expected = HEAVY_FANOUT_TESTS.get(path, False)
    has_label = VERIFY_HEAVY_FANOUT_LABEL in (labels or [])
    if expected != has_label:
        fail("heavy-fanout marker taxonomy drift for %s" % path)
    if expected and VERIFY_RESOURCE_LIMITED_LABEL not in (labels or []):
        fail("heavy-fanout test must also be resource-limited: %s" % path)
    if expected and pool != VIBEROOTS_HEAVY_FANOUT_POOL:
        fail("heavy-fanout test must use the shared pool: %s" % path)
    if not expected and pool != None:
        fail("ordinary test unexpectedly uses the heavy-fanout pool: %s" % path)
