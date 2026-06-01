# AWS Control Plane Setup Guide

This guide explains how to run the viberoots deployment control plane on AWS while using a
Supabase Postgres database reached from the same AWS VPC path. It is written for operators who are
comfortable following a runbook but may not know the control-plane internals yet.

The short version:

1. Provision Supabase Postgres and enable Supabase PrivateLink for the project.
2. Provision AWS networking, S3, ingress, and a NixOS or OCI host by infrastructure-as-code as much
   as the current repo allows.
3. Publish the Nix-built control-plane image by immutable digest.
4. Generate a runtime bundle with `deployment-control-plane setup --host-mode aws-ec2`.
5. Stage file-backed credentials, start one service and at least two workers, then run the generated
   validation commands.
6. Cut over only after the cutover evidence report passes.

## Important Supabase Networking Note

Supabase does not give this repo a literal shared VPC that we own. The current Supabase private
networking model is Supabase PrivateLink, which shares a VPC Lattice Resource Configuration with
your AWS account. Your AWS VPC then connects to that resource through a PrivateLink endpoint or an
existing VPC Lattice service network.

As of May 28, 2026, Supabase documents these practical limits:

- PrivateLink is beta and available to Team and Enterprise customers.
- Your AWS VPC must be in the same AWS region as the Supabase project.
- PrivateLink is not available in every Supabase region; check the current Supabase regional
  availability notes before selecting the AWS/Supabase region pair.
- PrivateLink is for direct database and PgBouncer connections only. Supabase Auth, Storage, API,
  and Realtime still use public endpoints.
- Supabase dashboard initiation is currently part of the setup flow. Supabase support or an account
  representative may also be needed for read replicas or disabling public database connectivity.
  After Supabase shares the resource, AWS-side RAM acceptance and endpoint wiring can be captured as
  IaC/evidence.

Reference: <https://supabase.com/docs/guides/platform/privatelink>

## Target Architecture

```text
operator or CI
  -> HTTPS control-plane service on AWS
  -> Supabase Postgres over public TLS or Supabase PrivateLink
  -> durable queue, locks, audit rows, deploy records, stage state
  -> control-plane workers on AWS
  -> S3-compatible artifact store, preferably AWS S3 through a VPC endpoint
  -> Infisical and deployment provider APIs
```

The AWS profile should normally run:

- one long-running control-plane service process
- at least two long-running worker processes
- one digest-pinned Nix-built OCI image shared by service and workers
- external Postgres, normally Supabase Postgres
- S3-compatible artifact storage, normally AWS S3 with a VPC endpoint
- file-backed credentials mounted at `/run/deployment-control-plane/credentials`
- HTTPS ingress through an ALB, NLB, Cloudflare front door, or another reviewed ingress path

The control plane remains the deployment authority. AWS, Supabase, S3, PrivateLink, DNS, and TLS are
runtime dependencies and provider-capability evidence, not independent deployment authorities.

## What Is IaC Today

The current repo can already define or generate these pieces:

- Nix-built OCI image: `nix build .#deployment-control-plane-image`
- image publication evidence shape
- runtime config bundle: `deployment-control-plane setup`
- credential manifest
- managed dependency conformance profile
- provider-capability declarations and evidence expectations
- NixOS container module for hosts we control directly
- cutover, rollback, restore, and break-glass evidence checks

The current repo does not yet own full AWS infrastructure provisioning for:

- VPC, subnets, route tables, NAT, security groups, and VPC endpoints
- EC2 instance profile, launch template, AMI selection, and systemd/Podman host realization
- ALB/NLB, ACM certificate, listeners, target groups, DNS, and TLS policy
- RAM share acceptance for Supabase PrivateLink
- VPC Lattice endpoint or service-network association

Use reviewed IaC outside this repo or a manually reviewed cloud-foundation process for those gaps
today. Capture every non-secret output as evidence and feed it into the setup and cutover commands.
The code/design work needed to bring those pieces under repo-owned IaC is listed in
[Control Plane Gaps](./control-plane-gaps.md).

## Prerequisites

You need these accounts and choices before starting:

- AWS account id that Supabase can share the PrivateLink resource with.
- AWS region for the control plane. Choose the same region as the Supabase project.
- Confirmation that Supabase PrivateLink is currently available in the selected project region, or
  confirmation that the control plane will use public TLS until the region is supported.
- Supabase Team or Enterprise project, or confirmation that you will use public TLS until
  PrivateLink is approved.
- Container registry for the control-plane OCI image.
- DNS name for the control-plane service, for example `deploy.example.com`.
- DNS name for the OIDC callback, for example `deploy-auth.example.com`.
- Secret backend for credential files. The current deployment-secret path normally uses Infisical,
  but the runtime host only sees files.
- Reviewed source mode:
  - SSH mode stages `reviewed-source-ssh-key` and `reviewed-source-known-hosts`, or
  - GitHub App mode stages `reviewed-source-github-app-id`,
    `reviewed-source-github-app-installation-id`, and
    `reviewed-source-github-app-private-key`.
- Artifact-store decision:
  - preferred AWS path: AWS S3 bucket plus VPC endpoint
  - alternate reviewed path: Supabase Storage S3 or another S3-compatible store after live
    conformance evidence

## Step 1: Provision Supabase Postgres

Create or select the Supabase project that will hold the control-plane database, then record it in
the generated `supabase-postgres.profile.json`. Separate projects per environment are easier to
reason about than one shared project with schemas.

Record these non-secret values:

- Supabase project ref
- organization id plus structured evidence that the operator can read the selected organization and
  project
- region
- plan class and evidence that the plan supports the selected region, connection mode, backup,
  point-in-time recovery, and retention posture
- database identity label, for example `control-plane-prod-supabase`
- whether the selected path is `public` or `privatelink`
- PrivateLink resource configuration name once Supabase shares it
- PrivateLink endpoint DNS name once AWS creates it
- backup policy evidence and a non-production restore evidence reference
- migration readiness evidence that references the reviewed control-plane schema authority:
  `nixos-shared-host-control-plane-backend-schema`

Store the database URL itself as a secret file value only:

```text
/run/deployment-control-plane/credentials/control-plane-database-url
```

Use the direct Postgres connection string for migrations and conformance checks unless a reviewed
PgBouncer path has been proven for the specific operation. The control plane relies on Postgres
features such as JSONB, `FOR UPDATE SKIP LOCKED`, `INSERT ON CONFLICT`, and `RETURNING`.

Dashboard or support-mediated Supabase steps may be attached as structured evidence, but they do not
count as automated provisioning success and must not become mutation authority. New project creation
remains live-gated and requires explicit organization selection plus cost confirmation.

## Step 2: Enable Supabase PrivateLink

If you are using private database traffic:

1. In the Supabase dashboard, open the project and go to Settings > Integrations.
2. Add the AWS account id under the AWS PrivateLink section.
3. Wait for Supabase to create the VPC Lattice Resource Configuration and send the AWS RAM share.
4. In AWS RAM, accept the resource share in the same region as the Supabase project.
5. Create a security group for the endpoint or service network that allows Postgres TCP 5432 from
   the control-plane service and worker security group.
6. Create either:
   - a PrivateLink endpoint of type `Resources`, or
   - an association from an existing VPC Lattice service network.
7. Enable DNS names where possible so the database URL can use a stable private hostname.
8. Test `psql` from an instance inside the VPC.

Capture evidence:

- Supabase project ref and region
- current Supabase PrivateLink regional availability for that region
- AWS account id
- RAM share id or ARN
- RAM permission evidence proving the selected AWS principal can inspect and accept the share
- resource configuration name
- endpoint id or service-network association id
- VPC Lattice permission evidence proving the selected AWS principal can create and inspect the
  endpoint or service-network association
- private DNS enabled status, hostname, selected VPC, and resolution proof from the selected VPC
- endpoint DNS name or private IPs
- security group id
- TCP 5432 rule proof from the selected service and worker security groups to the endpoint or
  service-network security group
- `psql` success from inside the same VPC
- database URL hostname classification proving the runtime URL uses the private hostname
- public database connectivity status, either disabled after private-path clients pass or retained
  with reviewed justification

Do not treat a support ticket or dashboard screenshot as sufficient by itself. The repo cutover
checks require structured evidence tied to the selected AWS host path.

The split is explicit: Supabase dashboard or support action starts the share, AWS RAM acceptance
proves the share is available to the selected account, AWS VPC Lattice wiring proves the private
network path and private DNS, and the runtime database URL must then select that private hostname.

## Step 3: Provision AWS Infrastructure

Prefer the repo-owned AWS foundation profile for network and artifact-store provisioning. The
generated `aws-network-foundation` and `aws-s3-artifact-store` provider-capability hooks cover
preview, apply, evidence, smoke, and rollback phases and emit redacted IaC payload evidence. Use
import mode only when an organization-owned VPC remains outside this repo; imported evidence must
still satisfy the same schema, freshness, drift, cost, quota, tag, and redaction checks.

The repo-owned profile covers these AWS resources:

- VPC with private subnets in at least two Availability Zones
- route tables and egress policy appropriate for your provider APIs
- security group for the control-plane host or host group
- security group for the Supabase PrivateLink endpoint
- S3 bucket for immutable artifacts
- S3 gateway or interface VPC endpoint
- IAM role for the EC2 host, preferred AWS S3 instance-profile artifact access, and file-backed
  artifact credentials only for reviewed non-AWS S3-compatible backends
- ALB or NLB listener and target group
- ACM certificate and DNS records
- EC2 instance or launch template for the NixOS/OCI host

For the recommended AWS registry path, use the generated
`aws-ecr-control-plane-registry` provider-capability command rather than hand-written ECR notes.
The hook reads `$PROFILE_ROOT/registry-profile.json`,
`$PROFILE_ROOT/image-publication.json`, and `$PROFILE_ROOT/aws-topology-evidence.json`, then emits
`$PROFILE_ROOT/provider-capability-aws-ecr-control-plane-registry.json`. Keep those files with the
setup evidence bundle. The ECR profile must bind repository URI and ARN to the trusted AWS account
and region, include repository policy digest evidence, lifecycle policy posture, scanning posture,
runtime pull evidence, and publish evidence. The hook accepts file-backed AWS credentials or an
explicitly reviewed assume-role or instance-profile path; ambient laptop/default-chain credentials
are rejected.

The ECR hook phases are preview, apply intent, evidence, smoke, and rollback plan. Smoke evidence
proves repository existence, auth/pull reachability for the exact published digest, policy digest,
scanning posture, and image-publication binding without pushing mutable test images. Reviewed import
is allowed only when the imported profile satisfies the same registry contract; imports are refused
for mutable tags, missing repository policy digest, missing lifecycle or scanning posture, missing
runtime pull proof, mismatched account/region, or shared publish/runtime principals. Rollback is
non-destructive by default: retain the repository and immutable image digests, restore reviewed
policy/lifecycle settings, and do not delete production image digests.

For ingress, this implementation uses repo-owned OpenTofu resources rather than provider-hook-only
evidence. The AWS foundation module owns the default ALB/NLB, HTTPS/TLS listener, target group,
target registration inputs, target-group readiness health check, Route53 record, ACM attachment,
security-group rules, and access-control/WAF evidence outputs. Provider hooks wrap those resources
with preview, apply, evidence, smoke, rollback, and import/reconcile evidence. Import/adoption of
existing LB, ACM, DNS, WAF, or edge resources is allowed only with ownership, capability id,
topology identity, fresh drift proof, and non-destructive rollback posture.

For the EC2 host itself, prefer the generated AWS EC2 host profile from
`deployment-control-plane setup --host-mode aws-ec2`. The current repo-owned boundary is a
non-mutating structured EC2 host adapter: it validates the generated instance host profile against
reviewed AWS topology evidence and emits typed preview, apply-intent, evidence, smoke, and rollback
payloads. It does not create or update EC2 instances, launch templates, or Auto Scaling groups in
ordinary runs. Live EC2 realization still comes from reviewed AWS foundation/IaC or an imported
cloud-foundation process, and the adapter proves that the selected host identity, AMI, instance
type, subnets, security groups, instance profile, bootstrap digest, container runtime, and
credential mount wiring match the selected AWS topology evidence and generated host profile before
protected/shared use.

The generated NixOS EC2 example imports the existing control-plane container module with AWS-specific
inputs. The generated systemd/Podman artifacts are a compatibility mode for non-NixOS OCI hosts and
share the same service/worker process and mount contract.

AWS S3 is the generated default artifact-store path. For EC2, prefer
`--artifact-credential-mode aws-instance-profile` with the reviewed IAM role ARN and
least-privilege bucket/prefix policy digest. Supabase Storage S3, Cloudflare R2, and other
S3-compatible stores are explicit alternate profiles; they require reviewed endpoint-shape, signing
region, path-style, metadata, retention, network-path evidence, and file-backed artifact credentials
before setup or cutover.

Before a live-gated apply or protected/shared cutover, keep evidence for encrypted locked IaC state,
clean drift detection, service quota headroom, approved cost estimate, mandatory ownership and
rollback tags, KMS deletion-window posture when KMS is selected, and least-privilege IAM policy
digests. Rollback must retain artifacts and should not delete active endpoints or retained object
prefixes without an explicit reviewed approval.

Operator procedure for `aws-network-foundation`:

1. Preview: run OpenTofu plan from
   `build-tools/deployments/aws-control-plane-foundation/opentofu` with the reviewed variable inputs
   for the account, region, VPC mode, subnet CIDRs or imported VPC id, tags, state bucket, and
   allowed HTTPS egress CIDRs. Save the plan digest and ensure no public subnet is selected as a
   private subnet.
2. Apply: apply only the reviewed plan in the expected account and region using file-backed AWS
   credentials. Save the apply output and the `foundation_evidence` output.
3. Evidence: inspect AWS state for the selected VPC, private subnets, route tables, S3 endpoint,
   security groups, IAM roles, quotas, cost approval, encrypted locked state, and drift status.
   Feed that evidence to hooks with `VBR_AWS_FOUNDATION_INSPECTION_FILE`; live inspection requires
   `VBR_AWS_FOUNDATION_LIVE=1` and a file-backed `AWS_SHARED_CREDENTIALS_FILE`.
4. Smoke: run the provider-capability smoke hook and confirm service and worker hosts resolve AWS
   provider APIs through the reviewed route tables without broad worker egress.
5. Rollback: preserve the state bucket and drift evidence, detach new runtime references, and
   remove only newly-created network resources after retained artifacts and active endpoints have
   a reviewed replacement path.

Operator procedure for `aws-ec2-control-plane-host`:

1. Preview: run the generated provider-capability command with `--preview` and the generated
   `aws-topology-evidence.json` plus `aws-ec2-profile.yaml`. Review the typed payload for the
   selected instance or ASG identity, launch-template id/version when present, AMI pin, instance
   type, private subnet ids, service/worker security groups, instance profile, bootstrap digest,
   container runtime, and credential mount mode.
2. Apply-intent: run the generated apply hook only after EC2 host realization has been completed by
   the reviewed external foundation process. The hook records non-mutating structured evidence that
   the generated profile still matches the realized EC2 identity.
3. Evidence: run the generated record command from `commands.json`; it writes
   `provider-capability-aws-ec2-control-plane-host.json` for setup-doctor and cutover collection.
4. Smoke: after service and workers are running, run the smoke hook and keep its typed payload with
   process, readiness, worker-heartbeat, and rollback posture evidence.
5. Rollback: keep the previous host profile, previous systemd/Podman unit set, worker shutdown
   proof, and non-destructive replacement path. The default hook validates rollback evidence shape;
   it does not destroy EC2 resources.

Operator procedure for `aws-s3-artifact-store`:

1. Preview: review the S3 bucket, KMS key, public-access block, versioning, lifecycle policy,
   immutable prefix, endpoint policy, and IAM policy digests from the same OpenTofu plan. For
   Supabase Storage S3, Cloudflare R2, or another S3-compatible backend, attach reviewed import
   evidence instead of synthetic endpoint claims.
2. Apply: apply the reviewed artifact-store plan or record the reviewed alternate import. Keep the
   bucket or alternate endpoint name out of logs unless it is already classified for operator
   display.
3. Evidence: run PUT/GET/HEAD conformance on a temporary prefix, capture retention and versioning
   posture, endpoint policy digest, replication/import evidence when selected, and exact runtime
   credential source.
4. Smoke: run the `aws-s3-artifact-store` smoke hook and the managed-dependency artifact checks
   from the generated setup bundle.
5. Rollback: stop new writes, keep immutable and retained prefixes, restore the previous runtime
   artifact backend from the last reviewed bundle, and record drift after the switch.

Recommended network rules:

- Ingress to the public load balancer: HTTPS 443 from approved clients or edge network.
- Load balancer to service: TCP 7780 to the service container.
- Workers: no public ingress.
- Service and workers to Supabase PrivateLink endpoint: TCP 5432.
- Service and workers to S3: through the S3 VPC endpoint.
- Service and workers to Infisical/provider APIs: controlled outbound HTTPS.

When `--artifact-credential-mode files` is selected, runtime configuration expects
S3-compatible access key files scoped to the artifact bucket and key prefix. When
`--artifact-credential-mode aws-instance-profile` is selected for AWS S3 on EC2, runtime
configuration omits artifact access-key and secret-key files and uses IMDSv2 credentials from the
reviewed instance profile.

For production, prefer a NixOS host when viberoots directly controls the VM. Non-NixOS hosts are
acceptable only as OCI substrates for the same digest-pinned Nix-built image.

## Step 4: Publish The Reviewed Image

Build the image:

```bash
nix build .#deployment-control-plane-image
nix build .#deployment-control-plane-image-contract
```

Prepare `registry-profile.json` before publication. For AWS EC2, the default path is ECR with
repository immutability, lifecycle policy, image scanning or a reviewed exception, EC2
instance-profile pull permission, separated publish permission, and exact runtime pull proof for the
selected digest. For a non-ECR registry, set the profile mode to `imported` and provide equivalent
reviewed evidence for the same policy and pull-proof fields.

Publish it to your registry and inspect the immutable digest through the reviewed command. The setup
command rejects production AWS profiles without generated registry inspection evidence:

```bash
deployment-control-plane image-publication \
  --registry-profile ./registry-profile.json \
  --image registry.example.com/platform/deployment-control-plane@sha256:<digest> \
  --source-revision source-<reviewed-revision> \
  --image-build-identity nix-source-<build-identity> \
  --published-digest sha256:<digest> \
  --tag source-<reviewed-revision> \
  --out ./image-publication.json
```

Keep these fields together:

- image reference pinned by `@sha256:<digest>`
- reviewed source revision
- Nix image build identity
- publication digest
- inspected registry digest
- human tag used only for traceability

Do not deploy `latest` or any mutable tag as the runtime identity.

## Step 5: Generate The AWS Runtime Bundle

Run a dry run first:

```bash
deployment-control-plane setup \
  --dry-run \
  --out ./cloud-control-profile \
  --host-mode aws-ec2 \
  --image-publication-evidence ./image-publication.json \
  --public-url https://deploy.example.com \
  --auth-callback-host deploy-auth.example.com \
  --deployment-id pleomino-staging \
  --artifact-backend aws-s3 \
  --artifact-credential-mode aws-instance-profile \
  --artifact-bucket deployment-control-plane-artifacts \
  --artifact-region us-east-1 \
  --artifact-iam-role-arn arn:aws:iam::<account-id>:role/<control-plane-artifact-role> \
  --artifact-least-privilege-policy-digest sha256:<policy-digest> \
  --reviewed-source-mode ssh \
  --runtime-input ./runtime-input.yaml \
  --aws-topology-evidence ./aws-topology-evidence.json \
  --ingress-command-evidence ./ingress-dns-evidence.json,./ingress-tls-evidence.json,./ingress-health-evidence.json,./ingress-callback-evidence.json
```

Then rerun without `--dry-run` after every prerequisite is resolved. The
`image-publication.json` file must come from `deployment-control-plane image-publication`, and the
`aws-topology-evidence.json` file must use schema `aws-topology-evidence@1`, and non-dry-run AWS
setup must include the generated ingress command evidence files. Literal `true`, dashboard notes,
raw IaC state, subnet/security-group string lists, and other truthy placeholders do not satisfy AWS
setup validation.

If you are using public TLS instead of Supabase PrivateLink, make the AWS topology evidence database
mode `public`. PrivateLink mode must be `privatelink`.

The bundle contains:

- `config.yaml`
- `credential-manifest.json`
- `auth-provider-profile.json`
- `credential-map.json`
- `residual-action-checklist.json`
- `commands.json`
- `image-publication.json`
- `registry-profile.json` when registry evidence was generated with a reviewed profile
- `aws-topology-evidence.json` for AWS EC2 profiles
- `managed-dependencies.profile.yaml`
- `provider-capabilities.json`
- conformance and ingress checklists
- an AWS EC2 profile artifact

Generated files contain reviewed non-secret runtime metadata, structured evidence references,
credential source mappings, and file paths only. They must not contain database URLs, access keys,
token values, private keys, or Infisical client secrets.

## Step 6: Review Non-Secret Runtime Config

Before starting the service, provide and review the typed runtime input file passed with
`--runtime-input`. Production `config.yaml` is generated from that runtime input and provider/IaC
evidence; do not hand-edit production placeholders into the generated config. The runtime input must
provide reviewed live values for:

- `authProvider.issuer`
- `authProvider.audience`
- `authProvider.jwksUrl`
- `authProvider.claims`
- `authProvider.roleGroups`
- `authProvider.servicePrincipals`
- each `credentials.infisicalDeployments[].siteUrl`
- each `credentials.infisicalDeployments[].projectId`
- each `credentials.infisicalDeployments[].environment`

Production setup rejects default auth and Infisical placeholders such as `https://auth.example.test`
unless an explicit local/fixture mode is selected. Keep these values non-secret and reviewed.
Secret material still belongs only in the credential files from the manifest.

The generated `auth-provider-profile.json` records structured auth-provider import/provision
evidence for local OIDC compatibility mode, Supabase Auth, WorkOS, or another reviewed external OIDC
provider. Supabase Auth and WorkOS remain auth-provider profiles over OIDC/JWKS metadata; provider
dashboards or screenshots are not hidden deployment authority. The profile must tie issuer,
audience, JWKS URL, callback registration, role/group mappings, service principals, environment, and
evidence digest to the selected runtime input.

Ingress validation consumes the current runtime auth-provider callback shape. It checks that
`authProvider.callback.externalHost` and `externalPath` match the AWS listener/routing rule that
sends the callback hostname and path to the selected service target group. Runtime credential
staging uses the generated credential map and records non-secret evidence bound to the current
runtime configuration, manifest, and credential map.

If you intend to disable public Supabase database connectivity after PrivateLink is working, do it
only after the service and workers have passed readiness from the private endpoint and every other
database client has been moved to the private hostname.

## Step 7: Stage Credential Evidence And Run Local Checks

Use the generated staging workflow to validate and record how credentials are staged under:

```text
/run/deployment-control-plane/credentials
```

At minimum, the AWS host credential surface needs:

| Filename                                 | Purpose                                                                 |
| ---------------------------------------- | ----------------------------------------------------------------------- |
| `control-plane-database-url`             | Supabase Postgres URL using the selected public or PrivateLink hostname |
| `control-plane-token`                    | service bearer token for control-plane API checks                       |
| `artifact-store-endpoint`                | S3-compatible endpoint                                                  |
| `artifact-store-access-key-id`           | artifact-store access key id in `files` mode                            |
| `artifact-store-secret-access-key`       | artifact-store secret access key in `files` mode                        |
| `reviewed-source-ssh-key`                | reviewed-source SSH private key, if SSH mode is selected                |
| `reviewed-source-known-hosts`            | reviewed-source SSH known-hosts file, if SSH mode is selected           |
| `{deploymentId}-infisical-client-id`     | deployment-scoped Infisical Universal Auth client id                    |
| `{deploymentId}-infisical-client-secret` | deployment-scoped Infisical Universal Auth client secret                |

If GitHub App mode is selected, replace both SSH files with:

- `reviewed-source-github-app-id`
- `reviewed-source-github-app-installation-id`
- `reviewed-source-github-app-private-key`

When AWS S3 instance-profile mode is selected, do not stage artifact access-key or secret-key files.
The service and workers use IMDSv2 temporary credentials from the reviewed EC2 instance profile, and
managed dependency evidence must include the IAM role ARN plus least-privilege bucket/prefix policy
digest for the reviewed artifact operations.

Secret values must not be placed in Nix options, image layers, command-line arguments, ordinary
environment files, deployment metadata, evidence files, or logs.

Use `credential-map.json` as the staging source of truth. Every file in
`credential-manifest.json` must map to an explicit reviewed secret-backend reference or host
credential source. The map records Infisical project/environment/path import or creation evidence,
deployment-scoped Universal Auth machine identity evidence, least-privilege role/scope evidence,
reviewed-source SSH or GitHub App import evidence, control-plane token generation/import evidence,
database URL import evidence tied to the selected Supabase profile and public/private hostname, and
rotation/stale-credential posture for every manifest entry. Secret names and access policies may be
generated as write plans; secret values must stay only in the reviewed backend. Fixture/default
staging validates and emits evidence only. Live backend writes or host mount checks require both
`VBR_CONTROL_PLANE_LIVE_CREDENTIAL_STAGING=1` and an explicit `--live` command path; neither the
environment variable nor the flag is sufficient alone. Existing externally reviewed proof files may
be attached as proof, but they do not count as deployment-owned backend writes.

The current AWS EC2 compatibility units use host-specific bind-mounted credential-directory wiring
for `/run/deployment-control-plane/credentials`. Do not assume systemd `LoadCredential=` unless the
generated host profile explicitly emits and tests that mode.

Run the local setup checks and staging executor. From the repo root, use:

```bash
deployment-control-plane setup-doctor \
  --bundle-dir ./cloud-control-profile \
  --out ./cloud-control-profile/setup-doctor.json
deployment-control-plane credential-preflight \
  --bundle-dir ./cloud-control-profile \
  --out ./cloud-control-profile/credential-preflight.json
deployment-control-plane credential-staging \
  --bundle-dir ./cloud-control-profile \
  --out ./cloud-control-profile/credential-staging.json
deployment-control-plane credential-rotation \
  --bundle-dir ./cloud-control-profile \
  --apply-rotation \
  --out ./cloud-control-profile/credential-rotation.json \
  --rotated-map-out ./cloud-control-profile/credential-map.rotated.json
```

From inside the generated bundle directory, use:

```bash
deployment-control-plane setup-doctor --bundle-dir . --out ./setup-doctor.json
deployment-control-plane credential-preflight --bundle-dir . --out ./credential-preflight.json
deployment-control-plane credential-staging --bundle-dir . --out ./credential-staging.json
deployment-control-plane credential-rotation \
  --bundle-dir . \
  --apply-rotation \
  --out ./credential-rotation.json \
  --rotated-map-out ./credential-map.rotated.json
```

The generated `commands.json` contains the same ordered runbook with profile-root-relative paths.
Protected/shared setup and cutover remain blocked until `credential-staging.json` is present, fresh,
and tied to the current `credential-manifest.json` and `credential-map.json`.
Live backend writes and host mount verification require
`VBR_CONTROL_PLANE_LIVE_CREDENTIAL_STAGING=1`, `--live`, a reviewed
`--live-backend-profile` file, and `--credential-directory /run/deployment-control-plane/credentials`.
The live backend profile is an operator-owned credential file, not a generated bundle artifact. It
contains the reviewed Infisical site, Universal Auth client credentials, concrete project,
environment, generated-secret path, deployment identity evidence, and a concrete least-privilege
scope payload. That scope must name the exact project, environment, path, allowed generated secret
names, and create/read/update permissions; wildcard names, root paths, or mismatched selectors are
rejected before any write. The generated secret values are created in memory and written directly to
Infisical; the resulting evidence records only project, environment, path, write-plan ids, versions,
and host metadata.

Local live host verification must inspect the actual
`/run/deployment-control-plane/credentials` mount on the target host. This is the preferred path
when the command runs on that host:

```bash
VBR_CONTROL_PLANE_LIVE_CREDENTIAL_STAGING=1 deployment-control-plane credential-staging \
  --live \
  --bundle-dir . \
  --live-backend-profile ./live-infisical-backend.profile.json \
  --credential-directory /run/deployment-control-plane/credentials \
  --out ./credential-staging.live.json
```

For remote hosts, use a deployment-owned `--live-host-verification-evidence` result from the
reviewed host verifier instead of pointing the local command at a copied or temporary directory.
The remote verifier profile must include the reviewed verifier identity, reviewed public key
signature or deployment-owned verifier command attestation, canonical evidence payload digest,
source host, target credential directory, credential filename set, and AWS bind-mount wiring proof:
The trust root itself is a separate reviewed input; do not embed it in the verifier result.

```bash
VBR_CONTROL_PLANE_LIVE_CREDENTIAL_STAGING=1 deployment-control-plane credential-staging \
  --live \
  --bundle-dir . \
  --live-backend-profile ./live-infisical-backend.profile.json \
  --live-host-verification-evidence ./live-host-verification.remote.json \
  --live-host-verifier-profile ./live-host-verifier.profile.json \
  --live-host-verifier-trust-profile ./live-host-verifier.trust.json \
  --out ./credential-staging.live.json
```

Use `--secret-backend-evidence` or `--host-mount-evidence` only to attach externally reviewed proof.
Those files remain proof inputs and cannot masquerade as deployment-owned live execution evidence.
They must not coexist with `deploymentOwnedLiveBackendWrite` in persisted staging evidence.

## Step 8: Run Managed Dependency Validation

Use the generated profile and the same credential directory the service uses:

```bash
deployment-control-plane managed-dependencies \
  --profile ./cloud-control-profile/managed-dependencies.profile.yaml \
  --credential-directory /run/deployment-control-plane/credentials \
  --host-profile aws-ec2 \
  --aws-region us-east-1 \
  --source-host-identity i-0abc1234 \
  --source-host-kind aws-ec2
```

This validates:

- required Postgres features
- object-store `PUT`, `GET`, `HEAD`, metadata, content type, and digest checks
- non-secret observed runtime-path evidence: host profile, AWS region, source host identity and
  kind, selected database connectivity mode, resolved database host, TLS status, Supabase project
  and region labels when supplied, S3 VPC endpoint proof for AWS S3, and structured
  alternate-backend evidence for non-AWS S3-compatible stores

If the Supabase path is PrivateLink, run the validation from the AWS host or an instance in the same
VPC path. PrivateLink cutover evidence must tie the proof to the AWS EC2 runtime path and a private
database endpoint. A laptop or CI runner proof is accepted only when the profile marks it as
non-cutover diagnostic evidence.

Before this step is considered ready for cutover evidence, confirm the generated host realization
artifacts are active on the selected EC2 host: NixOS EC2 wrapper or generated systemd units,
selected private subnet placement, reviewed instance profile, encrypted EBS/state path, registry
pull proof for the exact image digest, worker lease/fencing evidence, and operational visibility
for service down, readiness failure, missing worker heartbeat, queue backlog, and repeated worker
crash.

## Step 9: Start Service And Workers

Before starting processes, run the generated Supabase lifecycle evidence command from
`commands.json`. It uses the reviewed provider-capability hook path and writes
`$PROFILE_ROOT/supabase-managed-postgres-evidence.json` from
`$PROFILE_ROOT/supabase-postgres.profile.json`; operators should not hand-assemble hook payloads.
The emitted evidence binds the selected Supabase project, organization, region, connection mode,
plan capability, migration/schema metadata, backup/restore posture, and user separation policy.

Use the generated AWS profile or equivalent host configuration to start:

```bash
deployment-control-plane service --config /etc/deployment-control-plane/config.yaml
deployment-control-plane worker --config /etc/deployment-control-plane/config.yaml --worker-id worker-1
deployment-control-plane worker --config /etc/deployment-control-plane/config.yaml --worker-id worker-2
```

The recommended production minimum is one service and two workers. Workers coordinate through
database queue claims, leases, provider locks, and fencing tokens. Worker-local files are scratch
only.

Service probes:

- `GET /healthz` checks process liveness and image metadata.
- `GET /readyz` checks database connectivity, artifact-store metadata-read connectivity, worker
  queue/lock tables, and worker heartbeat visibility.
- `GET /api/v1/worker-heartbeats` reports authenticated worker heartbeat summaries.

## Step 10: Run Runtime And AWS Evidence Checks

From the ordered phases in `commands.json`, run:

- Supabase managed Postgres lifecycle evidence
- database validation
- artifact-store validation
- health check
- readiness check
- worker-heartbeat check

The generated HTTP checks use the configured public URL and write typed runtime HTTP evidence files:

- `http-health.json`
- `http-readiness.json`
- `http-worker-heartbeats.json`

Each file is a `cloud-control-runtime-http-evidence@1` envelope with `checkedAt`, `url`, `host`,
`expected.publicUrl`, `expected.hostProfile`, `expected.profileIdentity`,
`expected.deploymentIds`, `expected.workerCount`, `credentialSource`, `status.httpStatus`,
`status.ok`, and the parsed response `body`. Authenticated worker-heartbeat evidence must record a
token-file credential source such as `control-plane-token`; it must not contain bearer token values,
raw authorization headers, or copied credential contents.
Cutover validation compares `expected.deploymentIds` and `expected.workerCount` to generated
`config.yaml` runtime configuration, not to HTTP envelope or top-level cutover fields.

Readiness evidence must include passing dependency details for:

- `database`
- `artifactStore`
- `workerQueueLocks`
- `runtimeConfig`

Worker-heartbeat evidence must include at least the expected worker count, each worker id, matching
profile identity, `running` status, and fresh `lastSeenAt` timestamps.

Setup readiness and cutover consume the freshness-gated
`supabase-managed-postgres-evidence@1` lifecycle envelope. A stale bare
`supabase-postgres.profile.json`, dashboard-only note, or self-attested profile export is not
accepted as lifecycle proof.

For AWS EC2 readiness, also attach evidence for:

- `aws-topology-evidence@1` identity: AWS account id, region, checked-at timestamp, selected VPC,
  VPC DNS support, private subnets, route tables, and NAT or controlled-egress posture
- service, worker, load-balancer, S3 endpoint, and PrivateLink security groups tied to the selected
  VPC
- S3 gateway or interface endpoint id, route-table associations, endpoint policy digest, and
  selected bucket/prefix
- EC2 instance or Auto Scaling group identity, launch template, AMI, instance profile, and service
  and worker process evidence
- ALB/NLB public reachability, listener, target group, target registration, readiness health-check
  configuration, health result, certificate lifecycle, TLS policy, DNS record, callback route, and
  security-group/port path
- Supabase path: `public` with TLS-validated `psql` proof, or `privatelink` with project/region,
  regional availability, RAM acceptance and permission evidence, VPC Lattice endpoint or
  service-network association plus permission evidence, private DNS, TCP 5432 security-group rule,
  endpoint DNS/IPs, public-connectivity status, database URL hostname classification, and `psql`
  proof
- image digest and runtime config digest
- graceful worker shutdown evidence

Ingress evidence fails closed unless the selected public hostname resolves from a public vantage
point to the selected ALB/NLB or a reviewed edge linked back to that AWS ingress identity. The
service host must not have direct public ingress; LB/client sources may reach only the selected
service security group and target port. Plain HTTP is rejected except for reviewed HTTP-to-HTTPS
redirects, and service plus callback traffic must not complete over plaintext. The reviewed AWS TLS
policy allow-list is `ELBSecurityPolicy-TLS13-1-2-2021-06` and
`ELBSecurityPolicy-TLS13-1-2-Res-2021-06`.

ACM evidence must prove issued status, account/region match, listener attachment, validity window,
validation ownership, renewal posture, SAN coverage, wildcard semantics, and DNS validation when
used. Target registration and target health must bind to the selected EC2 host-profile evidence:
instance, service unit/process, image digest, config digest, and service port.

When PrivateLink is selected, the runtime database evidence must prove the service and workers are
using the PrivateLink endpoint, not the public Supabase hostname.

## Step 11: Cut Over

Before moving protected/shared traffic, run the generated cutover evidence collector from
`commands.json`. It reads the profile bundle, provider-capability hook outputs, runtime health
checks, standby evidence, and managed dependency evidence, then writes
`cloud-cutover-evidence.json`:
It also requires `latest-non-production-deployment.json` from a real protected/shared staging
deployment through the AWS-primary path; staging success is not inferred by the collector.

```bash
deployment-control-plane cutover-evidence \
  --bundle-dir ./cloud-control-profile \
  --out ./cloud-control-profile/cloud-cutover-evidence.json
```

Then validate the generated report:

```bash
deployment-control-plane cutover \
  --evidence ./cloud-control-profile/cloud-cutover-evidence.json \
  --expected-host-profile aws-ec2 \
  --expected-image-build-identity nix-source-<build-identity> \
  --expected-region us-east-1 \
  --selected-capability aws-ec2-control-plane-host,aws-network-foundation,aws-s3-artifact-store \
  --out ./cloud-control-profile/cloud-cutover-report.json
```

The report must pass before the AWS host becomes protected/shared-ready. Keep mini or the previous
host in a reviewed standby mode until rollback evidence is fresh.

Cutover rejects literal `true`, empty objects, dashboard-only notes, raw IaC state, stale
timestamps, unsupported database modes, malformed operation evidence refs, mismatched operation
digests, and evidence containing obvious secret material. Support or dashboard-mediated steps must
be represented as structured prerequisite evidence tied to the selected provider-capability id; they
do not satisfy protected/shared readiness by themselves.

## Troubleshooting

- Database validation fails: confirm the URL file points at the intended Supabase project, the
  selected hostname is reachable from the AWS host, and the Postgres user has the required rights.
- PrivateLink DNS fails: confirm AWS RAM share acceptance and permissions, VPC Lattice endpoint or
  service-network association permissions, private DNS enabled status, VPC DNS support, subnet
  selection, and security group TCP 5432 proof.
- Readiness fails but health passes: check database, artifact-store credentials, and worker
  heartbeat rows. `/healthz` does not prove dependencies are usable.
- Worker heartbeat missing: confirm at least two worker processes use the same config file,
  database URL, artifact store, and image digest as the service.
- Stale runtime HTTP evidence: rerun the generated `health`, `readiness`, and `worker-heartbeats`
  commands from `commands.json` immediately before cutover.
- URL or host mismatch: regenerate the setup bundle or fix `--public-url`; cutover requires the
  evidence URL host to match `config.yaml` and the selected public ingress.
- Readiness dependency failure: inspect `/readyz` for the failing `database`, `artifactStore`,
  `workerQueueLocks`, or `runtimeConfig` entry before collecting cutover evidence again.
- Worker heartbeat drift: confirm all expected worker units are running on the selected profile and
  writing fresh heartbeats with matching instance/profile identity.
- Token-file misuse: rerun the generated worker-heartbeat command so evidence records
  `credentialSource.kind: token_file` without inline bearer token material.
- S3 check fails: confirm bucket, endpoint, signing region, IAM role or access key, endpoint policy,
  and key prefix.
- Missing credential failure: compare host files against `credential-manifest.json`. Do not repair
  by switching to environment variables.
- Stale credential failure: rerun `deployment-control-plane credential-staging` and, when stale
  entries remain active, run `deployment-control-plane credential-rotation --apply-rotation
--rotated-map-out ./credential-map.rotated.json` after refreshing the reviewed backend or
  encrypted host source.
- Backend write failure: confirm the selected backend profile, least-privilege scope evidence,
  concrete Infisical project, environment, generated-secret path, deployment identity evidence,
  generated write-plan ids, and reviewed source-provider access for SSH or GitHub App credentials.
- Host mount permission mismatch: confirm the filename set, uid/gid `10001`, mode `0400`, and
  mount target `/run/deployment-control-plane/credentials`; do not switch to `LoadCredential=`
  unless the generated host profile explicitly implements and tests that path.
- Remote host verifier signature failure: regenerate the remote verifier result and trust profile
  from the reviewed verifier key, or run the local verifier on the host that owns the generated AWS
  bind-mounted credential directory.
- Remote verifier identity mismatch: confirm the verifier identity in the trust profile matches the
  remote evidence and the reviewed operator material for this host.
- Stale remote verifier provenance: refresh the verifier profile before the expiry window, and make
  sure it still binds the same source host, target directory, filename set, and AWS bind-mount proof.
- Mixed credential proof/write artifact: rerun live credential staging without
  `--secret-backend-evidence`, or keep external proof in the proof-only staging path. Do not merge
  `externalReviewedBackendProof` with `deploymentOwnedLiveBackendWrite`.
- Cutover evidence rejected: replace dashboard-only notes with structured evidence tied to the same
  AWS instances, image digest, config digest, selected database path, and selected artifact path.
- EC2 provider evidence rejected: rerun the generated `aws-ec2-control-plane-host` command with the
  current `aws-topology-evidence.json` and `aws-ec2-profile.yaml`; check instance or launch-template
  identity, instance type, AMI pin, private subnet ids, service/worker security groups, instance
  profile ARN, bootstrap digest, container runtime, and credential mount mode.
- Launch-template or bootstrap drift: refresh the reviewed AWS topology evidence from the realized
  host, then regenerate the setup bundle if the launch-template version, AMI, user-data digest, or
  systemd/Podman artifact set intentionally changed.
- EC2 rollback evidence rejected: attach the previous host profile, previous unit set, worker
  shutdown proof, and non-destructive replacement evidence before attempting protected/shared
  cutover.

## Operator Checklist

- [ ] Supabase project exists in the same region as the AWS VPC.
- [ ] Supabase PrivateLink regional availability is confirmed for that region, or public TLS is
      explicitly selected.
- [ ] Supabase Postgres database URL is staged only as a credential file.
- [ ] PrivateLink is either complete and proven from the VPC, or public TLS is explicitly selected.
- [ ] AWS VPC, subnets, security groups, ingress, S3, and endpoints are provisioned by reviewed IaC
      or captured as a documented current-code gap.
- [ ] Control-plane image is Nix-built and deployed by immutable registry digest.
- [ ] `deployment-control-plane setup --host-mode aws-ec2` bundle is generated without secrets.
- [ ] `config.yaml` auth-provider and Infisical metadata are generated from reviewed runtime input
      and provider evidence.
- [ ] Credential files match `credential-manifest.json`.
- [ ] `credential-staging.json` is fresh and matches the current credential manifest and map.
- [ ] One service and at least two workers are running.
- [ ] Managed dependency validation passes from the AWS runtime path.
- [ ] Health, readiness, and worker-heartbeat checks pass.
- [ ] Provider-capability evidence is attached.
- [ ] Cutover report passes before protected/shared traffic moves.
