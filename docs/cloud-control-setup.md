# Cloud Control Plane Setup

Use the setup command to generate a reviewed host-profile bundle before placing the deployment
control plane on a cloud substrate:

```bash
deployment-control-plane setup \
  --out ./cloud-control-profile \
  --host-mode aws-ec2 \
  --image registry.example.com/platform/deployment-control-plane@sha256:<64-hex-digest> \
  --public-url https://deploy.example.test \
  --deployment-id pleomino-staging \
  --auth-callback-host deploy-auth.example.test \
  --artifact-backend aws-s3 \
  --artifact-bucket deployment-control-plane-artifacts \
  --artifact-region us-east-1 \
  --reviewed-source-mode ssh \
  --aws-vpc-endpoint \
  --aws-subnet-id subnet-123,subnet-456 \
  --aws-security-group-id sg-123 \
  --tls-evidence alb-listener-dns-reviewed
```

Run `--dry-run` first to report missing prerequisites and next commands without writing files.

The generated bundle contains:

- `config.yaml`: production-shaped runtime config with mounted file paths.
- `credential-manifest.json`: required credential filenames and rejected secret sources.
- `commands.json`: service, worker, health, readiness, worker-heartbeat, artifact, and database
  validation commands.
- `conformance-checklist.json`: exact checks that must pass before protected/shared readiness.
- `managed-dependencies.profile.yaml`: concrete input for the managed Postgres and artifact-store
  conformance validator.
- `managed-dependencies.json` and `ingress-checklist.json`: non-secret evidence checklist data.
- `provider-capabilities.json`: declarations for selected cloud topology components.
- mode-specific runnable profile files for Compose/Podman, NixOS, SaaS OCI, or AWS EC2. SaaS OCI
  and AWS EC2 profiles are structured YAML with one service, two workers, digest-pinned image,
  config and credential mounts, and scratch/state/cache mounts.
  Compose/Podman profiles also set the runtime user to uid/gid `10001` and list the scratch,
  artifact, and record paths that must be owned by that identity.

Generated files use placeholders and paths, not secret values. Stage real credentials only as files
under `/run/deployment-control-plane/credentials`.

## End-To-End Quickstart

1. Provision managed Postgres and record the reviewed database URL as the file
   `/run/deployment-control-plane/credentials/control-plane-database-url`.
2. Provision an S3-compatible artifact store and write endpoint, access key id, and secret access
   key to the filenames in `credential-manifest.json`.
3. Publish the reviewed Nix-built image and use only the immutable
   `registry/repository@sha256:<digest>` reference.
4. Generate the bundle with `deployment-control-plane setup --dry-run`, resolve every reported
   prerequisite, then rerun without `--dry-run`.
5. Stage `config.yaml`, `managed-dependencies.profile.yaml`, provider-capability evidence, the
   reviewed-source credential files, and deployment-scoped Infisical credential files on the host.
   Generated Compose/Podman, NixOS, SaaS OCI, and AWS EC2 profiles include one service, two
   workers, config and credential mounts, digest-pinned image references, and scratch/state/cache
   paths owned by the runtime uid/gid.
6. Run `commands.validations.database.command` and `commands.validations.artifactStore.command`.
   Both checks must pass against temporary schema/data or temporary object prefixes.
7. Start one service process and at least two worker processes from `commands.json`.
8. Run `commands.validations.health.command`, `commands.validations.readiness.command`, and
   `commands.validations.workerHeartbeats.command`.
9. Treat the host as protected/shared-ready only after every entry in
   `conformance-checklist.json` passes and the evidence is attached to the selected provider
   capabilities.

## Reviewed Source Modes

The setup bundle defaults to SSH reviewed source and emits only:

- `reviewed-source-ssh-key`
- `reviewed-source-known-hosts`

Use `--reviewed-source-mode github-app` when the reviewed repository should be fetched through a
GitHub App installation. The generated runtime config then emits only:

- `reviewed-source-github-app-id`
- `reviewed-source-github-app-installation-id`
- `reviewed-source-github-app-private-key`

Both modes are fully file-backed. Do not replace these files with `GITHUB_TOKEN`,
`GITHUB_APP_PRIVATE_KEY`, `GIT_SSH_COMMAND`, or other production environment variables.

The optional live GitHub App fetch smoke is skipped by default. Enable it only against a reviewed
non-production installation:

```text
VBR_REVIEWED_SOURCE_GITHUB_APP_LIVE=1
VBR_REVIEWED_SOURCE_GITHUB_REPOSITORY=owner/repo
VBR_REVIEWED_SOURCE_GITHUB_APP_ID_FILE=/run/deployment-control-plane/credentials/reviewed-source-github-app-id
VBR_REVIEWED_SOURCE_GITHUB_APP_INSTALLATION_ID_FILE=/run/deployment-control-plane/credentials/reviewed-source-github-app-installation-id
VBR_REVIEWED_SOURCE_GITHUB_APP_PRIVATE_KEY_FILE=/run/deployment-control-plane/credentials/reviewed-source-github-app-private-key
```

## Fixture E2E Validation

The default container E2E runs locally with fixture-only dependencies: one service process, two
worker processes, fixture Postgres, and a fixture S3-compatible object server. It submits a
cloud-control fixture deployment, corrupts one stored artifact to prove materialization fails
closed, then runs a successful duplicate submission through admission revalidation, queue claiming,
lease/worker authority, provider locking, artifact upload and materialization, stage-state updates,
audit records, UI reads, and MCP reads. The fixture intentionally uses
`cloud-control-fixture-staging-s3` so the check does not depend on Pleomino or another demo project.

Live smoke stays opt-in. Set `VBR_CONTROL_PLANE_LIVE_SMOKE=1` only for a non-production target and
provide `VBR_CONTROL_PLANE_LIVE_SERVICE_URL`, `VBR_CONTROL_PLANE_LIVE_TOKEN_FILE`,
`VBR_CONTROL_PLANE_LIVE_DATABASE_URL_FILE`, artifact-store credential files, artifact bucket and
region, `VBR_CONTROL_PLANE_LIVE_AUTH_PROVIDER`, and
`VBR_CONTROL_PLANE_LIVE_DEPLOYMENT_STAGE=staging` or `shared_nonprod`.
The enabled path also requires `VBR_CONTROL_PLANE_LIVE_STAGING_DEPLOY_SMOKE_COMMAND`,
`VBR_CONTROL_PLANE_LIVE_PROVIDER_CAPABILITIES_FILE`, and
`VBR_CONTROL_PLANE_LIVE_PROVIDER_CAPABILITY_EVIDENCE_FILE`; the staging command runs only after
health, readiness, worker-heartbeat, database, artifact-store, provider-capability evidence, and
auth-provider checks pass. When `VBR_CONTROL_PLANE_LIVE_AWS_TOPOLOGY=1`, the AWS topology checks
are also conformance checks and must pass before the staging deploy command runs. Auth validation is
provider-specific: WorkOS requires a WorkOS JWKS URL, Supabase Auth requires health and JWKS URLs,
and generic OIDC requires a discovery URL whose `jwks_uri` is fetched. AWS EC2 topology smoke must
additionally attach JSON evidence files for subnets, security groups, S3 endpoint, and DNS/TLS; use
HTTPS ingress for health, readiness, and worker-heartbeat checks; and provide structured runtime
evidence files through `VBR_CONTROL_PLANE_LIVE_AWS_RUNTIME_DB_EVIDENCE_FILE` and
`VBR_CONTROL_PLANE_LIVE_AWS_RUNTIME_S3_EVIDENCE_FILE`, plus
`VBR_CONTROL_PLANE_LIVE_AWS_WORKER_SHUTDOWN_EVIDENCE_FILE`. The runtime evidence must identify the
EC2 instance source, service process, worker process, service image digest, worker image digest,
runtime config digest, the configured Supabase path from
`VBR_CONTROL_PLANE_LIVE_AWS_SUPABASE_PATH` (`public` or `privatelink`), the configured S3 endpoint
path from `VBR_CONTROL_PLANE_LIVE_AWS_S3_ENDPOINT_PATH` (`gateway` or `interface`), and successful
DB/S3 checks tied to those same service/worker process IDs. Shutdown evidence must show the same
worker process stopped gracefully and disappeared from worker state after shutdown. Subnet and
security-group evidence must list the same EC2 instance IDs that produced the service/worker runtime
evidence. Provider-capability evidence must attach the runtime DB, runtime S3, and worker-shutdown
evidence files or their SHA-256 digests to the selected AWS runtime capability, normally
`aws-ec2-control-plane-host`; attaching those refs only to an unrelated capability is not enough.
Shell snippets such as `true`, operator laptop output, CI output, and opaque support-ticket
references are not valid runtime evidence. Evidence kept only in provider dashboards, support
tickets, or IaC output is not enough to claim protected/shared readiness.

### E2E Troubleshooting

- Service health failure: check that the service process is using the digest-pinned image, mounted
  `config.yaml`, and `control-plane-token` file from the generated credential manifest. Restart only
  after replacing missing files; do not substitute environment variables for production secrets.
- Readiness failure: run the database and artifact-store validation commands from `commands.json`.
  Database failures usually mean the Postgres URL file points at the wrong project, lacks required
  SQL features, or is blocked by network policy. Artifact failures usually mean the endpoint, bucket,
  signing region, key prefix, or credential files do not match the selected S3-compatible backend.
- Worker heartbeat failure: confirm at least two worker processes are running from the same image and
  config as the service, then check worker logs for claim lease renewal, provider-lock, credential,
  or graceful-shutdown errors. A stale worker must lose authority after lease expiry; do not extend
  leases to hide stuck workers.
- Duplicate-worker or stale-worker assertion failure: inspect queue rows and claim tokens for the
  submission. Only one worker may hold a non-expired claim token, and any replaced worker must fail
  subsequent authority checks before writing provider state or final records.
- Missing-secret negative failure: confirm required credential filenames match
  `credential-manifest.json`. The service and workers should fail closed and name the missing file
  without printing database URLs, access keys, tokens, or private key material.
- Artifact tamper failure: verify workers read artifacts only through the configured object store and
  compare stored digest/provenance metadata before execution. Do not repair this by falling back to
  local artifact directories.
- UI or MCP redaction failure: treat the response as unsafe until the redaction helper is fixed.
  Read APIs, UI rendering, MCP tools, and audit records must not expose credential values, private
  keys, database URLs, mutation endpoints, or submit/approval controls.
- Live-smoke failure: keep the target non-production, preserve the failing evidence bundle, and rerun
  only the failed class after fixing credentials, topology, DNS/TLS, auth-provider, database, S3, or
  worker-shutdown evidence. If AWS topology is enabled, confirm the EC2 runtime DB and S3 evidence
  includes instance metadata, selected-path fields, image/config digests, process IDs, and operation
  success from the service/worker network path rather than from the operator laptop or CI runner.
  Confirm shutdown evidence is a post-shutdown worker-state assertion for the same worker process,
  not a shell command. Confirm provider-capability evidence references those exact runtime evidence
  artifacts by file or digest, and confirm subnet/security-group evidence names the EC2 instance IDs
  in the runtime proof. Do not point live smoke at protected/prod deployments.

## AWS EC2 Topology

The recommended AWS profile runs one long-running service process and at least two long-running
worker processes on EC2. Supabase Postgres may be reached through public TLS or Supabase PrivateLink
when the prerequisite evidence exists. AWS S3 through a VPC endpoint is the default artifact store
for this topology; Supabase Storage S3 and other S3-compatible stores are reviewed alternates only.

AWS profiles must record subnet, security-group, TLS/ALB-or-NLB, DNS, and artifact-store evidence
before they can be marked protected/shared-ready.

For reviewed alternate artifact stores on AWS EC2, select `--artifact-backend
supabase-storage-s3` or `--artifact-backend s3-compatible` and include
`--artifact-backend-evidence <reviewed-evidence-id>`. Alternate profiles are rejected without that
evidence. The default `aws-s3` backend still requires `--aws-vpc-endpoint`.

## AWS EC2 Quickstart

1. Create or select the AWS VPC, private subnets, security groups, S3 gateway or interface endpoint,
   ALB/NLB listener, TLS certificate, and DNS records through reviewed IaC.
2. Provision Supabase Postgres. If private database traffic is selected, complete Supabase
   PrivateLink setup and record the endpoint evidence before generating the final profile.
3. Create the AWS S3 artifact bucket, lifecycle policy, endpoint policy, and IAM role used by the
   EC2 control-plane host. The generated AWS profile treats AWS S3 through the VPC endpoint as the
   default artifact path.
4. Generate the profile with `--host-mode aws-ec2 --artifact-backend aws-s3 --aws-vpc-endpoint`
   and include `--supabase-privatelink` when PrivateLink evidence exists. For a reviewed alternate
   artifact store, use `--artifact-backend supabase-storage-s3 --artifact-backend-evidence
<reviewed-evidence-id>` instead of relying on the default AWS S3 artifact path.
5. Mount the Supabase Postgres URL, AWS S3 endpoint and credential files, service token,
   reviewed-source credential files, and Infisical deployment credential files through the generated
   credential manifest.
6. Start the systemd/Podman service and worker units on EC2.
7. Run the database, artifact-store, health, readiness, and worker-heartbeat commands from
   `commands.json`. The profile is not protected/shared-ready until those pass and the AWS network,
   EC2 host, S3 artifact store, and Supabase prerequisite capabilities all have audit evidence.
   Live smoke for this topology must also attach EC2-runtime evidence that proves the same
   digest-pinned service/worker image and runtime config use the selected public or PrivateLink
   Postgres path and selected S3 endpoint path before any staging deploy smoke is accepted.
8. Before moving traffic, run the cutover validator described in
   [Cloud Control Cutover](/Users/kiltyj/Code/viberoots/docs/cloud-control-cutover.md). The
   validator must see fresh host-matched evidence, selected provider-capability audit evidence,
   standby controls, restore checks, and rollback checks. Keep live staging smoke explicitly gated
   and non-production until this report passes.

## Provider Capabilities

Every generated provider-capability declaration must name target identity, credential source, lock
scope, preview/diff behavior, mutation sequence, smoke checks, rollback procedure, replay semantics,
audit evidence, and protected/shared eligibility. Provider CLIs or IaC apply commands are allowed
only through the control-plane admission, locking, credential, audit, and rollback model.

Provider dashboards, raw IaC state, and manual support actions are evidence inputs, not hidden
deployment authority. Support-mediated setup, such as parts of Supabase PrivateLink, is recorded as
a gated prerequisite with evidence.

## Reviewed Source

`--reviewed-source-mode ssh` generates the SSH file contract. Stage `reviewed-source-ssh-key` and
`reviewed-source-known-hosts` in the generated credential directory.

`--reviewed-source-mode github-app` generates the GitHub App file contract now supported by the
runtime parser and reviewed-source fetch adapter. Stage `reviewed-source-github-app-id`,
`reviewed-source-github-app-installation-id`, and `reviewed-source-github-app-private-key` in the
generated credential directory. The runtime exchanges those mounted files for a short-lived
installation token during reviewed-source fetches.

The two modes are mutually exclusive in generated config and runtime validation. Neither mode may
rely on laptop or CI credentials for protected/shared deploys.

## Non-Default Substrates

Fargate, Vercel Functions, Supabase Edge Functions, and Cloudflare Workers are not default
substrates for the long-running deployment service or workers because they do not provide the
reviewed long-running worker, mounted credential-file, scratch-state, shutdown, and authority
boundaries required by the control plane. Vercel output remains limited to operator UI/API guidance,
and Cloudflare output remains limited to DNS, TLS/WAF, rate limiting, and reviewed edge settings.
