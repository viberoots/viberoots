# viberoots Documentation

This index points to current operator manuals, references, ADRs, and contributor documentation.
Prefer these documents for day-to-day setup and operations. Historical plans, migration notes,
completed task backlogs, and old design records live under [`history/`](history/README.md).

The repository-local deployment configuration model is centered on checked-in
`projects/config/shared.json` plus gitignored `projects/config/local.json`; detailed reference
documents describe that model and remain the source of truth for command syntax.

## Documentation Placement

Use ownership to choose where new documentation lives:

- Put repo-wide contributor, deployment, control-plane, secrets, ADR, and operator documentation in
  [`docs/`](README.md).
- Put build-system-owned references in [`../build-tools/docs/`](../build-tools/docs/README.md):
  Buck2/Nix architecture, language macros, scaffolding, linking, wasm, remote builds, and generated
  build glue.
- Put app, library, or package-specific documentation beside the owning package under
  [`../projects/`](../projects/). Use `README.md` or a package-local `docs/` directory.
- Put product-level planning that spans several packages in [`../projects/docs/`](../projects/docs/).
- Put inactive plans, migrations, investigations, old designs, and completed task tracks under
  [`history/`](history/README.md).

Do not add project-specific documentation to top-level `docs/` unless it describes a repo-wide
contract or operator workflow.

## Linking Conventions

Write Markdown links so they work in GitHub and native Markdown viewers:

- Prefer relative links from the current file, including the `.md` filename or `README.md` for
  directory indexes.
- Use normal fragment links for headings in the same file, such as
  `[Start Here](#start-here)`.
- Avoid absolute filesystem paths, `file://` links, editor-specific links, and generated-output
  paths.
- When a doc links to code, link to the checked-in source file rather than generated artifacts.
- Keep link text descriptive enough that the destination is clear without reading the URL.

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
- [`../projects/docs/`](../projects/docs/): product-specific planning artifacts for sample projects.

## Build System

Build-system documentation lives primarily in [`../build-tools/docs/README.md`](../build-tools/docs/README.md).
Contributor workflows and repo conventions live in [`handbook/README.md`](handbook/README.md).

## History Archive

Use [`history/README.md`](history/README.md) for implementation plans, design archaeology,
migration notes, completed task tracks, old build-system logs, investigation notes, and validation
ledgers. The history archive is retained for traceability; current commands and supported behavior
are documented by the manuals and references above.
