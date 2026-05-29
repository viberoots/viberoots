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
  - SSH key and known-hosts file, or
  - GitHub App id, installation id, and private key.
- Artifact-store decision:
  - preferred AWS path: AWS S3 bucket plus VPC endpoint
  - alternate reviewed path: Supabase Storage S3 or another S3-compatible store after live
    conformance evidence

## Step 1: Provision Supabase Postgres

Create or select the Supabase project that will hold the control-plane database. Separate projects
per environment are easier to reason about than one shared project with schemas.

Record these non-secret values:

- Supabase project ref
- region
- database identity label, for example `control-plane-prod-supabase`
- whether the selected path is `public` or `privatelink`
- PrivateLink resource configuration name once Supabase shares it
- PrivateLink endpoint DNS name once AWS creates it

Store the database URL itself as a secret file value only:

```text
/run/deployment-control-plane/credentials/control-plane-database-url
```

Use the direct Postgres connection string for migrations and conformance checks unless a reviewed
PgBouncer path has been proven for the specific operation. The control plane relies on Postgres
features such as JSONB, `FOR UPDATE SKIP LOCKED`, `INSERT ON CONFLICT`, and `RETURNING`.

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
- resource configuration name
- endpoint id or service-network association id
- endpoint DNS name or private IPs
- security group id
- `psql` success from inside the same VPC

Do not treat a support ticket or dashboard screenshot as sufficient by itself. The repo cutover
checks require structured evidence tied to the selected AWS host path.

## Step 3: Provision AWS Infrastructure

Use IaC for these AWS resources where your current cloud-foundation workflow supports it:

- VPC with private subnets in at least two Availability Zones
- route tables and egress policy appropriate for your provider APIs
- security group for the control-plane host or host group
- security group for the Supabase PrivateLink endpoint
- S3 bucket for immutable artifacts
- S3 gateway or interface VPC endpoint
- IAM role for the EC2 host and, with current code, narrow S3-compatible credential files for the
  control-plane artifact store
- ALB or NLB listener and target group
- ACM certificate and DNS records
- EC2 instance or launch template for the NixOS/OCI host

Recommended network rules:

- Ingress to the public load balancer: HTTPS 443 from approved clients or edge network.
- Load balancer to service: TCP 7780 to the service container.
- Workers: no public ingress.
- Service and workers to Supabase PrivateLink endpoint: TCP 5432.
- Service and workers to S3: through the S3 VPC endpoint.
- Service and workers to Infisical/provider APIs: controlled outbound HTTPS.

Current runtime configuration still expects S3-compatible access key files for the artifact store.
Use credentials scoped to the artifact bucket and key prefix. Pure EC2 instance-profile/IAM-role
artifact access is a best-practice improvement, but it needs the code work captured in
[Control Plane Gaps](./control-plane-gaps.md).

For production, prefer a NixOS host when viberoots directly controls the VM. Non-NixOS hosts are
acceptable only as OCI substrates for the same digest-pinned Nix-built image.

## Step 4: Publish The Reviewed Image

Build the image:

```bash
nix build .#deployment-control-plane-image
nix build .#deployment-control-plane-image-contract
```

Publish it to your registry and inspect the immutable digest. The setup command rejects production
profiles without registry inspection evidence. Keep these fields together:

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
  --image registry.example.com/platform/deployment-control-plane@sha256:<digest> \
  --expected-image-build-identity nix-source-<build-identity> \
  --image-source-revision source-<reviewed-revision> \
  --image-build-identity nix-source-<build-identity> \
  --image-publication-digest sha256:<digest> \
  --image-inspected-digest sha256:<digest> \
  --public-url https://deploy.example.com \
  --auth-callback-host deploy-auth.example.com \
  --deployment-id pleomino-staging \
  --artifact-backend aws-s3 \
  --artifact-bucket deployment-control-plane-artifacts \
  --artifact-region us-east-1 \
  --reviewed-source-mode ssh \
  --aws-vpc-endpoint \
  --aws-subnet-id subnet-aaa,subnet-bbb \
  --aws-security-group-id sg-control-plane \
  --tls-evidence alb-listener-dns-reviewed \
  --supabase-privatelink
```

Then rerun without `--dry-run` after every prerequisite is resolved.

If you are using public TLS instead of Supabase PrivateLink, omit `--supabase-privatelink` and make
the database runtime evidence identify the path as `public`.

The bundle contains:

- `config.yaml`
- `credential-manifest.json`
- `commands.json`
- `image-publication.json`
- `managed-dependencies.profile.yaml`
- `provider-capabilities.json`
- conformance and ingress checklists
- an AWS EC2 profile artifact

Generated files contain placeholders and file paths only. They must not contain database URLs,
access keys, token values, private keys, or Infisical client secrets.

## Step 6: Review Non-Secret Runtime Config

Before starting the service, review `config.yaml` and replace placeholder non-secret values with
reviewed live values:

- `authProvider.issuer`
- `authProvider.audience`
- `authProvider.jwksUrl`
- `authProvider.claims`
- `authProvider.roleGroups`
- `authProvider.servicePrincipals`
- each `credentials.infisicalDeployments[].siteUrl`
- each `credentials.infisicalDeployments[].projectId`
- each `credentials.infisicalDeployments[].environment`

The setup generator intentionally uses safe placeholders such as `https://auth.example.test` and
derived Infisical project ids. Those placeholders are not production-ready. Keep these values
non-secret and reviewed. Secret material still belongs only in the credential files from the
manifest.

If you intend to disable public Supabase database connectivity after PrivateLink is working, do it
only after the service and workers have passed readiness from the private endpoint and every other
database client has been moved to the private hostname.

## Step 7: Stage Credential Files

Stage real secret values as files under:

```text
/run/deployment-control-plane/credentials
```

At minimum, the AWS host needs:

| Filename                                 | Purpose                                                                 |
| ---------------------------------------- | ----------------------------------------------------------------------- |
| `control-plane-database-url`             | Supabase Postgres URL using the selected public or PrivateLink hostname |
| `control-plane-token`                    | service bearer token for control-plane API checks                       |
| `artifact-store-endpoint`                | S3-compatible endpoint                                                  |
| `artifact-store-access-key-id`           | artifact-store access key id                                            |
| `artifact-store-secret-access-key`       | artifact-store secret access key                                        |
| `reviewed-source-ssh-key`                | reviewed-source SSH private key, if SSH mode is selected                |
| `reviewed-source-known-hosts`            | reviewed-source SSH known-hosts file                                    |
| `{deploymentId}-infisical-client-id`     | deployment-scoped Infisical Universal Auth client id                    |
| `{deploymentId}-infisical-client-secret` | deployment-scoped Infisical Universal Auth client secret                |

If GitHub App mode is selected, replace the SSH files with:

- `reviewed-source-github-app-id`
- `reviewed-source-github-app-installation-id`
- `reviewed-source-github-app-private-key`

Secret values must not be placed in Nix options, image layers, command-line arguments, ordinary
environment files, deployment metadata, or logs.

## Step 8: Start Service And Workers

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
- `GET /readyz` checks database connectivity, artifact-store metadata-read connectivity, and worker
  heartbeat visibility.
- `GET /api/v1/worker-heartbeats` reports authenticated worker heartbeat summaries.

## Step 9: Run Managed Dependency Validation

Use the generated profile and the same credential directory the service uses:

```bash
zx-wrapper build-tools/tools/deployments/control-plane-managed-dependencies.ts \
  --profile ./cloud-control-profile/managed-dependencies.profile.yaml \
  --credential-directory /run/deployment-control-plane/credentials
```

This validates:

- required Postgres features
- object-store `PUT`, `GET`, `HEAD`, metadata, content type, and digest checks
- non-secret evidence output

If the Supabase path is PrivateLink, run the validation from the AWS host or an instance in the same
VPC path. A laptop or CI runner proof does not prove the cloud runtime path.

## Step 10: Run Runtime And AWS Evidence Checks

From `commands.json`, run:

- database validation
- artifact-store validation
- health check
- readiness check
- worker-heartbeat check

For AWS EC2 readiness, also attach evidence for:

- selected subnets
- selected security groups
- TLS, DNS, and load-balancer health
- S3 VPC endpoint path
- Supabase path: `public` or `privatelink`
- service and worker process ids
- image digest and runtime config digest
- graceful worker shutdown evidence

When PrivateLink is selected, the runtime database evidence must prove the service and workers are
using the PrivateLink endpoint, not the public Supabase hostname.

## Step 11: Cut Over

Before moving protected/shared traffic, run:

```bash
deployment-control-plane cutover \
  --evidence ./cloud-cutover-evidence.json \
  --expected-host-profile aws-ec2 \
  --expected-image-build-identity nix-source-<build-identity> \
  --expected-region us-east-1 \
  --selected-capability aws-ec2-control-plane-host,aws-s3-artifact-store \
  --out ./cloud-cutover-report.json
```

The report must pass before the AWS host becomes protected/shared-ready. Keep mini or the previous
host in a reviewed standby mode until rollback evidence is fresh.

## Troubleshooting

- Database validation fails: confirm the URL file points at the intended Supabase project, the
  selected hostname is reachable from the AWS host, and the Postgres user has the required rights.
- PrivateLink DNS fails: confirm AWS RAM share acceptance, endpoint status, endpoint DNS setting,
  VPC DNS support, subnet selection, and security group ingress on TCP 5432.
- Readiness fails but health passes: check database, artifact-store credentials, and worker
  heartbeat rows. `/healthz` does not prove dependencies are usable.
- Worker heartbeat missing: confirm at least two worker processes use the same config file,
  database URL, artifact store, and image digest as the service.
- S3 check fails: confirm bucket, endpoint, signing region, IAM role or access key, endpoint policy,
  and key prefix.
- Missing credential failure: compare host files against `credential-manifest.json`. Do not repair
  by switching to environment variables.
- Cutover evidence rejected: replace dashboard-only notes with structured evidence tied to the same
  AWS instances, image digest, config digest, selected database path, and selected artifact path.

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
- [ ] `config.yaml` placeholder auth-provider and Infisical metadata are replaced with reviewed
      live non-secret values.
- [ ] Credential files match `credential-manifest.json`.
- [ ] One service and at least two workers are running.
- [ ] Managed dependency validation passes from the AWS runtime path.
- [ ] Health, readiness, and worker-heartbeat checks pass.
- [ ] Provider-capability evidence is attached.
- [ ] Cutover report passes before protected/shared traffic moves.
