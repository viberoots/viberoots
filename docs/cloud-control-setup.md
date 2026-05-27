# Cloud Control Plane Setup

Use the setup command to generate a reviewed host-profile bundle before placing the deployment
control plane on a cloud substrate:

```bash
deployment-control-plane setup \
  --out ./cloud-control-profile \
  --host-mode aws-ec2 \
  --image registry.example.com/platform/deployment-control-plane@sha256:<64-hex-digest> \
  --public-url https://deploy.example.test \
  --auth-callback-host deploy-auth.example.test \
  --artifact-backend aws-s3 \
  --artifact-bucket deployment-control-plane-artifacts \
  --artifact-region us-east-1 \
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
- mode-specific profile files for Compose/Podman, NixOS, SaaS OCI, or AWS EC2.

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
6. Run `commands.validations.database.command` and `commands.validations.artifactStore.command`.
   Both checks must pass against temporary schema/data or temporary object prefixes.
7. Start one service process and at least two worker processes from `commands.json`.
8. Run `commands.validations.health.command`, `commands.validations.readiness.command`, and
   `commands.validations.workerHeartbeats.command`.
9. Treat the host as protected/shared-ready only after every entry in
   `conformance-checklist.json` passes and the evidence is attached to the selected provider
   capabilities.

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

## Provider Capabilities

Every generated provider-capability declaration must name target identity, credential source, lock
scope, preview/diff behavior, mutation sequence, smoke checks, rollback procedure, replay semantics,
audit evidence, and protected/shared eligibility. Provider CLIs or IaC apply commands are allowed
only through the control-plane admission, locking, credential, audit, and rollback model.

Provider dashboards, raw IaC state, and manual support actions are evidence inputs, not hidden
deployment authority. Support-mediated setup, such as parts of Supabase PrivateLink, is recorded as
a gated prerequisite with evidence.

## Reviewed Source

`--reviewed-source-mode ssh` generates the initial SSH file contract. Stage
`reviewed-source-ssh-key` and `reviewed-source-known-hosts` in the generated credential directory.
`--reviewed-source-mode github-app` is rejected until the runtime parser and reviewed-source
adapter support the GitHub App credential contract. When that adapter exists, the expected
credential filenames are `reviewed-source-github-app-id`,
`reviewed-source-github-app-installation-id`, and `reviewed-source-github-app-private-key`.
Neither mode may rely on laptop or CI credentials for protected/shared deploys.

## Non-Default Substrates

Fargate, Vercel Functions, Supabase Edge Functions, and Cloudflare Workers are not default
substrates for the long-running deployment service or workers because they do not provide the
reviewed long-running worker, mounted credential-file, scratch-state, shutdown, and authority
boundaries required by the control plane. Vercel output remains limited to operator UI/API guidance,
and Cloudflare output remains limited to DNS, TLS/WAF, rate limiting, and reviewed edge settings.
