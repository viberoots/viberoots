# viberoots Documentation

This index separates current operator manuals from plans, ADRs, and historical records. Prefer the
manuals for day-to-day setup and operations; use plans and history as implementation context.

## Start Here

- [`deployments-usage.md`](deployments-usage.md): deployment CLI workflows and operator behavior.
- [`control-plane-guide.md`](control-plane-guide.md): deployment control-plane setup, runtime,
  evidence, readiness, and cutover.
- [`cloud-control-setup.md`](cloud-control-setup.md): reviewed cloud-control host-profile bundle
  generation.
- [`aws-account-control-plane-and-remote-builds.md`](aws-account-control-plane-and-remote-builds.md):
  end-to-end fresh AWS account setup for the control plane, remote builds, and remote-test readiness.
- [`cloud-control-cutover.md`](cloud-control-cutover.md): protected/shared cutover evidence and
  readiness gates.
- [`secrets-usage.md`](secrets-usage.md): Vault, Infisical, fixture, and bootstrap secret flows.
- [`nixos-shared-host-setup.md`](nixos-shared-host-setup.md): shared-host setup for the deployment
  control plane.

## Operator Runbooks

- [`control-plane-runtime-configuration.md`](control-plane-runtime-configuration.md): production
  service and worker runtime config, mounted credentials, and fail-closed validation.
- [`control-plane-managed-dependencies.md`](control-plane-managed-dependencies.md): managed
  Postgres and S3-compatible artifact-store conformance.
- [`control-plane-runtime-configuration.md`](control-plane-runtime-configuration.md): runtime input
  evidence for generated cloud-control profiles, staged control-plane credentials, and live staging
  evidence.
- [`control-plane-aws-ec2-host-profile.md`](control-plane-aws-ec2-host-profile.md): generated AWS
  EC2 profile evidence and runtime artifact boundary.
- [`deployment-control-plane-observability.md`](deployment-control-plane-observability.md):
  control-plane metrics and alerting reference.
- [`infisical-bootstrap.md`](infisical-bootstrap.md) and
  [`vault-production-bootstrap.md`](vault-production-bootstrap.md): backend-specific bootstrap
  runbooks.
- [`nixos-shared-host-usage.md`](nixos-shared-host-usage.md): protected/shared operation on a
  reviewed NixOS host.

## Reference

- [`deployments-contract.md`](deployments-contract.md): deployment metadata and behavior contract.
- [`deployments-schema.md`](deployments-schema.md): deployment schema reference.
- [`deployment-provider-capabilities.md`](deployment-provider-capabilities.md): provider capability
  declarations and validation.
- [`deployment-secrets-api.md`](deployment-secrets-api.md): secret API reference.
- [`adrs/README.md`](adrs/README.md): accepted architecture decision records.
- [`handbook/README.md`](handbook/README.md): contributor handbook and build-tooling references.

## Build System

Build-system documentation lives primarily in [`../build-tools/docs/README.md`](../build-tools/docs/README.md).
Contributor workflows and repo conventions live in [`handbook/README.md`](handbook/README.md).

## Plans And Gap Trackers

These files are implementation plans or completed gap ledgers. They are useful for archaeology and
follow-up planning, but they are not the first source of truth for current commands:

- [`deployment-plan.md`](deployment-plan.md)
- [`control-plane-plan.md`](control-plane-plan.md)
- [`cloud-control-plan.md`](cloud-control-plan.md)
- [`control-plane-gaps.md`](control-plane-gaps.md)
- [`external-deployments-plan.md`](external-deployments-plan.md)
- [`infisical-plan.md`](infisical-plan.md)
- [`tasks/README.md`](tasks/README.md)

## Historical Records

- [`build-history/`](build-history/): prior build-system notes and migration records.
- [`design-history/`](design-history/): earlier product and deployment designs.
- Root-level migration docs such as [`repo-rename.md`](repo-rename.md) and
  [`runtime-prefix-migration.md`](runtime-prefix-migration.md) are historical unless linked from an
  active runbook.
