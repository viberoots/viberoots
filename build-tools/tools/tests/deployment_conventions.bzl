load(
    "//build-tools/tools/tests/deployments:deployment_domain_taxonomy.bzl",
    "REVIEWED_DEPLOYMENT_TEST_OWNERSHIP",
)

DEPLOYMENT_DOMAIN_LABEL = "domain:deployment"
REVIEWED_DEPLOYMENT_TEST_AREA = "build-tools/tools/tests/deployments/"

DEPLOYMENT_DOMAIN_TAXONOMY_FILE = (
    "//build-tools/tools/tests/deployments:deployment_domain_taxonomy.bzl"
)

def _classification_error(path):
    fail("deployment-domain taxonomy drift: classify %s explicitly in %s" % (path, DEPLOYMENT_DOMAIN_TAXONOMY_FILE))

def _is_reviewed_deployment_test(path):
    return path.startswith(REVIEWED_DEPLOYMENT_TEST_AREA)

def deployment_convention_for_script(path):
    if not _is_reviewed_deployment_test(path):
        return None
    deployment_owned = REVIEWED_DEPLOYMENT_TEST_OWNERSHIP.get(path)
    if deployment_owned == None:
        _classification_error(path)
    return {
        "labels": [DEPLOYMENT_DOMAIN_LABEL] if deployment_owned else [],
    }

def validate_deployment_convention(path, labels):
    has_label = DEPLOYMENT_DOMAIN_LABEL in (labels or [])
    if not _is_reviewed_deployment_test(path):
        if has_label:
            fail("non-deployment test must not declare %s: %s" % (DEPLOYMENT_DOMAIN_LABEL, path))
        return
    deployment_owned = REVIEWED_DEPLOYMENT_TEST_OWNERSHIP.get(path)
    if deployment_owned == None:
        _classification_error(path)
    if deployment_owned and not has_label:
        fail("deployment-owned test must include %s: %s" % (DEPLOYMENT_DOMAIN_LABEL, path))
    if (not deployment_owned) and has_label:
        fail("reviewed non-deployment test must not include %s: %s" % (DEPLOYMENT_DOMAIN_LABEL, path))
