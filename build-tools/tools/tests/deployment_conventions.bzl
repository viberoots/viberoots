load(
    "//build-tools/tools/tests/deployments:deployment_domain_taxonomy.bzl",
    "REVIEWED_DEPLOYMENT_TEST_OWNERSHIP",
)

DEPLOYMENT_DOMAIN_LABEL = "domain:deployment"
VERIFY_RESOURCE_LIMITED_LABEL = "verify:resource-limited"
REVIEWED_DEPLOYMENT_TEST_AREA = "build-tools/tools/tests/deployments/"

DEPLOYMENT_DOMAIN_TAXONOMY_FILE = (
    "//build-tools/tools/tests/deployments:deployment_domain_taxonomy.bzl"
)

_TEMP_REPO_DEPLOYMENT_TESTS = {
    "build-tools/tools/tests/deployments/app-store-connect.e2e.test.ts": True,
    "build-tools/tools/tests/deployments/cloudflare-pages.artifact-input.service.test.ts": True,
    "build-tools/tools/tests/deployments/cloudflare-pages.backend-recovery.test.ts": True,
    "build-tools/tools/tests/deployments/cloudflare-pages.control-plane.service-errors.test.ts": True,
    "build-tools/tools/tests/deployments/cloudflare-pages.control-plane.service.test.ts": True,
    "build-tools/tools/tests/deployments/cloudflare-pages.deploy.e2e.test.ts": True,
    "build-tools/tools/tests/deployments/cloudflare-pages.extraction.from-targets.cquery.test.ts": True,
    "build-tools/tools/tests/deployments/cloudflare-pages.preview.e2e.test.ts": True,
    "build-tools/tools/tests/deployments/cloudflare-pages.preview.guardrails.test.ts": True,
    "build-tools/tools/tests/deployments/cloudflare-pages.preview.smoke-exception.e2e.test.ts": True,
    "build-tools/tools/tests/deployments/cloudflare-pages.promotion.e2e.test.ts": True,
    "build-tools/tools/tests/deployments/cloudflare-pages.promotion.guardrails.test.ts": True,
    "build-tools/tools/tests/deployments/cloudflare-pages.publisher.config-drift.test.ts": True,
    "build-tools/tools/tests/deployments/cloudflare-pages.rebuild-per-stage.promotion.test.ts": True,
    "build-tools/tools/tests/deployments/cloudflare-pages.rollback.e2e.test.ts": True,
    "build-tools/tools/tests/deployments/cloudflare-pages.rollback.guardrails.test.ts": True,
    "build-tools/tools/tests/deployments/cloudflare-pages.secretspec.e2e.test.ts": True,
    "build-tools/tools/tests/deployments/cloudflare-pages.status-profile.test.ts": True,
    "build-tools/tools/tests/deployments/cloudflare-pages.target-transition.test.ts": True,
    "build-tools/tools/tests/deployments/cloudflare-pages.timeout.test.ts": True,
    "build-tools/tools/tests/deployments/cloudflare-pages.vault-direct.e2e.test.ts": True,
    "build-tools/tools/tests/deployments/deploy.admission-requirements.contract.test.ts": True,
    "build-tools/tools/tests/deployments/deploy.admit-only.contract.test.ts": True,
    "build-tools/tools/tests/deployments/deploy.front-door.contract.test.ts": True,
    "build-tools/tools/tests/deployments/deploy.front-door.control-plane-operator.contract.test.ts": True,
    "build-tools/tools/tests/deployments/deploy.front-door.hosted-status-ux.test.ts": True,
    "build-tools/tools/tests/deployments/deploy.front-door.provider-target-identity.contract.test.ts": True,
    "build-tools/tools/tests/deployments/deployment-admin-keycloak.remote-profile.pr98.errors.test.ts": True,
    "build-tools/tools/tests/deployments/deployment-admin-keycloak.remote-profile.pr98.happy-path.test.ts": True,
    "build-tools/tools/tests/deployments/deployment-admin-keycloak.remote-profile.test.ts": True,
    "build-tools/tools/tests/deployments/deployment-admission.cli.test.ts": True,
    "build-tools/tools/tests/deployments/deployment-admission.prerequisites.test.ts": True,
    "build-tools/tools/tests/deployments/deployment-admission.supply-chain.replay.test.ts": True,
    "build-tools/tools/tests/deployments/deployment-artifact-proof-keys.test.ts": True,
    "build-tools/tools/tests/deployments/deployment-auth-session.pr90.service.test.ts": True,
    "build-tools/tools/tests/deployments/deployment-auth-session.pr98.service.test.ts": True,
    "build-tools/tools/tests/deployments/deployment-auth-session.service.test.ts": True,
    "build-tools/tools/tests/deployments/deployment-cli-resolve.test.ts": True,
    "build-tools/tools/tests/deployments/deployment-control-plane.approval-grant.test.ts": True,
    "build-tools/tools/tests/deployments/deployment-control-plane.authz-idempotency.test.ts": True,
    "build-tools/tools/tests/deployments/deployment-control-plane.bootstrap.test.ts": True,
    "build-tools/tools/tests/deployments/deployment-control-plane.break-glass.test.ts": True,
    "build-tools/tools/tests/deployments/deployment-control-plane.observability.test.ts": True,
    "build-tools/tools/tests/deployments/deployment-control-plane.pending-approval.test.ts": True,
    "build-tools/tools/tests/deployments/deployment-control-plane.pr28.test.ts": True,
    "build-tools/tools/tests/deployments/deployment-control-plane.progressive-rollout.test.ts": True,
    "build-tools/tools/tests/deployments/deployment-control-plane.recovery.test.ts": True,
    "build-tools/tools/tests/deployments/deployment-control-plane.redaction.test.ts": True,
    "build-tools/tools/tests/deployments/deployment-control-plane.restore.test.ts": True,
    "build-tools/tools/tests/deployments/deployment-control-plane.retention.policy.test.ts": True,
    "build-tools/tools/tests/deployments/deployment-domain.taxonomy-drift.test.ts": True,
    "build-tools/tools/tests/deployments/deployment-git-ref.fetch.test.ts": True,
    "build-tools/tools/tests/deployments/deployment-lane-governance.verify.test.ts": True,
    "build-tools/tools/tests/deployments/deployment-runner-identities.replay.provenance.test.ts": True,
    "build-tools/tools/tests/deployments/deployment-targets.install.cloudflare.test.ts": True,
    "build-tools/tools/tests/deployments/deployment-vault-bootstrap.test.ts": True,
    "build-tools/tools/tests/deployments/google-play.e2e.test.ts": True,
    "build-tools/tools/tests/deployments/kubernetes.control-plane.reviewed-source.test.ts": True,
    "build-tools/tools/tests/deployments/kubernetes.control-plane.service.test.ts": True,
    "build-tools/tools/tests/deployments/kubernetes.deploy.e2e.test.ts": True,
    "build-tools/tools/tests/deployments/kubernetes.opentofu-stack.test.ts": True,
    "build-tools/tools/tests/deployments/kubernetes.publisher.config-drift.test.ts": True,
    "build-tools/tools/tests/deployments/nixos-shared-host.artifact-binding.service.test.ts": True,
    "build-tools/tools/tests/deployments/nixos-shared-host.challenge-authz.test.ts": True,
    "build-tools/tools/tests/deployments/nixos-shared-host.challenged-submit-transaction.test.ts": True,
    "build-tools/tools/tests/deployments/nixos-shared-host.control-plane-service-env.test.ts": True,
    "build-tools/tools/tests/deployments/nixos-shared-host.control-plane.backend.test.ts": True,
    "build-tools/tools/tests/deployments/nixos-shared-host.control-plane.direct-reject.test.ts": True,
    "build-tools/tools/tests/deployments/nixos-shared-host.control-plane.governance.service.test.ts": True,
    "build-tools/tools/tests/deployments/nixos-shared-host.control-plane.reviewed-source.github-ssh.test.ts": True,
    "build-tools/tools/tests/deployments/nixos-shared-host.control-plane.reviewed-source.test.ts": True,
    "build-tools/tools/tests/deployments/nixos-shared-host.control-plane.service.test.ts": True,
    "build-tools/tools/tests/deployments/nixos-shared-host.control-plane.test.ts": True,
    "build-tools/tools/tests/deployments/nixos-shared-host.deploy-auth-callback-module.nix-eval.test.ts": True,
    "build-tools/tools/tests/deployments/nixos-shared-host.deploy.admit-discoverability.test.ts": True,
    "build-tools/tools/tests/deployments/nixos-shared-host.deploy.default-profile.test.ts": True,
    "build-tools/tools/tests/deployments/nixos-shared-host.deploy.e2e.test.ts": True,
    "build-tools/tools/tests/deployments/nixos-shared-host.deploy.failure-records.test.ts": True,
    "build-tools/tools/tests/deployments/nixos-shared-host.deploy.jenkins.contract.test.ts": True,
    "build-tools/tools/tests/deployments/nixos-shared-host.deploy.jenkins.exec.test.ts": True,
    "build-tools/tools/tests/deployments/nixos-shared-host.deploy.remote-auth-admit.test.ts": True,
    "build-tools/tools/tests/deployments/nixos-shared-host.deploy.remote-auth-session.test.ts": True,
    "build-tools/tools/tests/deployments/nixos-shared-host.deploy.remote-exec.failures.test.ts": True,
    "build-tools/tools/tests/deployments/nixos-shared-host.deploy.remote-exec.test.ts": True,
    "build-tools/tools/tests/deployments/nixos-shared-host.deploy.remote-host-apply.test.ts": True,
    "build-tools/tools/tests/deployments/nixos-shared-host.deploy.remote-plan.test.ts": True,
    "build-tools/tools/tests/deployments/nixos-shared-host.deploy.remote-reviewed-source.test.ts": True,
    "build-tools/tools/tests/deployments/nixos-shared-host.deployment-service-module.nix-eval.test.ts": True,
    "build-tools/tools/tests/deployments/nixos-shared-host.early-rejection-cleanup.test.ts": True,
    "build-tools/tools/tests/deployments/nixos-shared-host.explicit-removal.test.ts": True,
    "build-tools/tools/tests/deployments/nixos-shared-host.extraction.from-targets.cquery.test.ts": True,
    "build-tools/tools/tests/deployments/nixos-shared-host.host-module.duplicate-hostname.nix.test.ts": True,
    "build-tools/tools/tests/deployments/nixos-shared-host.host-module.nix-eval.test.ts": True,
    "build-tools/tools/tests/deployments/nixos-shared-host.host-render.partial-slice-preserves.test.ts": True,
    "build-tools/tools/tests/deployments/nixos-shared-host.identity-provider.generated-imports.nix-eval.test.ts": True,
    "build-tools/tools/tests/deployments/nixos-shared-host.identity-provider.host-secret-boundary.nix-eval.test.ts": True,
    "build-tools/tools/tests/deployments/nixos-shared-host.identity-provider.pr95.realm-files.nix-eval.test.ts": True,
    "build-tools/tools/tests/deployments/nixos-shared-host.install.dry-run-and-status.test.ts": True,
    "build-tools/tools/tests/deployments/nixos-shared-host.install.host-modes.test.ts": True,
    "build-tools/tools/tests/deployments/nixos-shared-host.install.reinstall.test.ts": True,
    "build-tools/tools/tests/deployments/nixos-shared-host.install.ssh-guess.test.ts": True,
    "build-tools/tools/tests/deployments/nixos-shared-host.multi-component.deploy.e2e.test.ts": True,
    "build-tools/tools/tests/deployments/nixos-shared-host.multi-component.promotion.e2e.test.ts": True,
    "build-tools/tools/tests/deployments/nixos-shared-host.multi-component.replay.e2e.test.ts": True,
    "build-tools/tools/tests/deployments/nixos-shared-host.promotion.approval.backend-source.test.ts": True,
    "build-tools/tools/tests/deployments/nixos-shared-host.promotion.backend-source.test.ts": True,
    "build-tools/tools/tests/deployments/nixos-shared-host.promotion.e2e.test.ts": True,
    "build-tools/tools/tests/deployments/nixos-shared-host.provision-only.test.ts": True,
    "build-tools/tools/tests/deployments/nixos-shared-host.publish.missing-target.test.ts": True,
    "build-tools/tools/tests/deployments/nixos-shared-host.publisher.contract.test.ts": True,
    "build-tools/tools/tests/deployments/nixos-shared-host.release-actions.failure-path.replay.test.ts": True,
    "build-tools/tools/tests/deployments/nixos-shared-host.release-actions.failure-path.test.ts": True,
    "build-tools/tools/tests/deployments/nixos-shared-host.release-actions.replay-policy.test.ts": True,
    "build-tools/tools/tests/deployments/nixos-shared-host.release-actions.rollback.test.ts": True,
    "build-tools/tools/tests/deployments/nixos-shared-host.replay.contract.test.ts": True,
    "build-tools/tools/tests/deployments/nixos-shared-host.replay.provenance.test.ts": True,
    "build-tools/tools/tests/deployments/nixos-shared-host.replay.retention.test.ts": True,
    "build-tools/tools/tests/deployments/nixos-shared-host.replay.rollback-eligibility.test.ts": True,
    "build-tools/tools/tests/deployments/nixos-shared-host.reuse.e2e.test.ts": True,
    "build-tools/tools/tests/deployments/nixos-shared-host.reuse.rollback-guardrails.test.ts": True,
    "build-tools/tools/tests/deployments/nixos-shared-host.rollback.e2e.test.ts": True,
    "build-tools/tools/tests/deployments/nixos-shared-host.service-auth-boundary.test.ts": True,
    "build-tools/tools/tests/deployments/nixos-shared-host.service-auth-reporting.test.ts": True,
    "build-tools/tools/tests/deployments/nixos-shared-host.service-modules.nix-eval.test.ts": True,
    "build-tools/tools/tests/deployments/nixos-shared-host.service-only.fail-closed.test.ts": True,
    "build-tools/tools/tests/deployments/nixos-shared-host.staged-artifact-cleanup.test.ts": True,
    "build-tools/tools/tests/deployments/nixos-shared-host.target-exceptions.replay.test.ts": True,
    "build-tools/tools/tests/deployments/s3-static.control-plane.reviewed-source.test.ts": True,
    "build-tools/tools/tests/deployments/s3-static.control-plane.service.test.ts": True,
    "build-tools/tools/tests/deployments/s3-static.deploy.e2e.test.ts": True,
    "build-tools/tools/tests/deployments/s3-static.publisher.config-drift.test.ts": True,
    "build-tools/tools/tests/deployments/static-webapp-artifact-admission.test.ts": True,
}

_RESOURCE_LIMITED_DEPLOYMENT_TEST_EXEMPTIONS = {
    # Full-suite timing comparison showed these targets did not benefit from
    # the bounded deployment lane. Keeping them shared shortens the bounded
    # lane while adding little shared-pass work.
    "build-tools/tools/tests/deployments/app-store-connect.e2e.test.ts": True,
    "build-tools/tools/tests/deployments/cloudflare-pages.promotion.guardrails.test.ts": True,
    "build-tools/tools/tests/deployments/deployment-control-plane.observability.test.ts": True,
    "build-tools/tools/tests/deployments/deployment-targets.install.cloudflare.test.ts": True,
    "build-tools/tools/tests/deployments/nixos-shared-host.control-plane.governance.service.test.ts": True,
    "build-tools/tools/tests/deployments/nixos-shared-host.host-module.nix-eval.test.ts": True,
    "build-tools/tools/tests/deployments/nixos-shared-host.identity-provider.pr95.realm-files.nix-eval.test.ts": True,
    "build-tools/tools/tests/deployments/nixos-shared-host.install.host-modes.test.ts": True,
    "build-tools/tools/tests/deployments/nixos-shared-host.install.ssh-guess.test.ts": True,
    "build-tools/tools/tests/deployments/static-webapp-artifact-admission.test.ts": True,
}

def _classification_error(path):
    fail("deployment-domain taxonomy drift: classify %s explicitly in %s" % (path, DEPLOYMENT_DOMAIN_TAXONOMY_FILE))

def _is_reviewed_deployment_test(path):
    return path.startswith(REVIEWED_DEPLOYMENT_TEST_AREA)

def _is_resource_limited_deployment_test(path):
    if path in _RESOURCE_LIMITED_DEPLOYMENT_TEST_EXEMPTIONS:
        return False
    return path.endswith(".e2e.test.ts") or path in _TEMP_REPO_DEPLOYMENT_TESTS

def deployment_convention_for_script(path):
    if not _is_reviewed_deployment_test(path):
        return None
    deployment_owned = REVIEWED_DEPLOYMENT_TEST_OWNERSHIP.get(path)
    if deployment_owned == None:
        _classification_error(path)
    labels = [DEPLOYMENT_DOMAIN_LABEL] if deployment_owned else []
    if deployment_owned and _is_resource_limited_deployment_test(path):
        labels.append(VERIFY_RESOURCE_LIMITED_LABEL)
    return {
        "labels": labels,
    }

def validate_deployment_convention(path, labels):
    has_label = DEPLOYMENT_DOMAIN_LABEL in (labels or [])
    has_resource_limited_label = VERIFY_RESOURCE_LIMITED_LABEL in (labels or [])
    if not _is_reviewed_deployment_test(path):
        if has_label:
            fail("non-deployment test must not declare %s: %s" % (DEPLOYMENT_DOMAIN_LABEL, path))
        if has_resource_limited_label:
            fail("non-deployment test must not declare %s: %s" % (VERIFY_RESOURCE_LIMITED_LABEL, path))
        return
    deployment_owned = REVIEWED_DEPLOYMENT_TEST_OWNERSHIP.get(path)
    if deployment_owned == None:
        _classification_error(path)
    if deployment_owned and not has_label:
        fail("deployment-owned test must include %s: %s" % (DEPLOYMENT_DOMAIN_LABEL, path))
    if (not deployment_owned) and has_label:
        fail("reviewed non-deployment test must not include %s: %s" % (DEPLOYMENT_DOMAIN_LABEL, path))
    if (not deployment_owned) and has_resource_limited_label:
        fail("reviewed non-deployment test must not include %s: %s" % (VERIFY_RESOURCE_LIMITED_LABEL, path))
    if deployment_owned and _is_resource_limited_deployment_test(path) and not has_resource_limited_label:
        fail("resource-limited deployment test must include %s: %s" % (VERIFY_RESOURCE_LIMITED_LABEL, path))
