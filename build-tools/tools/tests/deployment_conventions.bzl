DEPLOYMENT_DOMAIN_LABEL = "domain:deployment"
REVIEWED_DEPLOYMENT_TEST_AREA = "build-tools/tools/tests/deployments/"

_REVIEWED_DEPLOYMENT_TEST_OWNERSHIP = {
    "build-tools/tools/tests/deployments/deployment-domain.labels.cquery.test.ts": True,
    "build-tools/tools/tests/deployments/deployment-domain.taxonomy-drift.test.ts": True,
    "build-tools/tools/tests/deployments/deployment-verify-scope.boundary.test.ts": True,
    "build-tools/tools/tests/deployments/cloudflare-pages.contract.test.ts": True,
    "build-tools/tools/tests/deployments/cloudflare-pages.deploy.e2e.test.ts": True,
    "build-tools/tools/tests/deployments/cloudflare-pages.extraction.from-targets.cquery.test.ts": True,
    "build-tools/tools/tests/deployments/cloudflare-pages.promotion.e2e.test.ts": True,
    "build-tools/tools/tests/deployments/cloudflare-pages.promotion.guardrails.test.ts": True,
    "build-tools/tools/tests/deployments/cloudflare-pages.publisher.config-drift.test.ts": True,
    "build-tools/tools/tests/deployments/cloudflare-pages.validation.test.ts": True,
    "build-tools/tools/tests/deployments/nixos-shared-host.control-plane.test.ts": True,
    "build-tools/tools/tests/deployments/nixos-shared-host.contract.test.ts": True,
    "build-tools/tools/tests/deployments/nixos-shared-host.deploy.e2e.test.ts": True,
    "build-tools/tools/tests/deployments/nixos-shared-host.deploy.jenkins.contract.test.ts": True,
    "build-tools/tools/tests/deployments/nixos-shared-host.deploy.jenkins.exec.test.ts": True,
    "build-tools/tools/tests/deployments/nixos-shared-host.deploy.remote-exec.failures.test.ts": True,
    "build-tools/tools/tests/deployments/nixos-shared-host.deploy.remote-exec.test.ts": True,
    "build-tools/tools/tests/deployments/nixos-shared-host.deploy.remote-host-apply.test.ts": True,
    "build-tools/tools/tests/deployments/nixos-shared-host.deploy.failure-records.test.ts": True,
    "build-tools/tools/tests/deployments/nixos-shared-host.deploy.remote-plan.test.ts": True,
    "build-tools/tools/tests/deployments/nixos-shared-host.deploy.remote-ssh.command-assembly.test.ts": True,
    "build-tools/tools/tests/deployments/nixos-shared-host.explicit-removal.test.ts": True,
    "build-tools/tools/tests/deployments/nixos-shared-host.extraction.from-targets.cquery.test.ts": True,
    "build-tools/tools/tests/deployments/nixos-shared-host.host-module.duplicate-hostname.nix.test.ts": True,
    "build-tools/tools/tests/deployments/nixos-shared-host.host-module.nix-eval.test.ts": True,
    "build-tools/tools/tests/deployments/nixos-shared-host.host-render.conflicts.test.ts": True,
    "build-tools/tools/tests/deployments/nixos-shared-host.host-render.contract.test.ts": True,
    "build-tools/tools/tests/deployments/nixos-shared-host.host-render.duplicate-hostname.test.ts": True,
    "build-tools/tools/tests/deployments/nixos-shared-host.host-render.partial-slice-preserves.test.ts": True,
    "build-tools/tools/tests/deployments/nixos-shared-host.install.dev-machine.test.ts": True,
    "build-tools/tools/tests/deployments/nixos-shared-host.install.dry-run-and-status.test.ts": True,
    "build-tools/tools/tests/deployments/nixos-shared-host.install.host-modes.test.ts": True,
    "build-tools/tools/tests/deployments/nixos-shared-host.install.manifest.contract.test.ts": True,
    "build-tools/tools/tests/deployments/nixos-shared-host.install.prompt.test.ts": True,
    "build-tools/tools/tests/deployments/nixos-shared-host.install.reinstall.test.ts": True,
    "build-tools/tools/tests/deployments/nixos-shared-host.platform-state.full-reconcile.test.ts": True,
    "build-tools/tools/tests/deployments/nixos-shared-host.platform-state.remove.test.ts": True,
    "build-tools/tools/tests/deployments/nixos-shared-host.platform-state.scoped-create.test.ts": True,
    "build-tools/tools/tests/deployments/nixos-shared-host.platform-state.scoped-omit-preserves.test.ts": True,
    "build-tools/tools/tests/deployments/nixos-shared-host.platform-state.scoped-update.test.ts": True,
    "build-tools/tools/tests/deployments/nixos-shared-host.publish.missing-target.test.ts": True,
    "build-tools/tools/tests/deployments/nixos-shared-host.publisher.contract.test.ts": True,
    "build-tools/tools/tests/deployments/nixos-shared-host.replay.rollback-eligibility.test.ts": True,
    "build-tools/tools/tests/deployments/nixos-shared-host.remote-transport.fake.ts": False,
    "build-tools/tools/tests/deployments/nixos-shared-host.replay.contract.test.ts": True,
    "build-tools/tools/tests/deployments/nixos-shared-host.reuse.rollback-guardrails.test.ts": True,
    "build-tools/tools/tests/deployments/nixos-shared-host.reuse.e2e.test.ts": True,
    "build-tools/tools/tests/deployments/nixos-shared-host.records.contract.test.ts": True,
    "build-tools/tools/tests/deployments/nixos-shared-host.validation.test.ts": True,
}

def _classification_error(path):
    fail("deployment-domain taxonomy drift: classify %s explicitly in //build-tools/tools/tests:deployment_conventions.bzl" % path)

def _is_reviewed_deployment_test(path):
    return path.startswith(REVIEWED_DEPLOYMENT_TEST_AREA)

def deployment_convention_for_script(path):
    if not _is_reviewed_deployment_test(path):
        return None
    deployment_owned = _REVIEWED_DEPLOYMENT_TEST_OWNERSHIP.get(path)
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
    deployment_owned = _REVIEWED_DEPLOYMENT_TEST_OWNERSHIP.get(path)
    if deployment_owned == None:
        _classification_error(path)
    if deployment_owned and not has_label:
        fail("deployment-owned test must include %s: %s" % (DEPLOYMENT_DOMAIN_LABEL, path))
    if (not deployment_owned) and has_label:
        fail("reviewed non-deployment test must not include %s: %s" % (DEPLOYMENT_DOMAIN_LABEL, path))
