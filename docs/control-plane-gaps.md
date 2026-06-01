# AWS Control Plane Gaps Plan

This plan closes the gap between the operator flow described in
[AWS Control Plane Setup Guide](/Users/kiltyj/Code/viberoots/docs/control-plane-guide.md) and the
current deployment control-plane implementation.

Reviewed context:

- The control plane remains the deployment authority. AWS, Supabase, S3, PrivateLink, DNS, TLS, and
  provider CLIs are runtime dependencies, provider-capability targets, or evidence sources.
- `deployment-control-plane setup --host-mode aws-ec2` already emits a runtime bundle with
  `config.yaml`, `credential-manifest.json`, `commands.json`, image publication evidence, managed
  dependency profiles, provider-capability declarations, and AWS profile fragments.
- The generated AWS profile is not yet a complete infrastructure-as-code realization. VPC, subnet,
  route, security-group, endpoint, EC2, load-balancer, certificate, DNS, RAM, and VPC Lattice state
  are still largely external evidence rather than repo-owned provisioning.
- Provider-capability declarations and hook dispatch exist, but the cloud adapters currently produce
  shape-valid evidence rather than live AWS, Supabase, S3, ingress, or PrivateLink proof.
- Managed dependency validation checks Postgres features and S3-compatible object behavior, but it
  does not yet prove that the check ran from the selected AWS host path or through the selected
  public TLS versus Supabase PrivateLink database path.
- Supabase project selection, database backup/restore posture, migration readiness, and public
  versus PrivateLink connection policy are still mostly operator decisions plus evidence, not a
  generated provisioning or verification path.
- Container registry selection, repository immutability policy, pull permissions, and image
  publication are still treated as prerequisites even though the AWS path can provision and evidence
  those pieces for ECR or import them for another reviewed registry.
- Runtime config still contains operator-edited placeholders for auth-provider and Infisical routing
  metadata. Those values should come from reviewed inputs, generated IaC outputs, or provider
  evidence wherever possible.
- Production artifact-store access still requires file-backed S3-compatible access keys. AWS EC2
  instance-profile access is a desired least-privilege improvement for the AWS S3 path, not a
  supported runtime mode yet.
- Credential files are required, but the AWS host profile does not yet provide an end-to-end,
  generated staging and rotation workflow that turns reviewed secret-backend material into mounted
  runtime files without ad hoc operator copying.
- Production host logs, readiness history, worker heartbeat evidence, and alarm/notification
  surfaces are not yet generated as part of the AWS host profile, leaving operators to assemble
  operational visibility outside the reviewed profile.
- Repo-owned IaC modules also need managed state, locking, drift detection, cost/quotas, and tagging
  conventions; otherwise the operator still has to provide the safety rails around the generated
  infrastructure.
- Reviewed-source credentials and Infisical machine identities are runtime prerequisites today, but
  their provisioning, rotation, and evidence are not yet generated with the AWS runtime profile.
- Generated operator commands must be copy-pasteable and unambiguous. Any remaining manual step must
  have a typed evidence shape and a command that tells the operator exactly what is missing.
- No database URL, AWS access key, Infisical client secret, bearer token, private key, registry
  credential, or raw provider secret may be written into generated profiles, IaC outputs, evidence
  JSON, logs, docs examples, or diagnostics.

Non-goals:

- no docs-only PRs after this planning artifact
- no tests-only PRs
- no replacement of the deployment control plane with Terraform/OpenTofu, AWS, Supabase, CI, or a
  cloud provider scheduler
- no use of Supabase Edge Functions, Cloudflare Workers, Vercel Functions, GitHub Actions, or
  Fargate as protected/shared deployment mutation hosts in this sequence
- no weakening of file-backed runtime credential boundaries for production
- no acceptance of dashboard-only notes, raw IaC state, literal `true`, or hand-authored JSON as
  protected/shared readiness evidence
- no public Supabase database hostname accepted as PrivateLink evidence
- no ambient AWS, Supabase, registry, or Infisical credentials in protected/shared runtime paths
- no hand-edited production runtime config when the value can be generated from reviewed setup
  inputs, IaC outputs, or provider evidence
- no unreviewed mutable image registry policy for production control-plane images
- no unmanaged IaC state or unlocked production infrastructure apply path for repo-owned AWS
  modules
- no expansion of Buck2 remote execution or Nix remote-builder scheduling into deployment worker
  authority

Verify-scope organization:

- The PR sequence is intentionally organized so ordinary implementation work stays under the
  reviewed deployment-owned paths from
  [Deployment Verify Scope](/Users/kiltyj/Code/viberoots/docs/deployment-verify-scope.md):
  - `build-tools/deployments/**`
  - `build-tools/tools/deployments/**`
  - `build-tools/tools/tests/deployments/**`
  - exact reviewed support paths listed in that document
- IaC templates, provider-capability adapters, fake provider clients, evidence schemas, setup
  commands, cutover commands, and runtime validation helpers should live in deployment-owned modules
  unless implementation proves a shared build-system path is the clean design.
- If AWS/OpenTofu fixtures or deployment packages under `projects/deployments/**` are added, that PR
  should classify as `deployment-and-project-impact`.
- If implementation discovers that shared Buck/Nix/verify infrastructure must change, update this
  plan first and treat that PR as `mixed-build-system`; do not hide shared build-system work inside a
  nominally deployment-only PR.

Each PR below must update this plan if implementation changes invalidate the remaining sequence,
scope, or assumptions.

Cross-PR sequencing and evidence rules:

- Earlier PRs may accept explicit expectation files or imported evidence when a later PR will
  eventually generate that input. The later PR must remove the operator guesswork by producing the
  same schema from IaC outputs, provider evidence, or reviewed runtime inputs.
- Imported evidence is never a weaker path. It must satisfy the same schema, freshness, provenance,
  ownership, redaction, drift, and selected-capability checks as repo-generated evidence. Imported
  evidence may describe externally owned infrastructure, but it may not be a dashboard screenshot,
  hand-authored assertion, raw IaC state dump, or unchecked provider transcript.
- Generated commands should converge into an ordered operator runbook with explicit phases,
  prerequisites, outputs, residual actions, and evidence file paths. By the end of the sequence, a
  doctor/workflow command should be able to tell an operator which phase is ready, which phase is
  blocked, and the exact generated command or provider action needed to unblock it.
- Repo automation should follow the build-system guardrail that substantive automation lives in
  TypeScript/zx deployment tooling. Generated host unit files, IaC templates, and short host
  bootstrap snippets may be outputs, but the decision logic that renders and validates them should
  remain in reviewed deployment-owned TypeScript modules with focused file boundaries.

Guide-step coverage map:

- Supabase project, backup, and database lifecycle: PR-10.
- Supabase PrivateLink and AWS RAM/VPC Lattice: PR-8, with runtime-path proof in PR-4.
- AWS network, S3 artifact store, IAM, state, drift, cost, and tags: PR-5.
- EC2 host, process units, recovery, logs, alarms, and host evidence: PR-6.
- Registry, image publication, registry inspection, and runtime pull proof: PR-3.
- Setup command generation, credential preflight, and runbook/doctor surface: PR-1.
- Runtime config, auth provider, Infisical, reviewed-source credentials, staging, and rotation:
  PR-11, with AWS instance-profile artifact credentials in PR-9.
- Ingress, TLS, DNS, edge front door, and auth callback routing: PR-7.
- Managed dependency conformance from the selected runtime path: PR-4.
- Typed evidence, cutover, rollback, restore, break-glass, standby, and end-to-end staging cutover:
  PR-2 and PR-12.

## PR-1: Runnable setup commands and credential preflight

### 1. Intent

Make the AWS setup bundle immediately usable by an operator after credentials are staged, without
guessing service URLs, current working directories, authentication headers, or manifest checks.

### 2. Scope of changes

- Update `commands.json` rendering so generated HTTP checks use the configured `publicUrl`, not
  `<control-plane-service-url>`.
- Add bearer-token handling to authenticated read checks, including worker-heartbeat and any other
  protected read API command generated for operators.
- Add profile-root metadata so every generated command is runnable from either the repo root or the
  generated bundle directory.
- Fix managed dependency command paths so the generated command points at the generated
  `managed-dependencies.profile.yaml` regardless of current working directory.
- Remove incomplete generated dry-run commands or render them with the full production-equivalent
  flag set needed to reproduce the profile.
- Render `commands.json` as an ordered runbook structure with phases, prerequisites, generated
  output paths, evidence inputs, and residual manual actions instead of an unordered bag of snippets.
- Add a setup doctor command that reads the generated bundle, validates the runbook structure, and
  reports which setup phases are ready, blocked, or complete without needing cloud credentials for
  purely local checks.
- Add a credential preflight command under `deployment-control-plane` or a deployment-owned
  companion command that validates:
  - exact filenames from `credential-manifest.json`
  - selected reviewed-source mode
  - per-deployment Infisical client id and client secret pairs
  - existence, readability, and non-empty content
  - URL-shaped credential files where shape validation is safe
  - no env-var-only or ambient credential source
- Add the credential preflight to `commands.json`, the bundle README, and the guide flow before
  service/worker startup.
- Keep diagnostics redacted and avoid printing credential file contents.

### 3. External prerequisites

- None for fixture tests.
- Operators still need real credential files before running the generated command against a live
  host.

### 4. Tests to be added

- Add setup snapshot or structural tests proving `commands.json` uses `publicUrl` and stable
  profile-root-relative paths.
- Add runbook schema tests proving generated phases are ordered, every command has declared inputs
  and outputs, and residual actions are explicit.
- Add setup doctor tests proving local-only checks classify ready, blocked, and complete phases
  without requiring live cloud credentials.
- Add tests proving authenticated read commands include token-file based authorization without
  embedding token values.
- Add credential preflight tests for missing files, empty files, wrong reviewed-source mode, stale
  deployment ids, env-style sources, unreadable files, and redacted diagnostics.
- Add a CLI regression test for the guide's AWS setup command shape.
- Add docs-link or parity tests proving the guide points at the generated command order.

### 5. Docs to be added or updated

- Update `docs/control-plane-guide.md` Step 5 through Step 10 with the generated command order and
  current-working-directory rules.
- Update runtime credential docs with the new preflight command.
- Update setup docs to say generated commands are authoritative over hand-assembled examples.

### 5.5. Expected regression scope

- `deployment-only`
- Keep implementation under `build-tools/tools/deployments/**` and
  `build-tools/tools/tests/deployments/**`.

### 6. Acceptance criteria

- An operator can run the generated validation commands from repo root or the bundle directory.
- An operator can run the setup doctor and get an unambiguous ready/blocked/complete status for the
  generated runbook.
- Credential manifest conformance can be proven before starting service and worker processes.
- Generated command output never contains secret values.
- The guide no longer requires operators to infer missing paths, URLs, or auth headers.

### 7. Risks

- Generated commands could accidentally expose bearer tokens through shell tracing or process lists.
- Path handling could become platform-sensitive if commands mix absolute and bundle-relative paths.

### 8. Mitigations

- Read token files inside shell snippets without echoing values and prefer headers that do not place
  raw tokens in generated evidence.
- Test commands from both repo-root and bundle-root working directories.

### 9. Consequences of not implementing this PR

The guide can generate a profile that still requires undocumented operator judgment before basic
validation works.

### 10. Downsides for implementing this PR

The setup bundle becomes a maintained operator interface, so command rendering needs compatibility
tests.

## PR-2: Typed AWS topology and evidence schemas

### 1. Intent

Replace boolean and truthy AWS evidence acceptance with typed, redacted evidence contracts that the
setup, provider-capability, managed dependency, and cutover paths can share.

### 2. Scope of changes

- Add deployment-owned TypeScript schemas for AWS topology evidence:
  - account id and region
  - VPC id and DNS support
  - private subnet ids, Availability Zones, route tables, and NAT or controlled egress posture
  - service, worker, load-balancer, S3 endpoint, and PrivateLink security groups
  - S3 gateway or interface VPC endpoint id, route-table associations, endpoint policy digest, and
    selected bucket/prefix
  - EC2 instance id or Auto Scaling group identity, launch template id/version, AMI identity,
    instance profile, and service/worker process evidence
  - ALB/NLB listener, target group, target health, certificate, TLS policy, DNS record, and callback
    host evidence
  - Supabase database connectivity mode: `public` or `privatelink`
  - Supabase PrivateLink resource configuration, RAM share, endpoint or service-network association,
    endpoint DNS/IPs, and `psql` proof when private mode is selected
- Update setup validation and cutover validation to reject literal `true`, empty objects,
  dashboard-only notes, raw IaC state, stale timestamps, and unsupported evidence modes.
- Add redaction helpers for evidence fields that may contain hostnames, ARNs, command output, or
  provider diagnostics while still rejecting obvious secret material.
- Normalize freshness windows and checked-at timestamps across AWS topology, provider-capability,
  managed dependency, and cutover evidence.
- Keep support-mediated steps representable only as structured prerequisite evidence tied to a
  selected capability id.

### 3. External prerequisites

- None for schema and fixture tests.
- Live AWS and Supabase accounts are needed only for later live-gated evidence collectors.

### 4. Tests to be added

- Add positive fixtures for minimal valid public-TLS AWS topology evidence and minimal valid
  PrivateLink AWS topology evidence.
- Add negative tests rejecting booleans, missing VPC/subnet/security-group links, wrong region,
  stale timestamps, unsupported database mode, dashboard-only notes, raw-IaC-only state, and
  secret-looking evidence content.
- Add tests proving existing cutover validation consumes the shared schemas.
- Add redaction tests for AWS ARNs, endpoint hostnames, and provider command output.

### 5. Docs to be added or updated

- Update `docs/control-plane-guide.md` Step 10 and Step 11 with the typed evidence categories.
- Update `docs/cloud-control-cutover.md` with minimal public and PrivateLink evidence examples.
- Update setup docs to describe the difference between prerequisite evidence and protected/shared
  readiness evidence.

### 5.5. Expected regression scope

- `deployment-only`
- Keep schema and validation code in deployment-owned tooling paths.

### 6. Acceptance criteria

- AWS cutover validation cannot pass with booleans, empty objects, dashboard notes, or raw IaC state.
- Public TLS and PrivateLink database modes have distinct machine-checkable evidence requirements.
- Every AWS evidence object carries a freshness timestamp and selected topology identity.

### 7. Risks

- Evidence schemas can become too provider-specific and make fixture testing brittle.
- Overly strict schemas can block legitimate alternate AWS topologies.

### 8. Mitigations

- Model required invariants, not every AWS API field.
- Include explicit variants for ALB versus NLB, S3 gateway versus interface endpoint, and
  PrivateLink endpoint versus service-network association.

### 9. Consequences of not implementing this PR

Later IaC and live evidence work would continue to feed a weak contract that cannot distinguish real
runtime proof from placeholders.

### 10. Downsides for implementing this PR

The evidence model becomes a compatibility surface that future provider adapters must maintain.

## PR-3: Registry provisioning and image publication evidence

### 1. Intent

Make the control-plane image registry, pull permissions, immutability policy, and publication
evidence generated and verified by tooling instead of manually assembled and transcribed into setup
flags.

### 2. Scope of changes

- Add a registry profile that supports:
  - AWS ECR repository provisioning for the recommended AWS topology
  - imported external registry evidence for non-ECR registries
  - immutable tag policy or equivalent mutation-prevention proof
  - repository lifecycle policy
  - image scanning or an explicit reviewed exception
  - pull permissions for the EC2 instance profile or reviewed registry credential source
  - push/publish permissions kept separate from runtime pull permissions
  - region/account/repository identity evidence
- Add deployment-owned IaC or provider-capability hook support for ECR repository creation, policy
  preview, apply, evidence, smoke, and rollback/import where practical.
- Add `deployment-control-plane image-publication` or an equivalent setup subcommand that:
  - optionally runs or records the reviewed `nix build .#deployment-control-plane-image` and
    `.#deployment-control-plane-image-contract` commands
  - accepts the reviewed image reference, source revision, build identity, and human tag
  - rejects mutable production identities such as `latest`
  - runs the reviewed registry inspection path, using `skopeo` or the existing registry-inspection
    helper pattern
  - verifies the inspected digest matches the published digest and image reference digest
  - writes `image-publication.json` using the existing evidence schema
- Make `deployment-control-plane setup` accept `--image-publication-evidence <path>` for production
  profile generation.
- Preserve direct digest flags only for dry-run fixtures and tests, or clearly mark them as
  non-production escape hatches.
- Add generated commands for image inspection and evidence regeneration to the setup bundle.
- Ensure the Nix image contract, runtime image metadata, setup evidence, and cutover expected build
  identity all compare the same digest fields.
- Ensure EC2 host realization and cutover evidence prove the selected host can pull the exact image
  digest without embedding registry credentials in generated config or command lines.

### 3. External prerequisites

- Operators need read access to the selected container registry for live inspection.
- ECR provisioning requires AWS registry permissions in live-gated runs.
- Test fixtures can use a fake `skopeo` or fake registry-inspection command.

### 4. Tests to be added

- Add registry profile tests for ECR provisioning and imported external registry modes.
- Add negative tests for mutable tags, mutable repository policy, missing lifecycle policy, missing
  pull permission, missing runtime pull proof, push credentials reused for runtime pull, and
  unredacted registry auth output.
- Add fake registry tests for digest match, digest mismatch, missing inspect output, malformed
  digest, tag-only image, and `latest` rejection.
- Add image build command tests proving setup can either invoke the reviewed Nix build path or
  consume generated build evidence from that path.
- Add setup tests proving production AWS profiles require generated image publication evidence.
- Add tests proving generated `image-publication.json` contains no registry credentials or auth
  headers.
- Add cutover tests proving expected image build identity and inspected digest must match runtime
  evidence.

### 5. Docs to be added or updated

- Update `docs/control-plane-guide.md` Step 4 and Step 5 to use the image publication evidence
  command and registry profile rather than manual digest flags.
- Update OCI image docs with the reviewed registry-inspection workflow.
- Document the ECR default path and imported-registry evidence path.

### 5.5. Expected regression scope

- `deployment-only`
- Keep command wiring and tests in deployment-owned tooling paths unless registry helper reuse
  requires a planned shared-path update.

### 6. Acceptance criteria

- Operators no longer need to manually copy publication and inspected digests into setup.
- Image build, contract, publication, inspection, and runtime pull evidence are part of one generated
  workflow or one imported evidence file with the same schema.
- The recommended AWS topology can provision or import a registry with immutable production image
  policy and runtime pull evidence.
- Setup rejects production AWS profiles without generated registry inspection evidence.
- Image evidence, runtime metadata, and cutover validation compare the same immutable digest.

### 7. Risks

- Registry inspection behavior can vary across registries and authentication methods.
- Generated evidence could accidentally persist registry authentication diagnostics.
- Repository policy automation can accidentally grant broad push/pull permissions.

### 8. Mitigations

- Use fake registry fixtures for stable behavior and live-gated tests for real registries.
- Redact registry command stderr/stdout before writing evidence or diagnostics.
- Separate publish and runtime pull permissions in the registry profile and test least-privilege
  policy shape.

### 9. Consequences of not implementing this PR

The guide would continue relying on an externally prepared registry and manually copied digest
values for one of the highest-risk production identity checks.

### 10. Downsides for implementing this PR

The setup workflow gains registry profile management plus a dependency on registry inspection
tooling.

## PR-4: Runtime-path managed dependency conformance

### 1. Intent

Make managed dependency validation prove not only that Postgres and S3-compatible operations work,
but that they work from the selected AWS runtime path and selected database connectivity mode.

### 2. Scope of changes

- Extend `managed-dependencies.profile.yaml` with:
  - expected host profile
  - expected AWS region
  - expected database connectivity mode: `public` or `privatelink`
  - optional expected Supabase project ref and PrivateLink endpoint/resource identity
  - optional expected S3 VPC endpoint id or endpoint policy digest for AWS S3
- Extend Postgres conformance evidence to record non-secret runtime-path facts:
  - source host identity, when available
  - resolved database hostname
  - TLS enabled status and peer host identity where safe
  - database connectivity mode
  - Supabase project/region labels supplied as non-secret expectations
  - PrivateLink endpoint/resource evidence when private mode is selected
- Extend artifact-store conformance evidence to record:
  - selected provider, bucket, region, endpoint host, and key prefix
  - source host identity, when available
  - AWS S3 VPC endpoint evidence when AWS S3 is selected
  - digest, metadata, content-type, PUT, GET, and HEAD checks
- Reject public Supabase hostnames when `privatelink` is selected.
- Reject laptop/CI evidence for PrivateLink mode unless it is explicitly marked as non-cutover
  diagnostic evidence.
- Add generated managed dependency commands that pass the expected runtime-path fields.
- Support explicit expectation files at this stage, then consume the generated Supabase lifecycle
  profile from PR-10 when that profile exists. The evidence schema must stay stable across both
  sources so PR-10 replaces manual expectation assembly rather than changing the validator contract.

### 3. External prerequisites

- Live PrivateLink validation requires running from the AWS VPC path.
- Fixture tests can use fake DNS, fake Postgres, fake endpoint metadata, and fake S3-compatible
  servers.

### 4. Tests to be added

- Add profile parsing and validation tests for public and PrivateLink modes.
- Add fake DNS/endpoint fixtures proving public evidence cannot satisfy PrivateLink mode.
- Add tests proving missing source host, wrong region, wrong project ref, wrong endpoint id, and
  missing TLS status fail closed when required.
- Add S3 evidence tests for AWS VPC endpoint required, alternate backend evidence required, and
  secret redaction.
- Add regression tests proving existing Postgres feature and artifact-store conformance still run.

### 5. Docs to be added or updated

- Update `docs/control-plane-guide.md` Step 9 with required runtime-path evidence fields.
- Update `docs/control-plane-managed-dependencies.md` with public versus PrivateLink conformance
  expectations.
- Update troubleshooting notes for failures caused by running validation from the wrong network
  path.
- Document that Supabase project and PrivateLink expectations may be explicit operator-reviewed
  inputs until the PR-10 Supabase profile generates them.

### 5.5. Expected regression scope

- `deployment-only`
- Keep conformance changes in deployment-owned tooling and tests.

### 6. Acceptance criteria

- PrivateLink mode fails unless evidence ties the check to the AWS runtime path and private
  database hostname.
- Explicit operator-reviewed expectation files and PR-10 generated Supabase profiles satisfy the
  same validation schema.
- AWS S3 mode records S3 VPC endpoint evidence in addition to object operation conformance.
- Managed dependency evidence remains non-secret and redacted.

### 7. Risks

- Runtime-path proof can depend on cloud metadata services that are unavailable in fixture tests.
- DNS and TLS evidence can be hard to normalize across public and PrivateLink modes.

### 8. Mitigations

- Separate fixture-supplied host identity from live metadata collection and validate both through the
  same evidence schema.
- Treat exact provider metadata as optional unless the selected mode requires it.

### 9. Consequences of not implementing this PR

A laptop or CI runner could produce evidence that looks similar to a successful AWS PrivateLink
runtime validation.

### 10. Downsides for implementing this PR

Managed dependency profiles and evidence files become more detailed and more tied to the selected
host topology.

## PR-5: AWS network and S3 IaC capability adapters

### 1. Intent

Convert the default AWS network and artifact-store path from manual cloud-foundation work into
repo-owned infrastructure-as-code and live provider-capability evidence where practical.

### 2. Scope of changes

- Add deployment-owned OpenTofu or equivalent IaC modules for:
  - IaC state backend, state encryption, state locking, workspace naming, and drift-detection
    conventions for all repo-owned AWS modules
  - VPC or selected existing VPC import
  - private subnets in at least two Availability Zones
  - route tables, NAT or egress-only design, and controlled outbound path
  - endpoint or egress policy for required public HTTPS dependencies such as Infisical, registry,
    provider APIs, Supabase Auth/API where selected, and reviewed-source hosts
  - service/worker, load-balancer, S3 endpoint, and PrivateLink security groups
  - least-privilege IAM roles and policies for EC2 host operation, S3 artifact access, evidence
    collection, and provider-capability hooks
  - AWS S3 bucket, bucket policy, optional KMS key, lifecycle policy, versioning, object-lock or
    equivalent retention posture where supported, public-access block, replication/import evidence
    where selected, and immutable artifact prefix policy
  - S3 gateway or interface endpoint and route/security policy
- Add artifact-store provisioning/import profiles for reviewed alternate backends:
  - Supabase Storage S3 import/provisioning evidence where API support exists
  - Cloudflare R2 import/provisioning evidence where selected
  - generic S3-compatible import evidence for other reviewed stores
  - endpoint shape, signing region, path-style behavior, metadata behavior, retention posture, and
    public/private network-path expectations for every alternate
- Add a preflight/cost/quota/tagging contract that checks:
  - AWS account id, region, and partition
  - required service quotas for VPC endpoints, load balancers, EC2, EBS, ECR, KMS, CloudWatch, and
    VPC Lattice where selected
  - required budget/cost estimate evidence before live-gated apply
  - mandatory ownership, environment, data-classification, and rollback tags
  - KMS key ownership and deletion-window posture where KMS is selected
- Add reviewed provider-capability adapters for `aws-network-foundation` and
  `aws-s3-artifact-store` with preview, apply, evidence, smoke, and rollback phases.
- Produce redacted preview/apply/evidence payloads through the existing provider-capability hook
  dispatch path.
- Add drift detection and reconcile evidence before protected/shared cutover and before subsequent
  applies.
- Bind generated evidence to the typed AWS topology schemas from PR-2.
- Keep support for externally provisioned cloud-foundation state as an explicit imported-evidence
  mode only when the evidence satisfies the same schema.
- Ensure all AWS credentials used by hooks are file-backed deployment credentials, reviewed
  provider hook credentials, or explicit live-gated AWS role assumption with recorded non-secret role
  identity, not ambient laptop or CI credentials.

### 3. External prerequisites

- An AWS account and region for live-gated apply/smoke.
- Provider credentials scoped to network and S3 provisioning for live-gated runs.
- Existing cloud-foundation inputs if importing an existing VPC rather than creating one.

### 4. Tests to be added

- Add fixture preview/apply/evidence snapshots for new VPC and existing VPC import modes.
- Add negative tests for public subnets selected as private runtime subnets, mismatched VPC ids,
  missing endpoint policy, missing bucket public-access block, missing lifecycle policy, wrong
  region, over-broad IAM policy fixtures, missing instance profile trust, and unredacted provider
  output.
- Add artifact durability tests for missing versioning/retention posture, unsafe public access,
  missing replication/import evidence when selected, and alternate backend metadata incompatibility.
- Add tests for missing state lock, unencrypted state, stale drift evidence, missing mandatory tags,
  quota shortfall, missing cost estimate, and KMS deletion-window mismatch.
- Add egress policy tests proving required public dependencies are explicit and workers do not gain
  broad undocumented outbound access.
- Add hook tests proving evidence belongs to the matching capability id and cannot satisfy an
  unrelated capability.
- Add managed dependency integration fixtures proving artifact conformance consumes the generated S3
  endpoint evidence.

### 5. Docs to be added or updated

- Update `docs/control-plane-guide.md` Step 3 to prefer the repo-owned AWS network/S3 modules when
  available.
- Add operator docs for preview, apply, evidence, smoke, and rollback of the AWS network and S3
  capabilities.
- Document AWS S3 as the generated default artifact-store path and Supabase Storage S3, Cloudflare
  R2, or generic S3-compatible stores as explicit import/provisioning profiles with conformance
  gates.
- Add IaC state, lock, drift, quota, cost, and tagging docs for the repo-owned AWS modules.
- Document the reviewed imported-evidence mode for organizations that keep VPC ownership outside
  this repo.

### 5.5. Expected regression scope

- `deployment-only` for provider hook and evidence code.
- `deployment-and-project-impact` if checked-in deployment packages or OpenTofu fixtures under
  `projects/deployments/**` are added.
- Update this plan before touching shared Buck/Nix paths.

### 6. Acceptance criteria

- AWS S3 through a VPC endpoint is a concrete repo-owned path, not only a checklist item.
- Alternate artifact stores have explicit provisioning/import profiles and cannot be selected on
  conformance evidence alone.
- Artifact-store durability settings, public-access posture, retention/lifecycle, and rollback
  behavior are evidenced before protected/shared use.
- The default AWS IAM roles and policies needed for the network and artifact-store path are
  generated, previewed, and evidenced with least-privilege intent.
- Required outbound access for Infisical, registry pulls, reviewed source, Supabase public APIs, and
  provider APIs is explicit in IaC and evidence.
- Repo-owned AWS IaC has encrypted locked state, drift evidence, cost/quota checks, and mandatory
  tags before live apply or cutover.
- Provider-capability evidence for network and S3 comes from adapters that inspect or realize real
  AWS state.
- Cutover can reject network/S3 evidence that is stale, mismatched, or not tied to the selected VPC.

### 7. Risks

- IaC for foundational AWS networking can collide with organization-owned cloud-foundation
  practices.
- Rollback for network resources can be destructive if dependency ordering is wrong.
- IaC state backend mistakes can create split-brain infrastructure ownership or unrecoverable drift.

### 8. Mitigations

- Support explicit existing-VPC import mode with the same evidence requirements.
- Make rollback guidance conservative and avoid deleting resources with retained artifacts or active
  endpoints unless explicitly approved.
- Fail closed on missing state lock, stale drift evidence, and missing imported-state ownership
  metadata.

### 9. Consequences of not implementing this PR

Operators must keep hand-authoring core AWS dependencies while the repo only validates partial
evidence after the fact.

### 10. Downsides for implementing this PR

The repository takes ownership of AWS infrastructure module maintenance and provider API drift.

## PR-6: EC2 host realization and NixOS or systemd/Podman profile

### 1. Intent

Make `--host-mode aws-ec2` produce a realizable host profile for one service and at least two
workers, instead of a YAML summary and a terse systemd/Podman sketch.

### 2. Scope of changes

- Replace `systemd-podman.units.txt` with generated systemd unit files, a rendered Podman run
  script, or both.
- Add a NixOS EC2 host example or module wrapper that imports the existing control-plane container
  module with AWS-specific inputs.
- Add generated IaC/profile support for reviewed NixOS AMI build/import, AMI selection, EC2 launch
  template, optional Auto Scaling group or explicit single-instance recovery profile, instance
  profile attachment, EBS volume or state path setup, EBS encryption, security-group attachment,
  SSM Session Manager or reviewed SSH access posture, and user data that installs or activates the
  generated units.
- Ensure generated service and worker units include:
  - digest-pinned image reference
  - non-root runtime user where supported
  - read-only config and credential mounts
  - persistent state/runtime/artifact staging mounts
  - service port binding only for the service process
  - distinct worker ids
  - restart policy
  - graceful shutdown behavior
  - health/readiness command references
  - automatic replacement or explicitly reviewed manual recovery behavior after host failure
  - patch/rebuild cadence for the host image and container image
  - no token, database URL, private key, or secret value in command args or environment
- Generate operational visibility resources and evidence where the selected AWS profile supports it:
  - CloudWatch log groups or an explicitly reviewed alternate log sink
  - service and worker unit log routing
  - readiness and worker-heartbeat history capture
  - alarm or notification hooks for service down, readiness failure, missing worker heartbeat, queue
    backlog, and repeated worker crash
  - retention policy and access-control evidence for operational logs
- Emit host-profile evidence for instance id, AMI, launch template, instance profile, unit names,
  process ids, image digest, config digest, credential manifest digest, service readiness, worker
  heartbeat, graceful shutdown, and log/alarm wiring.
- Keep non-NixOS OCI host support as a substrate compatibility mode, not the preferred host when
  viberoots controls the VM.

### 3. External prerequisites

- Live EC2 apply/smoke requires an AWS account, selected subnets, security groups, instance profile,
  and image registry access from the host.
- NixOS host realization requires a reviewed NixOS AMI build/import and pin path.
- Production host access requires either SSM Session Manager evidence or a reviewed SSH break-glass
  path with no standing broad inbound SSH.

### 4. Tests to be added

- Add structural tests for generated unit files or run scripts covering mounts, commands, worker
  count, restart policy, image digest pinning, and absence of secret command args.
- Add NixOS module evaluation tests for AWS profile imports.
- Add negative tests for missing AMI, unreviewed AMI owner, missing AMI build identity, missing
  launch template, missing instance profile, missing worker unit, mutable image tag, and writable
  credential mounts.
- Add negative tests for missing recovery profile, unencrypted EBS, broad inbound SSH, missing SSM
  access evidence when selected, and missing host/container patch cadence.
- Add observability profile tests for log group retention, unit log routing, alarm target shape, and
  absence of secret values in generated log configuration.
- Add fixture smoke tests proving generated process evidence satisfies the host-profile evidence
  schema.

### 5. Docs to be added or updated

- Update `docs/control-plane-guide.md` Step 3 and Step 8 with the generated host realization path.
- Add AWS EC2 host-profile docs for NixOS and non-NixOS systemd/Podman modes.
- Document the exact boundary between host user data, generated runtime config, mounted credentials,
  and durable external state.

### 5.5. Expected regression scope

- `deployment-only` for generators and tests.
- `deployment-and-project-impact` if live-gated EC2 deployment fixtures are added under
  `projects/deployments/**`.

### 6. Acceptance criteria

- An AWS EC2 operator can start the generated service and workers without inventing host wiring.
- NixOS EC2 hosts use a reviewed AMI build/import identity rather than an unpinned marketplace image.
- Host replacement, recovery, access, EBS encryption, and patch cadence are generated or explicitly
  evidenced.
- Host-profile evidence proves the selected host is running the selected image, config, and worker
  count.
- Host-profile output gives operators reviewed logs and alarms for the basic failure modes needed
  during setup and cutover.
- Generated host artifacts do not contain secret values.

### 7. Risks

- NixOS and non-NixOS EC2 paths can drift if both are generated independently.
- Host bootstrap can accidentally become a second deployment authority if it mutates provider state
  outside control-plane hooks.
- Automated recovery can cause duplicate workers if process identity and leases are not bound to the
  durable backend correctly.

### 8. Mitigations

- Use one shared process spec and mount contract for NixOS and systemd/Podman renderers.
- Keep provider mutations inside provider-capability hooks and make host bootstrap consume generated
  artifacts only.
- Bind replacement workers to the same database lease, fencing, and worker-heartbeat semantics tested
  by the control plane.

### 9. Consequences of not implementing this PR

The guide tells operators to use a generated AWS profile that is not sufficient to start the
runtime safely.

### 10. Downsides for implementing this PR

The project must maintain host-profile rendering across NixOS and non-NixOS substrates.

## PR-7: ALB, NLB, ACM, DNS, and callback ingress capability

### 1. Intent

Make ingress evidence auditable and bound to the selected service host, TLS identity, public URL,
and auth callback host.

### 2. Scope of changes

- Add IaC modules or provider hooks for the reviewed ingress path:
  - ALB or NLB
  - listener
  - target group
  - target registration
  - health checks
  - ACM certificate
  - TLS policy
  - allowed client CIDRs, security-group sources, AWS WAF, Cloudflare WAF/rate limiting, or an
    explicit reviewed access-control exception
  - Route53 DNS records or reviewed external DNS evidence
  - auth callback hostname and route
- Add provider-capability evidence for `aws-network-foundation` ingress fields or a dedicated
  ingress slice if implementation proves that cleaner.
- Validate that:
  - listener, target group, service security group, and selected subnets belong to the selected VPC
  - target health is fresh and points at the selected service process
  - certificate names cover `publicUrl` and `authCallbackHost`
  - DNS resolves to the selected load balancer or reviewed edge front door
  - TLS policy meets the reviewed minimum
  - public ingress is limited to approved clients or reviewed edge networks
  - WAF/rate-limit posture is either generated or explicitly waived with evidence
  - callback host/path matches runtime auth-provider configuration
- Support Cloudflare front door or another reviewed edge only as explicit provider-capability
  evidence layered in front of the AWS ingress path, including DNS proxy, TLS mode, WAF/rate-limit,
  bypass, and callback-route proof.
- Add generated evidence collection commands for ingress health, DNS, TLS, and callback routing.

### 3. External prerequisites

- Live-gated tests need AWS ingress permissions and DNS/certificate control, or imported evidence
  from a reviewed cloud-foundation process.
- If Cloudflare fronts AWS ingress, a reviewed Cloudflare capability must be selected separately.

### 4. Tests to be added

- Add fixture tests for ALB and NLB variants.
- Add negative tests for stale target health, wrong VPC, wrong target group, certificate not covering
  the host, DNS pointing at the wrong target, wrong callback host/path, weak TLS policy, and
  dashboard-only ingress notes.
- Add negative tests for open public ingress without approval, missing WAF/rate-limit evidence when
  required, missing edge-bypass proof, and Cloudflare edge evidence attached to the wrong hostname.
- Add setup/cutover tests proving `publicUrl`, `authCallbackHost`, and ingress evidence must agree.
- Add redaction tests for provider output.

### 5. Docs to be added or updated

- Update `docs/control-plane-guide.md` Step 3, Step 6, Step 10, and troubleshooting ingress notes.
- Add ingress evidence examples to `docs/cloud-control-cutover.md`.
- Document ALB versus NLB tradeoffs only where they affect evidence and runtime behavior.

### 5.5. Expected regression scope

- `deployment-only` for evidence and hooks.
- `deployment-and-project-impact` if checked-in ingress IaC fixtures are added under
  `projects/deployments/**`.

### 6. Acceptance criteria

- Cutover proves the selected hostname reaches the selected service over reviewed TLS.
- Auth callback evidence is tied to runtime auth-provider config.
- Public ingress access control, WAF/rate-limit posture, and any edge-front-door bypass controls are
  generated or evidenced.
- Stale, cross-VPC, wrong-domain, or unhealthy-target evidence fails closed.

### 7. Risks

- DNS and certificate automation can be provider-specific and environment-specific.
- Edge-fronted topologies can obscure the AWS load-balancer identity.

### 8. Mitigations

- Keep AWS load-balancer evidence and optional edge evidence separate but linked.
- Allow imported DNS evidence only when it satisfies the same hostname, TLS, and freshness checks.

### 9. Consequences of not implementing this PR

Health checks can pass on an internal or wrong endpoint while public operator ingress and auth
callback routing remain ambiguous.

### 10. Downsides for implementing this PR

Ingress automation adds provider-specific state and certificate/DNS lifecycle complexity.

## PR-8: Supabase PrivateLink RAM and VPC Lattice wiring

### 1. Intent

Turn Supabase PrivateLink from a boolean setup flag into structured AWS-side realization and
evidence for RAM acceptance, VPC Lattice wiring, private DNS, security groups, and database
connectivity.

### 2. Scope of changes

- Add a Supabase PrivateLink evidence model covering:
  - Supabase project ref and region
  - AWS account id and region
  - PrivateLink regional availability confirmation
  - Supabase resource configuration name or ARN
  - AWS RAM share id/ARN and acceptance status
  - VPC Lattice resource endpoint or service-network association id
  - endpoint DNS names or private IPs
  - endpoint/service-network security group id
  - selected control-plane service/worker security group id
  - TCP 5432 rule proof from service/worker SG to endpoint SG
  - `psql` success from the selected VPC path
  - database URL hostname classification proving private hostname use
  - public database connectivity status and disablement or retained-public-path justification
- Add provider-capability hook support for `supabase-privatelink-prerequisite`:
  - support-mediated Supabase dashboard/share initiation remains a gated prerequisite
  - AWS-side RAM acceptance and endpoint or service-network association are automated where AWS APIs
    support it
  - evidence capture is required even for manual/support-mediated steps
- Update setup, managed dependency validation, and cutover validation to require this evidence when
  `--supabase-privatelink` or `databaseConnectivity = "privatelink"` is selected.
- Keep public TLS as an explicit selected mode with separate evidence; do not silently fall back from
  PrivateLink to public.
- Add a post-PrivateLink guard that blocks disabling public database connectivity until service,
  workers, migrations, managed dependency validation, and every declared database client have passed
  from the private hostname.
- Add generated commands explaining the remaining Supabase dashboard or support steps and the AWS
  evidence commands to run afterward.

### 3. External prerequisites

- Supabase PrivateLink availability in the selected region and plan.
- Supabase dashboard or support-mediated resource share initiation where Supabase does not expose a
  repo-usable API.
- AWS permissions for RAM and VPC Lattice endpoint or service-network association.

### 4. Tests to be added

- Add fixtures for PrivateLink endpoint and service-network association variants.
- Add negative tests for missing RAM acceptance, wrong region, missing resource configuration,
  missing endpoint DNS/IPs, missing security-group proof, public Supabase hostname in PrivateLink
  mode, missing `psql` proof, missing public-connectivity status, premature public-connectivity
  disablement, and stale evidence.
- Add managed dependency tests proving public TLS evidence cannot satisfy PrivateLink mode.
- Add hook tests proving support-mediated evidence is tied to the selected capability id and cannot
  be replaced with dashboard screenshots or notes.

### 5. Docs to be added or updated

- Update `docs/control-plane-guide.md` Step 2, Step 9, Step 10, and troubleshooting PrivateLink
  notes.
- Add PrivateLink evidence examples to `docs/cloud-control-cutover.md`.
- Document the exact split between Supabase dashboard/support action, AWS RAM acceptance, AWS VPC
  Lattice wiring, and runtime database URL selection.

### 5.5. Expected regression scope

- `deployment-only` for schemas, hooks, setup, validation, and tests.
- `deployment-and-project-impact` if checked-in PrivateLink IaC fixtures are added under
  `projects/deployments/**`.

### 6. Acceptance criteria

- PrivateLink cutover proves service and workers use the AWS private path to Supabase Postgres.
- Public database connectivity is either explicitly retained with reviewed evidence or disabled only
  after every declared private-path database client passes.
- Supabase support-mediated steps are recorded as gated evidence, not hidden state.
- Public TLS mode and PrivateLink mode are explicit and cannot satisfy each other accidentally.

### 7. Risks

- Supabase PrivateLink APIs and regional availability can change.
- VPC Lattice resource endpoint versus service-network association support may differ by account or
  region.

### 8. Mitigations

- Keep Supabase-controlled initiation as a gated prerequisite and automate only AWS-side steps that
  are stable.
- Validate the selected variant explicitly and keep docs tied to current evidence requirements.

### 9. Consequences of not implementing this PR

Operators can select `--supabase-privatelink` without the repo proving that runtime traffic avoids
the public Supabase database hostname.

### 10. Downsides for implementing this PR

PrivateLink support remains partly dependent on Supabase plan, region, and support-mediated setup
outside the repo.

## PR-9: AWS instance-profile artifact-store credentials

### 1. Intent

Allow the AWS EC2 production topology to access AWS S3 artifacts through a least-privilege instance
profile instead of static S3-compatible access-key files.

### 2. Scope of changes

- Extend runtime artifact-store config with an explicit credential mode:
  - `files` for existing S3-compatible access-key files
  - `aws-instance-profile` for AWS S3 on EC2
- Implement AWS SigV4 signing with temporary credentials from the EC2 instance metadata service or
  a reviewed AWS SDK credential provider path for AWS S3 only.
- Require IMDSv2 or an equivalent reviewed temporary-credential source for live EC2 use.
- Keep static file-backed credentials as the only supported mode for Supabase Storage S3,
  Cloudflare R2, and generic S3-compatible backends.
- Update setup rendering so AWS S3 can omit artifact access-key files only when instance-profile
  mode is selected and host evidence includes the expected IAM role.
- Update credential manifest validation so required files depend on artifact credential mode.
- Add managed dependency conformance for instance-profile mode, including role identity and bucket
  permission proof without persisting temporary credentials.
- Ensure process env scrubbing still rejects ambient AWS environment credentials for protected/shared
  production unless an explicit local/test mode allows them.

### 3. External prerequisites

- AWS S3 bucket and IAM role/policy allowing only the reviewed bucket/prefix operations.
- EC2 host with IMDSv2 enabled and the reviewed instance profile attached.

### 4. Tests to be added

- Add unit tests for temporary credential parsing, session-token signing, expiry handling, and
  redaction.
- Add fake IMDSv2 tests for token requirement, missing role, expired credentials, and unavailable
  metadata service.
- Add runtime config tests rejecting instance-profile mode for non-AWS endpoints and accepting file
  mode for existing backends.
- Add setup and credential-manifest tests for mode-specific required files.
- Add managed dependency tests proving role identity and bucket permission proof are recorded without
  secret values.

### 5. Docs to be added or updated

- Update `docs/control-plane-guide.md` Step 3 and Step 7 to prefer instance-profile artifact access
  for AWS S3 when PR-9 support is present.
- Update runtime configuration docs with artifact credential modes.
- Document the fallback file-backed mode for non-AWS S3-compatible stores.

### 5.5. Expected regression scope

- `deployment-only`
- If a shared AWS signing utility is needed outside deployment-owned tooling, update this plan before
  introducing shared-path code.

### 6. Acceptance criteria

- AWS EC2 production can use a least-privilege IAM role for artifact storage.
- Non-AWS S3-compatible backends continue using file-backed credentials.
- Temporary AWS credentials are never persisted in evidence, logs, records, or generated config.

### 7. Risks

- Implementing credential-chain behavior too broadly can reintroduce ambient credentials.
- IMDS access can make local tests flaky if not isolated.

### 8. Mitigations

- Scope instance-profile mode to AWS S3 and require explicit config selection.
- Use fake IMDS fixtures by default and live-gated tests only for real EC2.

### 9. Consequences of not implementing this PR

Operators must provision and rotate static S3-compatible keys even on AWS EC2, increasing the
credential burden for the recommended topology.

### 10. Downsides for implementing this PR

The artifact-store implementation gains AWS-specific credential behavior in addition to the generic
S3-compatible path.

## PR-10: Supabase Postgres provisioning and lifecycle evidence

### 1. Intent

Reduce manual Supabase database setup to reviewed project selection, generated non-secret
configuration, and machine-checkable lifecycle evidence for the control-plane database.

### 2. Scope of changes

- Add a deployment-owned Supabase managed Postgres provisioning profile that can represent:
  - existing project import
  - new project request when Supabase API support and cost confirmation are available
  - project ref, organization id, region, plan class, and selected environment
  - database identity label used by setup, managed dependency validation, and cutover evidence
  - public TLS versus PrivateLink connection policy
  - backup, restore, point-in-time recovery, and retention posture
  - migration user and runtime user separation where supported
  - reviewed PgBouncer versus direct connection support by operation
- Add a database bootstrap and migration readiness workflow that:
  - applies or verifies the control-plane schema through the reviewed migration bundle path
  - uses direct Postgres connections for migrations unless PgBouncer has operation-specific proof
  - records migration version, migration lock evidence, and schema compatibility evidence
  - separates migration credentials from runtime credentials where supported
  - verifies backup restore into a non-production target before protected/shared cutover
- Add provider-capability evidence for `supabase-managed-postgres` that proves:
  - project and AWS region compatibility
  - required Postgres feature conformance
  - migration lock behavior
  - schema migration version and compatibility
  - backup/restore policy evidence
  - runtime connection mode evidence
  - no database URL or service key is persisted
- Generate setup inputs and managed dependency expectations from the Supabase profile instead of
  asking operators to manually copy project labels into multiple files.
- Add an evidence-only path for Supabase dashboard or support actions that cannot be automated.
- Keep database schema migrations under the existing control-plane migration path; do not let
  Supabase dashboard state become a second schema authority.

### 3. External prerequisites

- Supabase organization/project access for live-gated provisioning or import evidence.
- Cost confirmation for any automated new project creation.
- Supabase plan and region support for the selected public or PrivateLink path.

### 4. Tests to be added

- Add fixture tests for existing-project import and generated project profile output.
- Add negative tests for region mismatch, missing backup policy, missing restore evidence, missing
  migration user/runtime user separation when required, missing migration version, migration lock
  failure, PgBouncer used for an unproven migration operation, unsupported connection mode, and
  persisted secret-looking Supabase fields.
- Add provider-capability hook tests proving `supabase-managed-postgres` evidence cannot be replaced
  by dashboard-only notes.
- Add managed dependency tests proving profile-derived expectations match conformance evidence.

### 5. Docs to be added or updated

- Update `docs/control-plane-guide.md` Step 1 with the generated/imported Supabase profile flow.
- Update managed dependency docs with backup, restore, migration, and connection-mode expectations.
- Document which Supabase steps are API-backed, which remain dashboard/support-mediated, and how each
  is evidenced.

### 5.5. Expected regression scope

- `deployment-only` for profiles, validation, provider hooks, and tests.
- Use Supabase MCP or API-backed tooling only in live-gated paths; fixture tests must not create paid
  resources.

### 6. Acceptance criteria

- Operators provide Supabase project intent once, and setup/validation/cutover consume generated
  non-secret profile outputs.
- Supabase managed Postgres evidence proves feature conformance, region compatibility, backup/restore
  posture, migration readiness, schema compatibility, and selected connection mode.
- No Supabase secret, database URL, service role key, or access token is persisted in generated
  artifacts.

### 7. Risks

- Supabase API coverage may not expose every project, backup, or connection-policy field needed for
  full automation.
- Automated project creation has cost and organization-selection implications.

### 8. Mitigations

- Support existing-project import and evidence-only dashboard/support steps where API coverage is
  incomplete.
- Require explicit cost confirmation and live-gated execution for project creation.

### 9. Consequences of not implementing this PR

Step 1 remains a manually coordinated database setup whose outputs must be copied into later setup
and cutover steps by hand.

### 10. Downsides for implementing this PR

The deployment tooling must track Supabase project lifecycle and evidence shape in addition to raw
Postgres feature conformance.

## PR-11: Generated runtime config and credential staging workflow

### 1. Intent

Remove the remaining hand-edited production config and ad hoc credential-copy steps by generating
runtime config from reviewed inputs and staging file-backed credentials through a repeatable host
workflow.

### 2. Scope of changes

- Add a typed runtime input file consumed by `deployment-control-plane setup` for non-secret values:
  - auth issuer, audience, JWKS URL, role/group claim mappings, service principals, callback host,
    and callback path
  - Infisical site URL, project id, environment, and deployment id mappings
  - Supabase project profile reference
  - AWS topology/profile reference
  - artifact credential mode
- Generate `config.yaml` from that input plus IaC/provider evidence outputs, with explicit
  placeholder rejection for production profiles.
- Add an auth-provider profile that can either provision or import the selected identity provider
  client/application:
  - current local identity-provider compatibility mode
  - Supabase Auth OIDC/JWKS metadata and redirect URL evidence when selected
  - WorkOS OIDC/JWKS metadata and redirect URL evidence when selected
  - reviewed external OIDC provider import mode
  - callback URL registration for `authCallbackHost` and `authCallbackPath`
  - service-principal and group/role claim mapping evidence
  - CLI login and PKCE callback smoke evidence where the provider supports it
- Add validation that production setup rejects default auth placeholders such as
  `https://auth.example.test` unless an explicit local/fixture mode is selected.
- Add a credential staging workflow for AWS hosts that:
  - reads `credential-manifest.json`
  - maps each required runtime file to a reviewed secret-backend reference or host credential source
  - generates high-entropy values directly into the reviewed secret backend for credentials the repo
    owns, such as the control-plane token, without printing or persisting the value locally
  - imports provider-generated secrets, such as GitHub App private keys or Infisical client secrets,
    by reference or encrypted host credential source without logging values
  - renders systemd `LoadCredential=` or equivalent host-specific credential mount wiring
  - supports rotation by regenerating the host credential map and restarting or reloading the
    affected service/worker units safely
  - verifies final mounted filenames and permissions on the host
- Add a secret-backend provisioning/import profile for runtime credential sources:
  - Infisical project/environment/path import or creation where supported
  - deployment-scoped Universal Auth machine identity import or creation
  - least-privilege Infisical role/scope evidence for the required secret paths only
  - generated placeholders or write plans for required secret names without persisting values
  - reviewed-source SSH deploy key and known-hosts provisioning/import evidence
  - GitHub App id, installation id, and private-key source import evidence when GitHub App mode is
    selected
  - control-plane token generation/import evidence
  - database URL import evidence tied to the selected Supabase profile and public/private hostname
  - rotation plan and stale credential detection for every manifest entry
- Keep runtime processes seeing only files under `/run/deployment-control-plane/credentials`.
- Generate an operator checklist only for the residual manual actions that cannot be automated.

### 3. External prerequisites

- Reviewed auth-provider metadata from the chosen identity provider.
- Provider API access for live-gated auth-provider client provisioning or imported evidence from a
  reviewed identity administration workflow.
- Reviewed secret-backend entries for database URL, control-plane token, reviewed-source credentials,
  artifact credentials when file mode is used, and Infisical Universal Auth credentials.
- Infisical and reviewed-source provider access for live-gated provisioning/import evidence.
- Host access for live-gated credential mount verification.

### 4. Tests to be added

- Add runtime input parsing tests for auth, Infisical, Supabase, AWS, and artifact credential modes.
- Add auth-provider profile tests for local, Supabase Auth, WorkOS, and external OIDC import modes.
- Add negative tests for missing callback registration, wrong issuer, wrong audience, stale JWKS,
  missing role/group mappings, missing service-principal mappings, and wrong environment metadata.
- Add production setup tests rejecting placeholder auth and Infisical values.
- Add credential map tests for SSH reviewed-source mode, GitHub App reviewed-source mode,
  file-backed S3 artifact mode, and AWS instance-profile artifact mode.
- Add secret-backend profile tests for Infisical project/environment/path import, machine identity
  scope, required secret name plans, reviewed-source SSH import, GitHub App import, stale credential
  detection, and redaction.
- Add generated-secret tests proving control-plane token generation writes only to the secret backend
  and never appears in stdout, logs, evidence, process args, or generated files.
- Add host-profile tests proving generated systemd `LoadCredential=` or equivalent mount wiring
  matches `credential-manifest.json`.
- Add rotation tests proving regenerated credential mappings do not change config semantics and do
  not print secret values.

### 5. Docs to be added or updated

- Update `docs/control-plane-guide.md` Step 6 and Step 7 to use the runtime input file and credential
  staging workflow.
- Update runtime configuration docs with production placeholder rejection and generated config
  provenance.
- Update auth-provider docs with provisioning/import evidence, callback registration, and CLI login
  smoke expectations.
- Update secret-backend and reviewed-source docs with provisioning/import profiles and rotation
  evidence.
- Add credential rotation docs for AWS EC2 service and worker units.

### 5.5. Expected regression scope

- `deployment-only` for setup, validation, host profile rendering, and tests.
- `deployment-and-project-impact` if checked-in deployment fixtures are added for concrete
  secret-backend mappings.

### 6. Acceptance criteria

- Production `config.yaml` is generated from reviewed inputs and provider/IaC outputs, not manually
  edited placeholders.
- Auth-provider client/application setup is either automated or imported with structured evidence,
  including callback registration and claim mapping proof.
- Credential staging is repeatable, validates final mounted files, and supports rotation without
  leaking secret values.
- Repo-owned secret values can be generated directly into the reviewed secret backend and mounted
  onto the host without operator copy/paste.
- Infisical machine identities, secret paths, reviewed-source credentials, and rotation posture are
  generated or imported through structured evidence rather than ad hoc operator notes.
- Operators have a generated residual-action checklist that contains only steps the repo cannot
  safely automate.

### 7. Risks

- Credential staging automation can become a hidden secret distribution system if boundaries are not
  explicit.
- Auth-provider metadata can be copied from the wrong environment.
- Auth-provider provisioning can accidentally grant broad application access or accept ambiguous
  role claims.
- Secret-backend provisioning can accidentally create overly broad machine identities or persist
  placeholder secret values.

### 8. Mitigations

- Keep all runtime secrets file-backed and make secret-backend references explicit in the credential
  map.
- Tie auth-provider metadata to expected issuer, callback host, environment, and evidence digests.
- Require explicit role/group and service-principal mappings and fail closed on ambiguous or missing
  claims.
- Generate secret names and access policy, not secret values, and test that machine identities are
  scoped to declared deployment requirements.

### 9. Consequences of not implementing this PR

Operators must continue editing production config placeholders, manually configuring auth callback
state, and manually copying credential files, which is error-prone and hard to audit.

### 10. Downsides for implementing this PR

The setup workflow gains another structured input and a host-specific credential staging surface.

## PR-12: Operational evidence hardening and end-to-end AWS cutover flow

### 1. Intent

Make cutover, rollback, restore, and break-glass reports explicit, machine-checkable, and complete
enough for a protected/shared AWS control-plane cutover.

### 2. Scope of changes

- Replace truthy checks in cutover, rollback, restore, and break-glass validation with typed schemas
  that include operation identity, host profile, image digest, config digest, credential manifest
  digest, source host, checked-at timestamps, and selected provider capabilities.
- Add a generated evidence collector command that reads setup outputs plus live provider evidence
  and writes `cloud-cutover-evidence.json`.
- Add an end-to-end workflow or doctor command that reads the generated runbook from PR-1 and all
  selected evidence files, then reports the next executable phase from setup through cutover without
  requiring the operator to infer ordering from docs.
- Require selected provider-capability evidence for every depended-on or mutated external component:
  - `aws-ec2-control-plane-host`
  - `aws-network-foundation`
  - `aws-s3-artifact-store` when AWS S3 is selected
  - `supabase-managed-postgres`
  - `supabase-privatelink-prerequisite` when PrivateLink is selected
  - optional edge, operator UI, cache, or remote-build fleet capabilities when selected
- Require restore validation evidence for database records, artifact objects, stage state, image
  digest, config digest, credential manifest digest, auth-provider config, and durable references.
- Require rollback evidence for previous host profile, traffic target, standby service mode, worker
  disablement or drain, provider locks, in-flight queue posture, and double-execution prevention.
- Require break-glass evidence for status inspection, worker pause/freeze, preserved audit path,
  provider mutation blocking, and incident-bounded access.
- Add standby-mode validation for mini or another previous host so it can remain service-only,
  worker-only, fully-enabled, or fully-disabled against the same external durable dependencies.
- Add a live-gated end-to-end AWS staging scenario that follows the guide:
  - generate profile
  - stage credentials
  - validate managed dependencies from the AWS path
  - start one service and two workers
  - collect provider evidence
  - run cutover validation
  - run a protected/shared staging deployment
  - prove rollback and break-glass reports
- Keep live-gated tests skipped by default and fixture-backed tests authoritative in CI.

### 3. External prerequisites

- A fully provisioned AWS/Supabase topology from earlier PRs for live-gated staging validation.
- DNS or edge control for the service and auth callback hosts.
- Previous host access if mini or another host remains standby.

### 4. Tests to be added

- Add positive fixture reports for cutover, rollback, restore, and break-glass.
- Add negative tests for literal `true`, empty objects, stale timestamps, dashboard-only notes,
  raw-IaC-only state, mismatched digests, wrong host profile, missing standby controls, missing
  provider locks, and missing provider mutation block proof.
- Add generated evidence collector tests proving output is accepted by `deployment-control-plane
cutover`.
- Add workflow/doctor tests proving missing earlier-phase evidence blocks later phases with a
  precise command or provider action, and that complete evidence unlocks the cutover command.
- Add standby-mode tests proving workers can be disabled and re-enabled without double execution.
- Add live-gated AWS staging flow tests with clear opt-in environment variables.

### 5. Docs to be added or updated

- Update `docs/control-plane-guide.md` Step 10, Step 11, troubleshooting, and operator checklist to
  reference generated workflow/doctor and evidence collector commands instead of hand-ordered
  command sequences.
- Update `docs/cloud-control-cutover.md` with complete minimal JSON examples for cutover, rollback,
  restore, and break-glass.
- Update mini operations docs with standby mode and rollback responsibilities.
- Update this plan with any follow-up gaps discovered by the live-gated staging scenario.

### 5.5. Expected regression scope

- `deployment-only` for validation, generated commands, and fixture tests.
- `deployment-and-project-impact` if checked-in staging deployment fixtures or AWS scenario packages
  are added under `projects/deployments/**`.
- Live host changes remain explicitly gated and must not run in ordinary CI.

### 6. Acceptance criteria

- AWS cutover cannot pass with stale, missing, host-mismatched, or placeholder evidence.
- The operator can use one generated workflow/doctor surface to determine the next safe action from
  setup through cutover.
- Rollback, restore, and break-glass reports are machine-checkable and non-secret.
- Mini or another previous host can remain standby without owning authoritative durable state.
- A live-gated protected/shared staging deployment can complete through the AWS-primary path after
  all selected evidence passes.

### 7. Risks

- End-to-end cutover validation can become operationally heavy and slow.
- Rollback and break-glass controls can block urgent incident response if the required evidence is
  too rigid.

### 8. Mitigations

- Keep fixture validation fast and make live-gated runs explicit.
- Model incident-bounded break-glass as audited controls that preserve authority boundaries rather
  than as ad hoc manual mutation.

### 9. Consequences of not implementing this PR

The repo would have many cloud-ready components but still no unambiguous, audited path for moving
protected/shared deployment traffic to AWS and proving rollback safety.

### 10. Downsides for implementing this PR

Operational discipline increases: operators must collect and retain structured evidence for
cutover, rollback, restore, and emergency access.

## PR-13: Profile-aware Supabase lifecycle evidence commands and freshness gates

### 1. Intent

Make `supabase-managed-postgres` provider evidence producible from generated commands and freshness
gated wherever setup, managed dependency validation, or cutover consumes Supabase lifecycle facts.

### 2. Scope of changes

- Add provider-capability CLI plumbing so generated `supabase-managed-postgres` commands can accept
  the selected `supabase-postgres.profile.json` or a generated profile-root-relative equivalent.
- Update generated provider-capability command declarations so operators can produce structured
  Supabase lifecycle evidence without hand-assembling hook payloads.
- Require the generated command to emit provider hook evidence that is accepted by setup readiness
  and cutover validation for the selected Supabase project, organization, region, connection mode,
  plan capability, migration metadata, backup/restore posture, and user separation policy.
- Introduce a `supabase-managed-postgres-evidence@1` wrapper or equivalent evidence envelope with:
  - selected profile identity
  - evidence source
  - checked-at timestamp
  - maximum age
  - lifecycle profile payload
  - migration/schema metadata digest or authority reference
- Make setup, managed dependency validation, provider hook validation, and cutover consume the same
  freshness-gated lifecycle evidence shape instead of accepting stale bare profile facts.
- Keep live Supabase provisioning, backup mutation, restore mutation, and dashboard/support mutation
  out of the default path; generated commands may collect or validate structured evidence, not mutate
  provider state unless an explicit live gate is added.

### 3. External prerequisites

- A reviewed Supabase managed Postgres profile from PR-10.
- Provider access or reviewed evidence exports for lifecycle, plan, migration, backup, restore, and
  connection-mode facts.
- Existing PrivateLink evidence from PR-8 when the selected profile requires PrivateLink.

### 4. Tests to be added

- Add generated command tests proving `commands.json` includes a profile-aware
  `supabase-managed-postgres` evidence command with valid `$PROFILE_ROOT/...` paths.
- Add hook CLI tests proving the command emits cutover-valid evidence for the selected profile.
- Add negative tests for missing profile path, mismatched project, mismatched region, mismatched
  connection mode, stale `checkedAt`, expired `maxAge`, missing migration metadata, missing
  backup/restore evidence, dashboard-only notes, and mutation-authority claims.
- Add setup and cutover tests proving stale bare `supabase-postgres.profile.json` cannot satisfy
  lifecycle evidence without the freshness-gated wrapper.

### 5. Docs to be added or updated

- Update `docs/control-plane-guide.md` Step 9 and Step 10 with the generated Supabase lifecycle
  evidence command and expected evidence file.
- Update `docs/control-plane-managed-dependencies.md` to describe the lifecycle evidence envelope,
  freshness rules, and profile identity binding.
- Update `docs/cloud-control-cutover.md` examples to use the freshness-gated Supabase lifecycle
  evidence shape.

### 5.5. Expected regression scope

- `deployment-only` for CLI plumbing, generated commands, validators, docs, and fixture tests.
- Live Supabase checks remain explicitly gated and must not run in ordinary CI.

### 6. Acceptance criteria

- Operators can produce `supabase-managed-postgres` provider evidence through a generated command.
- Setup and cutover reject stale, profile-mismatched, dashboard-only, or self-attested Supabase
  lifecycle evidence.
- Supabase lifecycle validation uses one freshness-gated evidence shape across setup, managed
  dependency validation, provider hooks, and cutover.
- No Supabase secret, database URL, service-role key, access token, or password is written to
  generated evidence, logs, or docs examples.

### 7. Risks

- Adding provider evidence CLI inputs can create another command surface that drifts from generated
  setup artifacts.
- Freshness gates can block legitimate cutovers if evidence collection is slow or operators do not
  understand which evidence must be refreshed.

### 8. Mitigations

- Generate all command paths from setup artifacts and assert them in fixture tests.
- Include precise validation errors naming the stale or mismatched Supabase evidence field.

### 9. Consequences of not implementing this PR

The repo can require structured Supabase lifecycle evidence but still leave operators without a
generated way to produce it, and stale lifecycle facts can satisfy part of cutover.

### 10. Downsides for implementing this PR

Operators must refresh Supabase lifecycle evidence near cutover time instead of reusing old profile
exports indefinitely.

## PR-14: Credential staging and rotation executor

### 1. Intent

Turn the PR-11 credential map from an audited plan into a repeatable deployment-owned staging and
rotation workflow that can safely prepare AWS host credentials without leaking secret values.

### 2. Scope of changes

- Add a deployment-owned credential staging command that consumes:
  - `credential-manifest.json`
  - `credential-map.json`
  - reviewed secret-backend profile/evidence
  - host credential source evidence
  - generated runtime config provenance
- Execute safe fixture/default operations as validation only, and keep live writes behind an
  explicit gate.
- For repo-owned generated secrets, write values directly into the reviewed backend in live-gated
  mode without printing, logging, saving locally, or including values in process arguments.
- For provider-generated secrets, import by reviewed backend reference or encrypted host credential
  source rather than by raw value.
- Produce non-secret staging evidence that records:
  - manifest digest
  - credential map digest
  - backend path references
  - generated secret write-plan ids
  - host credential source ids
  - stale credential detection results
  - service and worker reload or restart evidence
- Add a rotation command or subcommand that regenerates host credential maps, validates stale entries,
  and records service/worker reload evidence without changing non-secret config semantics.
- Add host mount verification support for generated AWS host profiles:
  - filename set
  - ownership and permissions
  - mount target paths under `/run/deployment-control-plane/credentials`
  - compatibility with existing bind-mounted credential-directory wiring
- Do not assume systemd `LoadCredential=` unless that host profile path is explicitly implemented
  and tested; existing bind-mounted credential directory wiring remains valid when verified.

### 3. External prerequisites

- Reviewed secret-backend access for the selected backend.
- Reviewed source provider access for SSH or GitHub App credentials when selected.
- Host access for live-gated mount verification.
- Existing generated runtime input, credential manifest, and credential map from PR-11.

### 4. Tests to be added

- Add fixture staging tests proving the command consumes the manifest and credential map, validates
  backend refs, and writes only non-secret evidence.
- Add generated-secret tests proving no secret value appears in stdout, stderr, logs, evidence,
  process arguments, generated files, or docs examples.
- Add negative tests for missing backend refs, over-broad Infisical scope, stale credential refs,
  unsupported source kind, env-var-only secrets, raw secret values in maps, missing reload evidence,
  and mount filename or permission mismatches.
- Add rotation tests proving regenerated maps preserve non-secret config semantics and fail closed
  when stale entries remain active.
- Add host-profile tests for both file-backed artifact credentials and AWS S3 instance-profile mode.
- Add setup-doctor or workflow tests proving later setup/cutover phases are blocked until credential
  staging evidence exists.

### 5. Docs to be added or updated

- Update `docs/control-plane-guide.md` Step 6 and Step 7 to replace manual file staging instructions
  with the generated credential staging and rotation workflow.
- Remove stale documentation that says runtime credential staging remains later work once this PR is
  implemented.
- Update `docs/control-plane-runtime-configuration.md` with credential staging evidence, rotation
  evidence, and host mount verification examples.
- Add troubleshooting guidance for stale credentials, failed backend writes, and host mount
  permission mismatches.

### 5.5. Expected regression scope

- `deployment-only` for fixture validation, generated commands, credential staging evidence, host
  profile rendering, and docs.
- Live backend writes and host mount checks remain explicitly gated and must not run in ordinary CI.

### 6. Acceptance criteria

- Operators can run a generated command to validate and stage credentials from `credential-map.json`.
- Repo-owned generated secrets are written only to the reviewed backend in live-gated mode and never
  appear in local artifacts or logs.
- Provider-generated secrets are imported only by reviewed reference or encrypted host source.
- Setup/cutover workflow blocks protected/shared progress until credential staging evidence is
  present, fresh, and tied to the current credential manifest.
- Rotation evidence proves stale entries are replaced and affected service/worker units are reloaded
  or restarted without changing non-secret config semantics.

### 7. Risks

- Credential staging can accidentally become provider-specific mutation authority if live writes are
  not clearly gated.
- Host mount verification can be brittle across NixOS, systemd/Podman, and future host profiles.

### 8. Mitigations

- Keep fixture validation authoritative in CI and require explicit live-gate environment variables
  for backend writes or host checks.
- Model host wiring by declared profile capabilities and validate the existing bind-mounted
  credential directory before adding new host-specific mount mechanisms.

### 9. Consequences of not implementing this PR

Operators still need to manually stage credential files from a credential map, leaving rotation and
mount verification outside the audited setup workflow.

### 10. Downsides for implementing this PR

The deployment tooling must handle provider-specific staging errors and host-specific credential
mount differences without leaking secret material.

## PR-15: Live credential backend writer and host mount verifier

### 1. Intent

Close the remaining PR-14 execution gap by turning live-gated credential staging from external
evidence validation into a deployment-owned live operation that writes repo-owned generated secrets
to the reviewed backend and verifies the actual host credential mount without persisting secret
values locally.

### 2. Scope of changes

- Add a live-gated credential backend writer for repo-owned generated secrets that:
  - consumes `credential-map.json` generated-secret write plans
  - uses reviewed Infisical backend/profile evidence and least-privilege scope evidence
  - generates secret values in memory only
  - writes values directly to the reviewed backend without command-line secret arguments
  - emits only non-secret backend write evidence
- Keep fixture/default staging behavior as validation-only and require an explicit live gate for all
  backend mutation.
- Reconcile generated-secret write plans with the reviewed backend after writing:
  - expected project, environment, and path
  - expected deployment-scoped identity
  - expected least-privilege scope
  - expected generated-secret write-plan ids
  - no local persisted secret value evidence
- Preserve provider-generated secret behavior as import-by-reference or encrypted host source only;
  do not add raw-value import paths for provider-owned credentials.
- Add a live host mount verifier that checks the actual mounted credential directory from the host
  or generated profile context:
  - required filename set
  - uid/gid ownership
  - file permissions
  - target path under `/run/deployment-control-plane/credentials`
  - bind-mounted credential-directory wiring for AWS host profiles
- Make the staging and rotation evidence distinguish:
  - externally supplied reviewed proof
  - deployment-owned live backend write
  - deployment-owned live host filesystem verification
- Ensure generated setup/runbook commands expose the live writer and host verifier flags only in the
  explicitly gated live path.

### 3. External prerequisites

- Reviewed Infisical backend credentials with write access scoped to the generated deployment paths.
- Reviewed secret-backend profile/evidence from the generated setup bundle.
- Host access to inspect the generated AWS credential directory or a reviewed remote verifier capable
  of returning signed non-secret filesystem evidence.
- Existing credential manifest, credential map, runtime config, staging evidence, and rotation
  workflow from PR-11 and PR-14.

### 4. Tests to be added

- Add fixture tests with a fake Infisical backend proving live-gated generated-secret write plans
  create backend records and emit only non-secret evidence.
- Add negative tests proving live backend writes fail closed when:
  - the explicit live gate is absent
  - backend scope is over-broad
  - project, environment, path, or deployment identity mismatches the credential map
  - a generated secret value would be logged, persisted, emitted in evidence, or passed through
    process arguments
  - provider-generated credentials attempt raw-value import
- Add tests proving existing externally supplied backend evidence remains accepted only as reviewed
  proof and cannot masquerade as deployment-owned live write evidence.
- Add host mount verifier tests proving the command checks actual filesystem metadata for filename
  set, ownership, permissions, and target path.
- Add negative host mount tests for missing files, extra files, wrong uid/gid, writable permissions,
  wrong target path, symlink escapes, and stale bind-mounted directory wiring.
- Add generated runbook tests proving live commands use valid CLI flags and resolve paths from the
  generated bundle root.

### 5. Docs to be added or updated

- Update `docs/control-plane-guide.md` with the live credential writer and host verifier workflow,
  including the explicit live gate, required backend credentials, and non-secret output evidence.
- Update `docs/control-plane-runtime-configuration.md` to distinguish fixture validation,
  externally reviewed proof, deployment-owned live backend writes, and deployment-owned live mount
  verification.
- Add troubleshooting guidance for rejected backend scope, failed Infisical writes, stale write-plan
  ids, host filesystem mismatches, and remote verifier failures.
- Keep docs examples free of secret values and avoid shell examples that place secret material in
  arguments or environment variables.

### 5.5. Expected regression scope

- `deployment-only` for live-gated credential staging, fake backend mutation, host mount
  verification, generated runbook commands, and docs.
- Live Infisical writes and real host checks must remain opt-in and must not run in ordinary CI.

### 6. Acceptance criteria

- In live-gated mode, repo-owned generated secrets are written by the deployment command directly to
  the reviewed backend and never appear in local artifacts, logs, stdout, stderr, docs examples, or
  process arguments.
- The command emits non-secret evidence proving the backend write matched the current credential map,
  reviewed backend profile, deployment identity, and least-privilege scope.
- Provider-generated secrets remain import-by-reference or encrypted-host-source only.
- Live host verification inspects the actual mounted credential directory or a reviewed remote
  verifier result and fails closed on filename, ownership, permission, target path, or bind-mount
  mismatches.
- Setup and cutover can distinguish fixture validation, reviewed external proof, and
  deployment-owned live execution evidence.

### 7. Risks

- Adding live mutation to credential staging can leak secret material if logging, errors, subprocess
  arguments, or temporary files are not strictly controlled.
- Direct host filesystem verification can become provider- or OS-specific and may not work from all
  operator environments.
- Fake-backend tests can pass while real Infisical API behavior differs.

### 8. Mitigations

- Keep the live writer behind a dedicated environment gate and require explicit backend profile,
  scope, and deployment identity evidence before mutation.
- Use in-memory secret generation, redaction helpers, and subprocess argument checks in tests.
- Isolate host verification behind a small profile-aware verifier interface with local and reviewed
  remote verifier implementations.
- Cover real command shape with generated runbook tests and fake Infisical contract tests before any
  optional live-provider smoke test is added.

### 9. Consequences of not implementing this PR

The plan can still claim live credential staging support while the implementation only accepts
external proof files. Operators would need to perform backend writes and host mount checks outside
the deployment-owned audited command path.

### 10. Downsides for implementing this PR

The credential staging tool becomes mutation-capable in a narrowly gated path, increasing the amount
of provider-specific error handling, redaction coverage, and host-profile verification logic that
must be maintained.

## PR-16: Credential staging verifier trust and evidence exclusivity

### 1. Intent

Close the remaining PR-15 evidence-hardening gaps by making remote host verification cryptographically
or command-provenance trustworthy, and by ensuring externally reviewed proof can never coexist with or
masquerade as deployment-owned live execution evidence.

### 2. Scope of changes

- Replace self-declared remote host verifier evidence with a reviewed trust contract:
  - verifier identity
  - reviewed verifier public key or deployment-owned verifier command provenance
  - canonical evidence payload digest
  - signature or command-attestation binding over the payload digest
  - reviewed source host and target credential directory
- Reject hand-authored remote verifier JSON that only declares `reviewed-remote-verifier`, `sig:*`,
  or a matching digest without proving the verifier trust root.
- Keep local host verification as the preferred generated command path when the command runs on the
  target host, and make any remote-verifier path explicit in generated docs and validation errors.
- Fix persisted staging evidence validation so external reviewed proof and deployment-owned live
  write evidence are mutually exclusive:
  - `--secret-backend-evidence` remains proof-only
  - `deploymentOwnedLiveBackendWrite` remains command-owned execution evidence
  - a staging artifact containing both forms is rejected
  - cutover and runbook validators enforce the same exclusivity
- Clarify generated runbook inputs so local host verification does not require remote verifier
  profiles, and remote host verification examples include the reviewed verifier trust inputs.

### 3. External prerequisites

- Reviewed remote verifier trust material when operators choose remote host verification instead of
  running the local verifier on the target host.
- Existing live credential staging, live backend writer, host verifier, and cutover wiring from
  PR-15.

### 4. Tests to be added

- Add remote verifier tests proving hand-authored JSON with a matching digest and `sig:*` marker is
  rejected when it is not signed by the reviewed verifier key or produced by the deployment-owned
  verifier command.
- Add positive remote verifier tests using the reviewed trust contract.
- Add negative tests for verifier identity mismatch, source host mismatch, target path mismatch,
  payload digest mismatch, missing signature/attestation, wrong public key, and stale verifier
  provenance.
- Add persisted evidence tests proving a staging artifact with both external reviewed proof and
  `deploymentOwnedLiveBackendWrite` is rejected.
- Add cutover/runbook validation tests proving mixed proof/write evidence cannot satisfy protected
  cutover.
- Add generated runbook tests proving local-host verification commands do not require remote verifier
  profile inputs, while remote-verifier examples include all required trust inputs.

### 5. Docs to be added or updated

- Update `docs/control-plane-guide.md` to explain the local-host verifier path and the remote-verifier
  trust contract separately.
- Update `docs/control-plane-runtime-configuration.md` with the verifier signature or command
  provenance requirements and the proof-vs-execution evidence exclusivity rule.
- Add troubleshooting guidance for failed verifier signature, mismatched verifier identity, stale
  verifier provenance, and mixed external-proof/live-write artifacts.

### 5.5. Expected regression scope

- `deployment-only` for credential staging evidence validation, remote verifier validation, generated
  runbook command inputs, cutover evidence validation, and docs.
- Real remote host verification remains opt-in and must not run in ordinary CI.

### 6. Acceptance criteria

- Hand-authored remote host verifier JSON cannot satisfy protected/shared credential staging or
  cutover requirements.
- Remote host verification is accepted only when bound to a reviewed verifier trust root or
  deployment-owned verifier command provenance.
- External reviewed backend proof and deployment-owned live backend write evidence are mutually
  exclusive in persisted staging artifacts and in cutover/runbook validators.
- Generated local-host verifier commands remain runnable from the bundle root without remote
  verifier-only inputs.
- Docs clearly separate local verifier operation, remote verifier operation, and proof-only external
  evidence.

### 7. Risks

- Introducing signature or command-attestation validation can make operator setup more complex.
- A verifier trust contract can drift from generated host profile metadata if it is not bound to the
  same source host and credential directory facts.

### 8. Mitigations

- Prefer local-on-host verification in generated commands and keep remote verification as an explicit
  alternate path.
- Reuse canonical JSON/digest helpers so signatures and evidence validation agree on the exact payload.
- Bind verifier trust material to source host, target path, credential filename set, and AWS bind-mount
  wiring evidence.

### 9. Consequences of not implementing this PR

Operators can still hand-author remote verifier JSON or mixed proof/write staging artifacts that look
valid to downstream validators, weakening the protected/shared readiness boundary.

### 10. Downsides for implementing this PR

The credential staging evidence model gains another trust contract and more negative cases that must
stay synchronized with generated runbook commands and docs.

## PR-17: Repo-owned EC2 host provisioning hook

### 1. Intent

Close the guide gap where AWS EC2 host realization is still evidence-shaped by adding repo-owned EC2
launch-template or instance/ASG provisioning semantics behind the reviewed provider capability hook.

### 2. Scope of changes

- Add a concrete AWS EC2 host provisioning adapter for `aws-ec2-control-plane-host` that produces
  structured preview/apply/record/smoke/rollback evidence for one of:
  - launch template plus Auto Scaling Group
  - launch template plus explicitly managed instance
  - a narrow documented instance-only profile if that is the current repo-owned path
- Validate the generated host profile against the provisioned EC2 identity:
  - AMI or image source
  - instance type
  - subnet and security-group attachment
  - IAM instance profile
  - launch template id/version or instance id
  - user-data or bootstrap command digest
  - expected container runtime and credential mount wiring
- Replace generic EC2 capability hook evidence with typed payload validation for preview, apply,
  smoke, and rollback phases.
- Keep fixture/default behavior non-mutating in CI while proving generated commands map to the real
  adapter and structured payload shape.
- If full live AWS mutation remains intentionally out of scope, narrow `docs/control-plane-guide.md`
  so it no longer claims repo-owned EC2 launch-template or instance provisioning.

### 3. External prerequisites

- Reviewed AWS account, region, IAM role, subnet, security-group, instance-profile, and AMI or image
  metadata for live EC2 provisioning.
- Existing AWS topology/profile generation and provider capability hook dispatch from PR-5 through
  PR-16.

### 4. Tests to be added

- Add fixture tests proving the EC2 host capability hook emits typed preview/apply/record/smoke and
  rollback evidence instead of generic reviewed stubs.
- Add generated-command tests proving `deploy --deployment <label> --provider-capability
aws-ec2-control-plane-host` dispatches to the concrete adapter and validates structured payloads.
- Add negative tests for missing launch-template/instance identity, subnet mismatch, security-group
  mismatch, instance-profile mismatch, unpinned AMI/image identity, missing bootstrap digest, missing
  smoke evidence, and rollback evidence shape drift.
- Add docs tests or guide checks proving the guide matches the implemented EC2 provisioning boundary.

### 5. Docs to be added or updated

- Update `docs/control-plane-guide.md` to describe the exact repo-owned EC2 provisioning boundary:
  launch template, ASG, instance-only, or explicitly evidence-only if narrowed.
- Update troubleshooting for EC2 provisioning identity, launch-template drift, bootstrap digest drift,
  and rollback evidence failures.

### 5.5. Expected regression scope

- `deployment-only` for provider capability hook dispatch, EC2 host profile rendering, generated
  commands, fixture evidence, and docs.
- Live AWS EC2 mutation remains gated and must not run in ordinary CI.

### 6. Acceptance criteria

- The EC2 host capability is no longer a generic reviewed stub when the guide claims repo-owned EC2
  provisioning.
- Generated EC2 host commands dispatch to a concrete adapter with typed evidence for preview, apply,
  record, smoke, and rollback phases.
- Protected/shared readiness rejects stale, generic, self-attested, or profile-mismatched EC2 host
  provisioning evidence.
- The guide accurately describes the implemented EC2 provisioning boundary.

### 7. Risks

- Adding EC2 provisioning can expand the provider mutation surface beyond the current fixture-driven
  evidence model.
- Live EC2 launch-template or ASG semantics can diverge from host profile rendering if identity fields
  are duplicated.

### 8. Mitigations

- Keep fixture validation authoritative in CI and require explicit live provider gates for AWS
  mutation.
- Generate or validate all host identity fields from the same typed AWS topology/profile input.
- Treat rollback evidence as required before protected/shared use.

### 9. Consequences of not implementing this PR

The guide continues to imply repo-owned EC2 host provisioning while the implementation only accepts
evidence-shaped host facts and generic capability hook output.

### 10. Downsides for implementing this PR

The EC2 provider adapter must maintain typed AWS identity, smoke, and rollback evidence contracts
that may need updates as the host profile grows.

## PR-18: Runtime HTTP evidence consumption for cutover

### 1. Intent

Ensure protected/shared cutover validates the contents of runtime health, readiness, and worker
heartbeat evidence instead of only carrying file paths or truthy placeholders.

### 2. Scope of changes

- Parse generated HTTP check output during cutover evidence collection for:
  - service health
  - service readiness
  - worker heartbeat/readiness
- Validate each HTTP evidence payload for:
  - success status
  - fresh `checkedAt`
  - expected deployment label or profile identity
  - expected URL/host binding
  - token-file or credential-source use rather than inline token values
  - readiness dependency details for database, artifact store, worker queue/locks, and runtime config
  - worker heartbeat identity and freshness
- Carry parsed HTTP evidence into cutover validation and reject placeholder `{ evidenceRef, checkedAt
}` records that do not prove runtime health.
- Update setup-doctor/runbook cutover evidence checks to report precise HTTP evidence failures.

### 3. External prerequisites

- Existing generated HTTP check commands and output files from the setup/runbook workflow.
- Existing runtime config and credential staging evidence from PR-11 through PR-16.

### 4. Tests to be added

- Add collector tests proving health, readiness, and worker heartbeat JSON files are parsed and
  included as typed cutover evidence.
- Add negative tests for failed HTTP status, stale check time, host/URL mismatch, deployment label
  mismatch, inline token use, missing readiness dependency details, missing worker heartbeat, stale
  worker heartbeat, and placeholder evidence objects.
- Add setup-doctor or cutover runbook tests proving protected/shared cutover blocks on invalid HTTP
  evidence.

### 5. Docs to be added or updated

- Update `docs/control-plane-guide.md` to describe the concrete runtime HTTP evidence fields required
  for cutover.
- Add troubleshooting for stale health checks, readiness dependency failures, worker heartbeat drift,
  URL/host mismatch, and token-file misuse.

### 5.5. Expected regression scope

- `deployment-only` for cutover evidence collection, cutover validation, runbook doctor checks, and
  docs.

### 6. Acceptance criteria

- Cutover validation consumes parsed runtime HTTP check results, not only file paths or placeholder
  evidence refs.
- Protected/shared cutover rejects stale, failed, mismatched, or incomplete health/readiness/heartbeat
  evidence.
- Tests cover both collector and validator negative cases for every required HTTP evidence rule.

### 7. Risks

- Tightening HTTP evidence validation can break existing fixtures that intentionally used placeholder
  health evidence.
- Runtime health payloads may drift if service readiness fields change.

### 8. Mitigations

- Centralize HTTP evidence parsing and validation in typed helper functions.
- Update fixtures to use realistic generated HTTP evidence payloads.
- Produce clear validation errors naming the failed runtime check field.

### 9. Consequences of not implementing this PR

Cutover can appear to validate runtime health while only proving that placeholder files or path refs
exist.

### 10. Downsides for implementing this PR

Cutover evidence fixtures become more detailed and must stay aligned with runtime health/readiness
payload schemas.

## PR-19: EC2 NixOS example reviewed-source modes and guide cleanup

### 1. Intent

Align the generated AWS EC2 NixOS example and guide with both reviewed-source modes, and remove stale
documentation that says instance-profile artifact credentials still need implementation.

### 2. Scope of changes

- Update the AWS EC2 NixOS example renderer so it branches on `reviewedSourceMode`:
  - SSH mode emits SSH private key and known-host credential sources.
  - GitHub App mode emits GitHub App id, installation id, and private-key credential sources.
  - GitHub App mode does not emit stale SSH credential source files.
- Keep the main credential manifest and runtime config source-of-truth aligned with the EC2 example.
- Remove or update stale guide text that says AWS instance-profile artifact-store support still needs
  code work when the implementation already supports it.

### 3. External prerequisites

- Existing reviewed-source mode support from generated runtime input and credential manifests.
- Existing AWS instance-profile artifact credential support.

### 4. Tests to be added

- Add EC2 host profile tests for SSH reviewed-source mode credential source rendering.
- Add EC2 host profile tests for GitHub App reviewed-source mode credential source rendering.
- Add negative tests proving GitHub App mode does not emit SSH credential source entries and SSH mode
  does not emit GitHub App private-key source entries.
- Add docs or guide checks proving stale instance-profile “later work” text is removed.

### 5. Docs to be added or updated

- Update `docs/control-plane-guide.md` so reviewed-source credential examples match SSH versus GitHub
  App mode.
- Remove stale instance-profile artifact-store support caveats or replace them with current
  operational requirements.

### 5.5. Expected regression scope

- `deployment-only` for AWS EC2 host profile example rendering, reviewed-source fixtures, and docs.

### 6. Acceptance criteria

- The generated AWS EC2 NixOS example is correct for both SSH and GitHub App reviewed-source modes.
- GitHub App mode no longer emits SSH credential files in the EC2 example.
- The guide no longer contradicts implemented AWS instance-profile artifact credential support.

### 7. Risks

- The example renderer can drift from the main credential manifest if reviewed-source filenames are
  duplicated.

### 8. Mitigations

- Reuse the same reviewed-source credential constants or helper functions where possible.
- Add mode-specific tests for rendered example files.

### 9. Consequences of not implementing this PR

Operators using GitHub App reviewed-source mode receive an EC2 NixOS example that still stages SSH
credentials, and the guide continues to contain a stale instance-profile caveat.

### 10. Downsides for implementing this PR

The EC2 example renderer gains another mode branch and corresponding tests.
