# 7. Auth Provisioning IaC

**Tier:** Core Providers + Auth
**Priority:** 7 of 44
**Depends on:** #1 Infisical Secrets Provider, #6 Supabase/WorkOS Auth Provider
**Estimated effort:** M
**Date:** 2026-05-25
**Summary:** Declaratively manage all identity infrastructure — Infisical projects/identities, WorkOS/Supabase tenants, and CI submitter identities — using OpenTofu so auth state is reproducible and auditable.

## What

Extend the repo's OpenTofu-based identity provisioning beyond the current Pleomino deployment family
to cover the full set of identity principals that viberoots needs to manage declaratively:

- **WorkOS or Supabase Auth tenant configuration** — organization, application, OIDC issuer,
  redirect URIs, and role/group claim mapping as reviewed code, not ad hoc dashboard state.
- **Infisical project and environment provisioning for new deployment families** — following the
  pattern already established in `projects/deployments/pleomino/infisical/opentofu/main.tf`:
  one `infisical_project`, per-stage `infisical_project_environment`, per-stage
  `infisical_identity` with Universal Auth, and `infisical_project_identity` membership with
  a reviewed role.
- **Control-plane machine identities** — the service and worker identities that authenticate to
  Infisical at runtime using file-backed Universal Auth credentials. These are currently
  materialized by the bootstrap flow but should become declared OpenTofu resources so their
  lifecycle is tracked in state, not only in operator-run bootstrap output.
- **CI submitter identities** — machine identities for CI jobs that need access to deployment
  secrets or that submit admission evidence to the control plane. These are currently undeclared;
  they should be declared with explicit `access_token_ttl`, `access_token_num_uses_limit`, and
  project membership roles matching the principle of least privilege.
- **Bootstrap identity** — the `viberoots-iac-bootstrap` identity that the
  `infisical-iac-bootstrap.ts` flow creates and reconciles. Its OpenTofu representation should be
  the source of truth for its org-level role, TTL, and metadata, rather than imperative API calls
  in the bootstrap script.

The output of each OpenTofu stack must continue to emit `deployment_runtime_metadata` in the same
shape consumed by `infisical-iac-bootstrap-tofu.ts` so the bootstrap handoff, reviewed-metadata
patch, and credential sink materialization remain unbroken.

If Supabase Auth or WorkOS is selected as the auth provider in task #6, a corresponding OpenTofu
stack (or an extension of the Infisical stack) must declare the OIDC application, redirect URIs,
client id, and any group or role assignments. That state should not live in the provider dashboard
alone.

No new IaC framework is introduced. OpenTofu is already the tool for external-infrastructure
provisioning in this repo (ADR-00007 permits it for provider-native configuration that cannot be
expressed in NixOS modules). The Infisical OpenTofu provider is already pinned in the Pleomino
stack. A WorkOS or Supabase Terraform provider would follow the same pattern.

## Why Now

The current bootstrap flow imperatively creates and reconciles Infisical identities in TypeScript
(`infisical-iac-bootstrap-identity.ts`, `infisical-iac-bootstrap-tofu.ts`). The OpenTofu state
file tracks the resources created for Pleomino, but only for that one family. As new deployment
families are onboarded and as a Supabase or WorkOS tenant is activated, ad hoc provisioning
accumulates. Provisioning that is not declared in reviewed OpenTofu:

- cannot be audited through plan/apply output
- cannot be diffed against current remote state
- cannot be reproduced or restored without running bootstrap scripts against live cloud state
- is invisible to the `sprinkleref --check` validation gate until it fails at runtime

Task #6 (auth provider selection) produces a live Supabase or WorkOS tenant. That tenant has
organization, application, OIDC, and role objects that need to be stable and reviewable. If those
objects are created manually, they will drift. Making them OpenTofu resources immediately after
selection means the auth provider configuration is reproducible from day one of the cloud control
plane migration (see `cloud-control-design.md` Phase 4).

Bob setup (#23) and making viberoots public (#43) both require that the identity provisioning story
is documented, auditable, and executable from a clean state. A prospective contributor or
break-glass operator needs to run one reviewed command, not reconstruct Infisical project IDs from
a spreadsheet.

## Risks

- **Auth provider not yet decided** — the WorkOS and Supabase provider Terraform plugins have
  different resource models. If this task begins before #6 is resolved, the auth tenant OpenTofu
  stack must be stubbed or left as a placeholder, which adds a later merge step.
- **Bootstrap identity circular dependency** — the bootstrap identity in Infisical is what
  authorizes OpenTofu to run. If its own lifecycle moves into the OpenTofu state it controls, a
  freshly deleted bootstrap identity breaks the plan/apply path. The imperative `ensureUniversalAuth`
  call in `infisical-iac-bootstrap-identity.ts` is the circuit-breaker for this; it must remain
  operative even if the resource is also declared in `.tf`.
- **OpenTofu state hygiene** — the existing Pleomino stack uses local `.terraform/` state, ignored
  by `.gitignore`. Remote state (e.g., Terraform Cloud, S3, Supabase Storage) has not been
  configured. Adding more stacks without a remote state solution increases the risk of state
  divergence between operators.
- **Credential file name drift** — `control_plane_credential_file_names` in the Pleomino stack is
  a reviewed constant that must match what the NixOS container module mounts. Adding new stacks
  introduces new file names; drift between the OpenTofu output and the NixOS module is a silent
  runtime failure.

## Trade-offs

- Declaring the bootstrap identity as an OpenTofu resource is the cleanest long-term model but
  requires careful import of the existing live resource and a break-glass procedure for the case
  where state is lost. The alternative — leaving the bootstrap identity imperative and declaring
  only downstream identities — is safer but leaves the root of the identity tree outside the IaC
  graph.
- The Pleomino stack currently uses local state. Migrating it to remote state is a prerequisite for
  multi-operator workflows and for Bob setup. Doing that in this task (rather than deferring it)
  keeps the scope honest but adds effort.
- WorkOS and Supabase each have a Terraform provider maintained by the provider vendor. The
  Infisical provider is already pinned and tested in this repo. A new provider is an untested
  dependency; its behavior, import semantics, and plan stability need validation before it is used
  for production resources.

## Considerations

- The existing OpenTofu pattern at `projects/deployments/pleomino/infisical/opentofu/main.tf` is
  the template. New stacks should live in a parallel path: either
  `projects/deployments/<family>/infisical/opentofu/` for deployment-family stacks, or
  `projects/infra/auth/opentofu/` for the cross-cutting auth tenant stack.
- The `deployment_runtime_metadata` output shape is consumed by `infisical-iac-bootstrap-tofu.ts`
  (`TofuDeploymentRuntimeMetadata`). Any new stack that provisions deployment credentials must
  emit the same shape. Do not invent a new handoff format.
- The `sprinkleref --check` gate (`sprinkleref-check.ts`) validates that all declared
  `secret://deployments/...` refs can be resolved. New identities and new secret paths introduced
  by this task must be reflected in resolver config before the check passes.
- OpenTofu adoption (`infisical-iac-bootstrap-tofu-adoption.ts`) handles the case where a live
  project already exists and must be imported rather than created. Any new stack that might be
  applied against an already-partially-provisioned environment needs the same adoption path.
- If the Supabase or WorkOS OpenTofu provider requires a client secret or API key to run, that
  credential is a `bootstrap`-category secret. It must resolve via macOS Keychain or a restrictive
  local file, not via Infisical. The two-category constraint from ADR-00003 is non-negotiable.
- Reviewed metadata for each new stack (project IDs, identity IDs, environment slugs) follows the
  same two-phase handoff model as Pleomino: first-bootstrap placeholders in
  `infisical-iac-bootstrap-reviewed-metadata.ts`, then a metadata patch after the first apply.
  Do not hardcode live IDs in the source before they exist.
- Once remote state is configured, the `.terraform/` directory, `terraform.tfstate*`, and
  `.terraform.lock.hcl` remain gitignored; only the `.tf` source files are checked in.
