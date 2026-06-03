# Fresh AWS Account Setup: Control Plane And Remote Builds

Use this guide when bringing a new AWS account from empty account to a reviewed deployment control
plane plus remote-build readiness. It is intentionally staged: each phase produces evidence that the
next phase consumes.

## Boundary

Durable AWS infrastructure is declarative and IaC-owned. Use OpenTofu for VPCs, subnets, route
tables, gateways, S3 buckets, DynamoDB locks, KMS keys, ECR repositories, IAM roles, security
groups, load balancers, certificates, DNS, launch templates, Auto Scaling groups, and AWS-hosted Nix
builder or remote-execution worker infrastructure.

Repository commands may:

- render reviewed inputs or generated profile bundles
- orchestrate OpenTofu plan/apply when called from an approved workflow
- collect read-only AWS evidence
- validate evidence against IaC outputs
- gate readiness and cutover

Repository commands must not become a second imperative AWS provisioning engine.

## Source Documents

- [Control Plane Guide](control-plane-guide.md)
- [Cloud Control Plane Setup](cloud-control-setup.md)
- [Cloud Control Cutover](cloud-control-cutover.md)
- [AWS EC2 Control Plane Host Profile](control-plane-aws-ec2-host-profile.md)
- [Runtime Configuration](control-plane-runtime-configuration.md)
- [Managed Dependencies](control-plane-managed-dependencies.md)
- [Credential Staging](control-plane-credential-staging.md)
- [Remote Builds and Distributed Tests](../build-tools/docs/remote-build-setup.md)
- [Infrastructure as Code Standard](adrs/00007-infrastructure-as-code-standard.md)

## Phase 0: Account Baseline

Before running repo setup commands, establish the AWS account baseline.

Selected account decisions:

- First control-plane stack name: `control`.
- First control-plane AWS region: `us-east-1`.
- First control-plane domain: operator supplied; there is no repo default. Examples in this guide
  use `example.com` only as a placeholder.
- First control-plane hostname pattern: `[service].control.<domain>`.
- First control-plane public service hostname: `deploy.control.<domain>`.
- First control-plane public auth callback hostname: `auth.control.<domain>`.
- First control-plane private database alias: `db.control.<domain>`, private VPC DNS only.
- Control-plane database path: **Supabase PrivateLink only**. Do not use publicly accessible
  Supabase Postgres for this fresh AWS account setup.
- Image registry: repo-managed AWS ECR for runtime OCI images, with Nix/Attic cache retention for
  build inputs, Nix closures, and reproducible image build artifacts.
- EC2 host ownership: `repo-owned-asg`.
- Remote-build target: enable Nix cache, Nix remote builders, and Buck2 remote execution by the end
  of this guide, in that order.
- Public DNS authority for the first stack: move all selected-domain authoritative DNS to a Route
  53 public hosted zone in the new AWS account by updating registrar nameservers.

These are first-stack defaults, not global constants. A second control-plane stack in another AWS
account, AWS organization, region, or domain must be possible without code changes by supplying a
different stack config.

Multi-stack parameter model:

| Parameter                   | First-stack default                                              | Must be overridable? | Notes                                                                                                                       |
| --------------------------- | ---------------------------------------------------------------- | -------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `stackName` / `environment` | `control`                                                        | Yes                  | Logical control-plane stack name. Use a different value for a second independent control plane.                             |
| `awsOrganizationId`         | unset until account is known                                     | Yes                  | Recorded as evidence; used to distinguish accounts in different AWS orgs.                                                   |
| `awsAccountId`              | unset until account is known                                     | Yes                  | Required before AWS login checks can pass.                                                                                  |
| `region`                    | `us-east-1`                                                      | Yes                  | Must match the Supabase project region for PrivateLink.                                                                     |
| `domain`                    | required; no default                                             | Yes                  | Every stack must supply its own domain.                                                                                     |
| `service`                   | `deploy`                                                         | Yes                  | Derives the public service hostname unless `serviceHost` is supplied.                                                       |
| `authService`               | `auth`                                                           | Yes                  | Derives the public auth callback hostname unless `authHost` is supplied.                                                    |
| `privateDbService`          | `db`                                                             | Yes                  | Derives the private database alias unless `privateDbHost` is supplied.                                                      |
| `serviceHost`               | `<service>.<stackName>.<domain>`                                 | Yes                  | Public DNS name.                                                                                                            |
| `authHost`                  | `<authService>.<stackName>.<domain>`                             | Yes                  | Public DNS name.                                                                                                            |
| `privateDbHost`             | `<privateDbService>.<stackName>.<domain>`                        | Yes                  | Private hosted zone only.                                                                                                   |
| `evidenceDir`               | `buck-out/aws-account/<stackName>-<domain>`                      | Yes                  | Must be unique per stack and account.                                                                                       |
| `stateBucketName`           | `deployment-control-plane-<stack>-<domain-sanitized>-tofu-state` | Yes                  | Must be globally unique if S3-backed. Override if AWS bucket naming policy requires it.                                     |
| `stateLockTableName`        | `deployment-control-plane-<stack>-<domain-sanitized>-tofu-locks` | Yes                  | Account-local DynamoDB table.                                                                                               |
| `backendStateKey`           | `aws-foundation/deployment-control-plane.tfstate`                | Yes                  | S3 key for the main foundation remote backend state.                                                                        |
| `supabaseOrgId`             | unset until selected                                             | Yes                  | Required evidence for PrivateLink setup.                                                                                    |
| `supabaseProjectRef`        | unset until selected                                             | Yes                  | Required evidence for PrivateLink setup.                                                                                    |
| `supabaseRegion`            | selected AWS region                                              | Yes                  | Must match the AWS region used for the VPC and PrivateLink endpoint.                                                        |
| `supabaseAccessTokenEnv`    | `SUPABASE_ACCESS_TOKEN`                                          | Yes                  | Fallback environment variable name only; the token value must never be written to config/evidence.                          |
| `supabaseAccessToken`       | `secret://control-plane/supabase/management-api-token`           | Yes                  | Structured SprinkleRef ref with `category: "control"` for the Supabase Management API token; plaintext values are rejected. |
| `supabaseApiBaseUrl`        | `https://api.supabase.com`                                       | Yes                  | Override only for a reviewed Supabase API endpoint change or test harness.                                                  |

The guided command accepts flags, a generated canonical JSON stack config file, or an explicit JSON
config file. Generate the canonical first-stack config with:

```bash
control-plane aws-account config-init
```

By default this writes `config/control-plane/stack.json`. The file is intentionally minimal:
defaults and derived values stay implicit, while account/provider values without defaults are
written as inline values or structured SprinkleRef refs. This keeps the file usable as a short
setup checklist instead of a dump of every derived option.
The `check` and `bootstrap` commands load this canonical file automatically, so `--config` is only
needed for exception cases, such as a second control-plane stack in the same clone.

The config file is the safer path because it records account ids, organization ids, domain,
Supabase project identifiers, and any deliberate naming overrides in one reviewed place. Do not
hardcode domains, account ids, bucket names, or Supabase project refs in the implementation. Do not
put AWS credentials or Supabase access token values in this file; use a SprinkleRef URI such as
`secret://control-plane/supabase/management-api-token`, or an exported environment variable for a
single setup run.

`stack.json` is JSON-only. The aws-account command does not support TOML or YAML stack config
files. When `config-init` runs without flags, `domain` is written as an empty scalar and private
coordinates are written as structured refs with explicit `category: "control"`: `awsAccountId`,
`awsOrganizationId`, `supabaseOrgId`, `supabaseProjectRef`, and `supabaseAccessToken`. Non-secret
account and Supabase coordinates use `config://...` refs; the Supabase Management API token remains
a `secret://...` ref. Optional
hardening fields, such as `expectedAwsRoleArn`, and fields with sensible defaults, such as
`stackName`, `region`, service names, derived hostnames, evidence paths, state backend names,
Supabase token env, and Supabase API base URL, are omitted unless an operator explicitly supplies a
non-default value.

The preferred shared SprinkleRef resolver config is `config/sprinkleref/selected.json`.
`config/sprinkleref/selected.local.json` remains an escape hatch for migration or exceptional
per-clone resolver changes. Ordinary clone-local coordinates belong in the gitignored
`config/sprinkleref/local/values.json`, which can be initialized with:

```bash
sprinkleref --init-local
```

A local value can redirect a true secret to the configured bootstrap category:

```json
{
  "ref": "secret://control-plane/supabase/management-api-token",
  "category": "bootstrap"
}
```

Do not write the Supabase Management API token itself to local JSON.

Required account prerequisites, dumbed down:

### 1. AWS Login That Can Run The Setup

You need one human/operator AWS identity that can run OpenTofu for the new account.

In plain terms: this is the AWS login used to create the first VPC, buckets, locks, IAM roles, ECR
repo, Route 53 zones, EC2 launch template, and Auto Scaling group. It is not a runtime credential for
the control plane.

Identity rule: humans bootstrap, approve, and break glass; dedicated roles run the system. The
control plane, deployment execution path, EC2 service/worker runtime, and remote-build lanes must
not be associated with a personal human AWS user as their normal identity.

Automation target:

- Use AWS IAM Identity Center or another reviewed SSO path for the human operator.
- Prefer a named admin/bootstrap role in the new AWS account.
- Run OpenTofu from a controlled local shell or CI bootstrap job using that role.

Do not:

- Put these AWS credentials in generated control-plane profiles.
- Put these AWS credentials on EC2 instances as static files.
- Use long-lived personal access keys if SSO/role assumption is available.

Proof to keep:

- AWS account id.
- Operator role ARN.
- How the role is assumed.
- A short note that the role is for bootstrap/OpenTofu only, not runtime.

Optional script guard: set `expectedAwsRoleArn` only when you want `control-plane aws-account check`
to fail closed unless `aws sts get-caller-identity` returns that exact ARN. Leave it out for the
first pass if you only need account-id validation.

### 1A. Dedicated Roles And Service Identities

Use separate identities for separate jobs.

In plain terms: a human may press the setup button or approve a plan, but the running service,
workers, deployment actions, and remote-build infrastructure should use dedicated AWS roles and
application identities. That makes access review, audit logs, rotation, and rollback much cleaner.

Use this identity model:

| Area                         | Normal identity                                                                                    | Notes                                                                                         |
| ---------------------------- | -------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Human setup and approval     | SSO user assuming a bootstrap/operator role                                                        | Used to run or approve OpenTofu. Not used by runtime services.                                |
| IaC apply lane               | Dedicated OpenTofu/bootstrap role                                                                  | Can be assumed by the human operator or a reviewed CI job.                                    |
| Control-plane service on EC2 | EC2 instance profile from `foundation_evidence`                                                    | Used for AWS runtime access such as ECR pulls and artifact-store access.                      |
| Control-plane workers on EC2 | EC2 instance profile from `foundation_evidence`                                                    | Same reviewed runtime identity class as service, or a narrower worker profile if later split. |
| Deployment/provider actions  | Control-plane service identity plus provider-specific credentials from reviewed credential staging | Do not use a human's AWS credentials for normal deploy actions.                               |
| Nix remote builders          | Dedicated builder instance profile or builder service identity                                     | Scoped to cache/builder needs, not broad deployment authority.                                |
| Buck2 RE workers             | Dedicated RE worker identity                                                                       | Scoped to remote execution inputs/artifacts/logs, not control-plane administration.           |
| Emergency access             | Break-glass human role                                                                             | Time-bound, logged, and not part of normal automation.                                        |

Do not:

- Run the control plane under a human IAM user.
- Store a human's AWS access keys in the control-plane credential directory.
- Let remote builders or Buck2 RE workers share the same broad role used for OpenTofu apply.
- Reuse the bootstrap/operator role for steady-state deployment execution.

Proof to keep:

- ARN for the bootstrap/operator role.
- ARN for the OpenTofu apply role if it is separate.
- ARN for the EC2 service/worker instance profile.
- ARN or profile evidence for remote-builder and Buck2 RE worker identities.
- A short note explaining which human or CI principal may assume each role.

### 1B. Tooling Comes From The Repo Flake

All required setup tools must be provided by this repo's Nix flake or by an input imported by that
flake.

In plain terms: do not rely on random tools installed on a laptop. The setup command should run from
the repo's Nix development environment so every operator and CI lane uses the same `aws`, `tofu`,
`dig`, `openssl`, `psql`, `jq`, Node, package-manager, and repo wrapper versions.

Automation target:

- Enter the repo through the Nix dev shell before running fresh AWS account setup.
- Make the guided command's `check-tools` phase verify required binaries are present and resolve to
  the expected Nix/dev-shell environment.
- Add missing setup tools to the repo flake or to a flake input; do not document ad hoc host package
  installs as the normal path.

Do not:

- Ask operators to install required tools with Homebrew, apt, npm globals, or manual downloads for
  the normal setup path.
- Let `check-tools` pass because an ambient host binary happens to exist outside the Nix
  environment.
- Pin tool versions only in prose.

Proof to keep:

- Nix flake lock fingerprint.
- Dev-shell/tool manifest or `check-tools` evidence showing required tool names and resolved paths.
- Any reviewed exception for a provider CLI that cannot yet be packaged through the flake.

### 2. OpenTofu Remote State Bootstrap

OpenTofu needs somewhere to store its state before it can manage most infrastructure. For this repo,
that means an S3 bucket for state and a DynamoDB table for state locking.

In plain terms: OpenTofu cannot use a remote state bucket that does not exist yet. This is the first
bootstrapping wrinkle in a fresh account.

Preferred automation target:

1. Run the tiny reviewed bootstrap stack at
   `build-tools/deployments/aws-control-plane-state-bootstrap/opentofu`. It creates only:
   - S3 state bucket.
   - DynamoDB lock table.
   - Encryption and public-access-block settings for the state bucket.
2. Point `backend.hcl` at those resources.
3. Run the main foundation OpenTofu module normally.

Acceptable fallback:

- Run the foundation once with reviewed local state, create/import the remote state bucket and lock
  table, then migrate state to the remote backend.

Do not:

- Point `backend.hcl` at the same bucket/table the main module is about to create unless those
  resources already exist and are imported.
- Store state in an unencrypted or public bucket.
- Treat local state as the long-term state backend.

Proof to keep:

- State bucket name.
- Lock table name.
- Backend config file path.
- `tofu init` output showing the backend initialized.
- Bucket encryption and public-access-block evidence.
- `bootstrap-state/plan.json` and, after explicit apply,
  `bootstrap-state/state-bootstrap-evidence.json`.

### 3. AWS Credentials Stay In The Setup Lane

The AWS credentials used for OpenTofu are allowed only in the setup/operator environment.

In plain terms: the repo can use AWS credentials to create infrastructure through OpenTofu. The
generated control-plane bundle should not contain AWS access keys. Runtime AWS access should come
from instance profiles or other reviewed runtime identity, not copied bootstrap secrets.

Automation target:

- OpenTofu assumes the bootstrap/operator role.
- EC2 service and worker instances use the instance profile created by the reviewed AWS foundation.
- Generated profile bundles contain paths, ARNs, digests, and evidence, not AWS secret values.

Do not:

- Commit AWS access keys.
- Put AWS access keys in `config.yaml`, `credential-manifest.json`, or profile evidence.
- Use environment variables as a hidden runtime credential path when the guide expects mounted files
  or instance-profile access.

Proof to keep:

- Instance profile ARN from `foundation_evidence`.
- Confirmation that generated profile files contain no AWS access keys.
- Setup evidence showing the runtime path uses the selected instance profile.

### 4. Required Tags

The AWS foundation module requires a small set of tags on durable resources.

In plain terms: tags make it obvious who owns the resource, which environment it belongs to, how
sensitive it is, and whether rollback needs review.

Use these initial tags unless a later policy replaces them:

```hcl
tags = {
  owner              = "platform"
  environment        = "control"
  dataClassification = "internal"
  rollback           = "review-required"
}
```

Automation target:

- Put these tags in the account `.tfvars` file.
- Let OpenTofu apply them to supported resources.
- Add any organization-required cost-center or compliance tags before first apply.

Do not:

- Leave tag values blank.
- Use placeholders such as `todo`, `unknown`, or `example`.
- Apply tags manually in the AWS console as the source of truth.

Proof to keep:

- The reviewed `.tfvars` tag block.
- Plan/apply output showing tagged resources.
- Any organization-required tag policy note.

### 5. Supabase PrivateLink Readiness

The database path is PrivateLink-only.

In plain terms: the control-plane database should be reachable from the new AWS VPC over a private
path, not from the public internet.

Automation target:

- Supabase project is created in the selected region, `us-east-1` for the first stack.
- Supabase Management API reports a Team or Enterprise plan that supports PrivateLink.
- Supabase shares the PrivateLink resource with the new AWS account.
- AWS-side acceptance, endpoint wiring, private DNS, and validation evidence are handled by reviewed
  IaC and generated setup commands where the repo has control.

Human/provider step:

- Supabase-side PrivateLink enablement may require dashboard or support-mediated action. Capture it
  as evidence, but do not replace AWS-side IaC with screenshots.

Do not:

- Use a public Supabase database URL as a temporary production fallback.
- Publish `db.control.example.com` in public DNS.
- Proceed if Supabase and AWS are not in the same supported region.

Proof to keep:

- Supabase organization and project ref.
- Supabase region.
- PrivateLink resource/share evidence.
- AWS RAM acceptance evidence.
- Private endpoint DNS evidence.
- `psql` proof from the new VPC.

### 6. Registrar Access For The Selected Domain

The new AWS account must become authoritative for the selected public domain, `example.com` for the
first stack.

In plain terms: your registrar controls which nameservers answer for the domain. The new Route 53 hosted zone
does not matter until your registrar points the domain at the new AWS nameservers.

Automation target:

- OpenTofu creates the public Route 53 hosted zone in the new AWS account.
- OpenTofu manages the stack's public service host, auth callback host, and ACM validation records
  after the zone exists.

Human step:

- Log in to your registrar and replace the current custom nameservers with the four Route 53 nameservers
  from the new AWS account.

Do not:

- Leave the old AWS account authoritative for `example.com`.
- Delegate only the stack host suffix, such as `control.example.com`, from the old account.
- Create public DNS for the stack private DB host, such as `db.control.example.com`.

Proof to keep:

- New Route 53 hosted zone id.
- Four new Route 53 nameservers.
- your registrar nameserver update proof.
- Public DNS lookup proof after propagation.

### Automation Plan For These Prerequisites

| Prerequisite                           | Best automation level                                | Why                                                                                                                        |
| -------------------------------------- | ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Required setup tools                   | Repo Nix flake                                       | Operators and CI must not depend on ambient host installs; `check-tools` should verify Nix/dev-shell tool paths.           |
| Operator AWS login                     | Human setup, scripted verification                   | A person needs SSO/role access, but a script can print `aws sts get-caller-identity` and verify the expected account/role. |
| OpenTofu state bucket and lock table   | Small bootstrap IaC stack                            | The main foundation cannot use remote state until these exist. Keep this bootstrap tiny and reviewed.                      |
| Main AWS foundation                    | OpenTofu                                             | VPC, IAM, ECR, Route 53, KMS, security groups, ASG, and durable AWS resources should be declarative.                       |
| Runtime AWS identity                   | OpenTofu plus generated validation                   | Instance profiles and policies are IaC-owned; setup-doctor validates the generated/runtime evidence.                       |
| Required tags                          | OpenTofu variables plus plan checks                  | Tags should be set once in `.tfvars` and reviewed in the plan.                                                             |
| Supabase project and PrivateLink share | Human/provider step plus evidence                    | Supabase-side enablement may require dashboard/support. AWS-side acceptance and validation should be IaC/evidence-driven.  |
| your registrar nameserver switch       | Human registrar step plus evidence                   | The registrar update is outside AWS. Capture the before/after nameserver proof.                                            |
| Public service/auth DNS                | OpenTofu after registrar points to new Route 53 zone | Once the new zone is authoritative, records and ACM validation can be IaC-owned.                                           |
| Private DB DNS                         | OpenTofu                                             | Private hosted zone and VPC association should be declarative in the selected account.                                     |

The practical goal is one guided bootstrap command or checklist that:

1. verifies the operator role and AWS account id
2. verifies Supabase project/PrivateLink readiness
3. bootstraps remote OpenTofu state
4. runs the main OpenTofu plan/apply only after the prerequisite checks pass
5. captures all evidence files into the account setup record

### Top-Level Guided Bootstrap Command

The setup has one top-level guided command:

```bash
control-plane aws-account bootstrap --domain example.com
```

`bootstrap` is the normal guided entrypoint. The current implementation covers prerequisite checks
and the remote-state bootstrap plan/apply path. Later foundation, DNS, profile, cutover, and remote
build phases are represented in status/evidence as the intended sequence, but are still completed
with the documented commands in the later sections of this guide.

The `aws-account` namespace also has small subcommands for resuming, checking, and inspecting
the setup without rerunning every phase:

```text
control-plane aws-account bootstrap
control-plane aws-account status
control-plane aws-account resume
control-plane aws-account check
control-plane aws-account evidence
control-plane aws-account clean
control-plane aws-account config-init
```

Subcommand intent:

| Subcommand    | Purpose                                                                                                            | Mutation allowed              |
| ------------- | ------------------------------------------------------------------------------------------------------------------ | ----------------------------- |
| `bootstrap`   | Run prerequisite checks and remote-state bootstrap plan/apply; later phases remain documented manual/guided steps. | OpenTofu state-bootstrap only |
| `status`      | Read `status.json` and summarize completed, blocked, and next phases.                                              | None                          |
| `resume`      | Continue from the last incomplete phase using the existing evidence directory.                                     | Same as resumed phase         |
| `check`       | Run prerequisite checks only: tools, AWS login, and Supabase readiness.                                            | None                          |
| `evidence`    | Validate and summarize evidence files, redaction status, freshness, and missing artifacts.                         | None                          |
| `clean`       | Remove incomplete generated run output after confirmation; never delete cloud resources.                           | Local generated files only    |
| `config-init` | Write a reviewable minimal stack config with empty unknowns and explicit non-default overrides.                    | Local config file only        |

The namespace must not grow separate custom AWS provisioning commands such as
`create-ecr`, `create-asg`, or `create-privatelink`. Durable AWS changes stay inside the OpenTofu
modules that `bootstrap`, `resume`, or the documented manual phase commands orchestrate.

Defaults:

- `--stack control` / `--environment control`
- `--region us-east-1`
- `--service deploy`
- `--auth-service auth`
- `--private-db-service db`
- `--service-host <service>.<stack>.<domain>`, so `deploy.control.example.com`
- `--auth-host <auth-service>.<stack>.<domain>`, so `auth.control.example.com`
- `--private-db-host <private-db-service>.<stack>.<domain>`, so `db.control.example.com`
- `--evidence-dir buck-out/aws-account/<stack>-<domain>`, so
  `buck-out/aws-account/control-example.com`
- `--state-bucket-name deployment-control-plane-<stack>-<domain-sanitized>-tofu-state`, so
  `deployment-control-plane-control-example-com-tofu-state`
- `--state-lock-table-name deployment-control-plane-<stack>-<domain-sanitized>-tofu-locks`, so
  `deployment-control-plane-control-example-com-tofu-locks`
- `--backend-state-key aws-foundation/deployment-control-plane.tfstate`
- `--supabase-access-token-env SUPABASE_ACCESS_TOKEN`
- `--supabase-api-base-url https://api.supabase.com`

The operator should normally provide only `--domain`, the expected AWS account id, Supabase project
identifiers, and either the structured `supabaseAccessToken` ref or a setup-shell
`SUPABASE_ACCESS_TOKEN` for the first stack. Prefer writing non-secret clone-local values to
`config/sprinkleref/local/values.json` and keeping the shared refs in
`config/control-plane/stack.json`. `config-init` writes the small checklist by default and records
non-default overrides only when they are explicitly supplied. Use `--config <path>` only for
exception cases, such as a second control-plane stack in the same clone. Override hostnames or
`--evidence-dir` only when DNS policy or CI artifact collection requires a different shape.

For the first prerequisite check, prefer a SprinkleRef ref for the Supabase Management API token and
keep the token value out of config files. Use `sprinkleref --init-local` for clone-local
coordinates, and use `sprinkleref --update ... --create-missing` to write the token to the
selected/default resolver when needed:

```bash
control-plane aws-account config-init \
  --domain example.com \
  --expected-aws-account-id <new-account-id> \
  --supabase-org-id <supabase-org-id> \
  --supabase-project-ref <supabase-project-ref>

sprinkleref --init-local

sprinkleref --update secret://control-plane/supabase/management-api-token --create-missing

control-plane aws-account check
```

Add `--category bootstrap` only when the stack config or clone-local value explicitly chooses
`category: "bootstrap"` for the token ref. If SprinkleRef is not ready yet, export
`SUPABASE_ACCESS_TOKEN=<token>` in the setup shell for that run. The env var wins when both the env
var and ref are present.

`check` prints a human-readable summary by default: a compact stack header, a phase result list, a
stack-config checklist for missing setup values, a short problem or evidence section, the next
command to run, and the machine-readable status file path. Use `--json` when a CI job or script needs
the raw `aws-account-status@1` payload on stdout:

```bash
control-plane aws-account check \
  --evidence-dir buck-out/aws-account/control-example.com \
  --json
```

After a run has written `inputs.json`, `resume`, `status`, and `evidence` can use
`--evidence-dir buck-out/aws-account/control-example.com` without repeating the domain,
account, and Supabase parameters. `evidence --max-age-minutes <minutes>` validates expected evidence
schemas, freshness, missing artifacts, and likely secret leakage before the next phase proceeds.

The default evidence directory is under `buck-out` because it is generated run output, not committed
source. The command derives it from stack and domain, then writes a stable status file and per-phase
evidence below that directory:

```text
buck-out/aws-account/control-example.com/
  status.json
  inputs.json
  check-tools/
  check-aws-login/
  check-supabase/
  bootstrap-state/
  plan-foundation/
  apply-foundation/
  dns-migration/
  verify-dns/
  setup-profile/
  validate-cutover/
  remote-builds/
```

Do not put secret values in the evidence directory. Evidence may contain account ids, ARNs, DNS
names, digests, plan summaries, command outputs, and redacted provider facts. Supabase readiness
evidence records the token environment variable name, API URL, request paths, response status codes,
and summarized project/organization facts; it must not record the access token value.

The first stack name should stay `control`. This is not a deployment target environment like
`staging` or `prod`; it is the dedicated stack name for this deployment control plane. Use a
different stack name for a separately reviewed second control-plane stack, such as `control-dr`,
`control-dev`, or a domain/org-specific name.

The command is resumable and phase-based for the implemented setup phases. Each implemented phase
writes evidence before moving to the next phase. Later phases remain listed so `status.json` keeps
the full setup sequence visible, but `resume` can execute only `check-tools`, `check-aws-login`,
`check-supabase`, and `bootstrap-state` today; for later phases it reports that the documented phase
command must be run manually.

| Phase              | Command behavior                                                                                                                                                                                                                                                      | Mutation allowed                          |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| `check-tools`      | Verify `aws`, `tofu`, `dig`, `openssl`, `psql`, `jq`, Node/package-manager tooling, and repo wrappers are available from the repo Nix flake/dev shell, not ambient host installs.                                                                                     | None                                      |
| `check-aws-login`  | Run `aws sts get-caller-identity`, compare account/role to expected values, and write identity evidence.                                                                                                                                                              | None                                      |
| `check-supabase`   | Resolve the Supabase Management API token from structured `supabaseAccessToken`, local values/bootstrap redirect, shared SprinkleRef resolver, or `supabaseAccessTokenEnv`; fail closed unless project, organization, region, and plan match the supplied parameters. | None                                      |
| `bootstrap-state`  | Copy the tiny state-bootstrap OpenTofu module into the evidence directory, render `account.auto.tfvars.json`, run `tofu init` and `tofu plan`, and apply only when `--apply` is supplied.                                                                             | Bootstrap IaC only                        |
| `plan-foundation`  | Intended sequence marker; run the documented foundation OpenTofu plan commands after state bootstrap evidence is ready.                                                                                                                                               | None beyond plan artifacts                |
| `apply-foundation` | Intended sequence marker; apply the reviewed foundation plan after explicit confirmation.                                                                                                                                                                             | OpenTofu only                             |
| `dns-migration`    | Intended sequence marker; create Route 53 zone/records with OpenTofu, print registrar nameservers, then pause for registrar update.                                                                                                                                   | OpenTofu only; registrar update is human  |
| `verify-dns`       | Intended sequence marker; verify public nameserver propagation, service/auth DNS, private DB DNS, ACM validation, and no public DB DNS.                                                                                                                               | None                                      |
| `setup-profile`    | Intended sequence marker; run `control-plane setup --dry-run`, then render the final bundle after prerequisites pass.                                                                                                                                                 | Generated files only                      |
| `validate-cutover` | Intended sequence marker; run setup-doctor, credential-preflight, managed dependency validation, ingress checks, and readiness gates.                                                                                                                                 | None                                      |
| `remote-builds`    | Intended sequence marker; run Nix cache, Nix builder, generated Buck config, default-local policy, and Buck2 RE conformance checks.                                                                                                                                   | Generated files and remote-build IaC only |

The command is conservative:

- Default to plan-only. `bootstrap` prepares and records the remote-state plan, then waits unless
  `--apply` is supplied.
- Require an explicit `--apply` before the state-bootstrap OpenTofu apply.
- Never create durable AWS resources through custom AWS SDK calls. The remote-state bootstrap is
  also OpenTofu-owned.
- Never update your registrar directly unless a future reviewed registrar integration exists and the
  operator has intentionally supplied registrar API credentials.
- Redact secrets from all evidence.
- Write a machine-readable `inputs.json` plus `status.json` so the operator can resume from an
  evidence directory after Supabase or other manual provider steps without retyping all flags.

Provider API boundaries:

- AWS checks and read-only evidence collection can use the AWS CLI/SDK.
- Required CLIs and SDK-backed helper tools must come from the repo Nix flake or one of its flake
  inputs.
- Durable AWS resources must be created or updated by OpenTofu.
- Supabase PrivateLink setup may use Supabase dashboard/API evidence where available, but the
  AWS-side RAM acceptance, endpoint, DNS, and validation path must stay IaC/evidence-driven.
- Supabase API checks are read-only readiness checks. They validate that the supplied project ref,
  organization, region, and plan are accessible to the setup token before AWS-side IaC proceeds.
  The evidence records token source metadata only; it must never record the token value.
- your registrar nameserver changes remain a guided human step until a reviewed registrar API
  integration is added.

Stop if any prerequisite cannot be satisfied. Do not fill unknowns with placeholder evidence.

Selected baseline:

- Database: Supabase Postgres over PrivateLink. The Supabase project, AWS VPC, and PrivateLink
  endpoint must be in a supported same-region pairing.
- Public database access: not allowed for this setup. If PrivateLink is unavailable in the selected
  region or the API-reported Supabase plan is not Team or Enterprise, stop and change the
  region, Supabase organization plan, or account approach before continuing.
- Public service DNS: use public Route 53 records for service and auth hostnames.
- Private database DNS: if using a friendly name such as `db.control.example.com`, create it only in a
  private hosted zone associated with the new AWS VPC. Do not publish a public `db.control.example.com`
  record.

Minimum values to collect before running automation:

- New AWS account id.
- Supabase organization and project ref. The command reads the Supabase organization plan from
  the Supabase Management API and records whether it is Team or Enterprise evidence for
  PrivateLink readiness.
- A Supabase Management API token available through structured `supabaseAccessToken` in
  `config/control-plane/stack.json`, a local redirect to the `bootstrap` category, or exported in
  the setup shell as `SUPABASE_ACCESS_TOKEN` for early bootstrap. The token value must be kept out
  of stack config files, generated profiles, local values JSON, and evidence.
- Registrar access for your registrar so the authoritative nameservers for `example.com` can be moved to the
  new AWS account for the first stack.

Plain-language tradeoffs:

- **Why `us-east-1`:** it has broad AWS service coverage, mature Route 53/ACM/ECR/EC2 support, and
  is a sensible default when Supabase PrivateLink must be in the same region as the AWS VPC.
- **Why ECR plus Attic/Nix cache:** Attic and other Nix caches are good for retaining Nix store paths
  and speeding up reproducible builds. ECR is still the right runtime registry for OCI images because
  EC2, container runtimes, IAM, digest pulls, lifecycle policy, and registry evidence all integrate
  directly with AWS. Treat Attic as build retention and ECR as the deployment image registry.
- **Why `repo-owned-asg`:** the fresh account has no existing EC2 platform stack, so this repo's
  narrow OpenTofu ASG module gives one reviewed owner for launch templates, scaling, IAM, security
  groups, and user-data evidence.
- **Why Nix before Buck2 RE:** Nix cache/builders prove the worker image and closure story first.
  Buck2 RE is enabled after that foundation is working because it adds remote action policy,
  execution-platform, event-log, and remote-only conformance requirements.

## Phase 1: Provision The Declarative AWS Foundation

The primary AWS foundation module is:

```text
build-tools/deployments/aws-control-plane-foundation/opentofu
```

It owns the reviewed account foundation for the control-plane path: networking, S3 artifact/state
resources, KMS posture, IAM roles, security groups, optional ECR, optional Supabase PrivateLink,
optional ingress, and optional EC2 host/ASG evidence.

Start with a backend file based on:

```text
build-tools/deployments/aws-control-plane-foundation/opentofu/backend.hcl.example
```

For a fresh account, the remote backend cannot depend on a bucket/table that OpenTofu has not
created yet. Use the reviewed state-bootstrap module first:

```bash
control-plane aws-account bootstrap \
  --domain example.com \
  --expected-aws-account-id <new-account-id> \
  --supabase-org-id <supabase-org-id> \
  --supabase-project-ref <supabase-project-ref>
```

That command defaults to plan-only for the remote-state bootstrap. Review
`buck-out/aws-account/control-example.com/bootstrap-state/plan.json` and the generated
`opentofu-workdir/account.auto.tfvars.json`, then rerun the same command with `--apply` to create the
S3 bucket and DynamoDB lock table through OpenTofu. After the apply, use
`bootstrap-state/state-bootstrap-evidence.json` to fill in the main foundation `backend.hcl`.

Fallbacks should be rare and explicit:

- pre-create the backend resources only through another reviewed IaC stack, then import/adopt them
  before normal foundation applies
- run a reviewed local-state bootstrap only when the state-bootstrap module cannot be used, then
  migrate to the remote backend immediately after the state bucket/table exist

Do not point the backend at the same `state_bucket_name` and `state_lock_table_name` that the module
will try to create unless those resources have been imported or the bootstrap plan accounts for
them.

Then create an account-specific `.tfvars` file outside committed source or in a reviewed private
configuration location. For the first `control` stack, start from:

```hcl
region                = "us-east-1"
name_prefix           = "deployment-control-plane"
artifact_bucket_name  = "deployment-control-plane-artifacts"
state_bucket_name     = "deployment-control-plane-tofu-state"
state_lock_table_name = "deployment-control-plane-tofu-locks"

tags = {
  owner              = "platform"
  environment        = "control"
  dataClassification = "internal"
  rollback           = "review-required"
}

public_subnet_cidrs = {
  a = "10.72.0.0/24"
}

private_subnet_cidrs = {
  a = "10.72.10.0/24"
  b = "10.72.11.0/24"
}

availability_zones = {
  a = "us-east-1a"
  b = "us-east-1b"
}

outbound_https_cidrs = {
  infisical       = ["0.0.0.0/0"]
  registry        = ["0.0.0.0/0"]
  reviewed-source = ["0.0.0.0/0"]
  supabase-api    = ["0.0.0.0/0"]
  provider-apis   = ["0.0.0.0/0"]
}
```

Tighten CIDRs once exact provider endpoints or egress controls are available. The important rule is
that egress intent is explicit and reviewed.

For each stack, use the selected region consistently in AWS, Supabase, ECR, EC2, S3, KMS,
PrivateLink, and remote-builder infrastructure. Do not mix regions unless a later reviewed DR plan
explicitly adds cross-region replication.

Run plan/apply from the module directory:

```bash
cd build-tools/deployments/aws-control-plane-foundation/opentofu
tofu init -backend-config=backend.hcl
tofu plan -var-file=account.tfvars -out=foundation.plan
tofu apply foundation.plan
tofu output -json foundation_evidence > aws-foundation-evidence.json
```

Keep the plan file, apply output, and `aws-foundation-evidence.json` with the account setup record.
Raw IaC state is not sufficient cutover evidence by itself; the generated evidence has to be
validated and carried into the control-plane setup bundle.

## Phase 1A: DNS For The Stack Domain

For the first stack, the `example.com` domain is registered through your registrar, and its custom nameservers
currently point away from the new AWS account. Do not use the old AWS account for the new
control-plane setup. Move public DNS authority to the new AWS account by changing the registrar
nameservers at your registrar.

For a later stack, use the selected stack domain and registrar from that stack's config. The same
rules apply: the selected AWS account must become authoritative for the selected public domain, and
the old or unrelated account must not remain in the dependency chain.

For the first stack, use this DNS split:

- Public service URL: `deploy.control.example.com`.
- Public auth callback host: `auth.control.example.com`.
- Private database alias: `db.control.example.com`, only inside a Route 53 private hosted zone
  associated with the new control-plane VPC.

Do not create public DNS records for the PrivateLink database alias. Public internet clients should
not be able to resolve or reach the control-plane database.

Use this public DNS ownership path.

### Move The Selected Domain Authority To The New AWS Account

This is the required path for this setup because the old AWS account must not remain in the
control-plane dependency chain.

1. In the new AWS account, create a public Route 53 hosted zone for the selected domain, `example.com`
   for the first stack.
2. Recreate any public DNS records for that domain that must keep working after the nameserver
   change. Do this before changing registrar nameservers.
3. Record the new zone's four Route 53 nameservers.
4. At the selected registrar, your registrar for the first stack, replace the domain's custom nameservers
   with the four nameservers from the new AWS account's Route 53 hosted zone.
5. In the new AWS account, manage the stack's public service host, auth callback host, certificate
   validation records, and future control-plane public records through OpenTofu.
6. Capture registrar nameserver proof, public hosted-zone proof, public DNS lookup proof, ACM
   validation proof, TLS proof, and ingress health proof as setup evidence.

Do not make the old AWS account part of this setup, even for delegated `control.example.com` DNS.
Inventory any records that must survive the move from public DNS lookups, existing repo records, or
out-of-band exports before changing nameservers. The old AWS account must not remain authoritative
for `example.com`, must not host `control.example.com`, and must not be required for cutover, rollback,
certificate renewal, or future control-plane DNS changes.

For the database alias, create a Route 53 private hosted zone for the stack host suffix, such as
`control.example.com` for the first stack, in the new AWS account and associate it with the
control-plane VPC. Inside that private zone, point the stack's private DB host, such as
`db.control.example.com`, at the Supabase PrivateLink endpoint DNS name or the reviewed internal target
required by the generated PrivateLink evidence. Capture proof from an EC2 host in the VPC that:

- the stack private DB host resolves only on the private VPC path
- the resolved target is the Supabase PrivateLink path
- `psql` reaches the selected Supabase project over TLS
- the public internet cannot resolve or connect to the database alias

## Phase 2: Provision The Repo-Owned ASG Host Path

Use `ec2_host_mode = "repo-owned-asg"` when this repo's narrow EC2 module owns the launch template
and Auto Scaling group. The dedicated module is:

```text
build-tools/deployments/aws-ec2-asg/opentofu
```

Required inputs include reviewed AMI identity, instance type, instance profile ARN, private subnets,
security groups, user-data digest, one service process, and at least two workers.

Do not let user data mutate durable AWS state. User data may install or activate generated host
artifacts only.

`external-reviewed-host` is supported by the broader control-plane design, but it is not the
selected path for this fresh AWS account setup. Use it only if a later reviewed plan moves EC2 ownership
to another IaC stack.

## Phase 3: Prepare Non-AWS Managed Dependencies

Prepare the control-plane database and secret backend before production startup.

Database:

- Use Supabase Postgres over PrivateLink. The runtime database URL must point at the PrivateLink
  endpoint, not the public Supabase database hostname.
- Produce a `supabase-postgres.profile.json` reviewed by the operator.
- Store the reviewed database URL as the mounted credential file
  `/run/deployment-control-plane/credentials/control-plane-database-url`.

Artifact store:

- For AWS S3, use the artifact bucket and IAM evidence from the foundation output.
- Prefer EC2 instance-profile access for AWS-hosted runtime paths when the reviewed foundation
  supports it.
- If using file-backed S3-compatible credentials, write only the filenames required by
  `credential-manifest.json`; do not put secret values in generated profiles.

Secrets:

- Use [Secrets Usage](secrets-usage.md) to choose Vault or Infisical for deployment secrets.
- Use [Credential Staging](control-plane-credential-staging.md) for live control-plane credential
  staging.
- Keep bootstrap credentials outside the backend they unlock.

## Phase 4: Publish And Prove The Control-Plane Image

Build and publish the reviewed Nix-built control-plane image to the selected registry. If the
foundation module manages ECR, use the ECR repository URI from `foundation_evidence.ecr_repository`.

Capture registry inspection evidence as:

```text
image-publication.json
```

Production AWS setup consumes this file with `--image-publication-evidence`. Do not use ad hoc
image and digest flags for the production path.

## Phase 5: Generate The Cloud-Control Profile Bundle

Generate the profile bundle with dry-run first:

```bash
control-plane setup \
  --dry-run \
  --out ./cloud-control-profile \
  --host-mode aws-ec2 \
  --image-publication-evidence ./image-publication.json \
  --runtime-input ./runtime-input.json \
  --supabase-postgres-profile ./supabase-postgres.profile.json \
  --public-url https://deploy.control.example.com \
  --deployment-id control \
  --auth-callback-host auth.control.example.com \
  --artifact-backend aws-s3 \
  --artifact-bucket deployment-control-plane-artifacts \
  --artifact-region us-east-1 \
  --reviewed-source-mode ssh \
  --aws-topology-evidence ./aws-topology-evidence.json \
  --ingress-command-evidence ./ingress-dns-evidence.json,./ingress-tls-evidence.json,./ingress-health-evidence.json,./ingress-callback-evidence.json
```

Resolve every dry-run prerequisite, then rerun without `--dry-run`.

Expected bundle outputs include:

- `config.yaml`
- `credential-manifest.json`
- `commands.json`
- `image-publication.json`
- `conformance-checklist.json`
- `managed-dependencies.profile.yaml`
- `provider-capabilities.json`
- `aws-topology-evidence.json`
- AWS EC2 mode-specific host/profile artifacts

Generated files contain paths and placeholders, not secret values.

## Phase 6: Stage Runtime Config And Credentials

On the selected host or ASG instances, mount:

- generated `config.yaml`
- the credential directory at `/run/deployment-control-plane/credentials`
- reviewed-source credentials, either SSH or GitHub App mode
- deployment-scoped Infisical or Vault credentials
- artifact-store credential files, unless AWS instance-profile mode is used
- persistent records/runtime/artifact staging paths

Production service and worker startup uses the generated runtime config:

```bash
control-plane service \
  --config /etc/deployment-control-plane/config.yaml

control-plane worker \
  --config /etc/deployment-control-plane/config.yaml
```

Do not replace file-backed credentials with ambient environment variables.

## Phase 7: Validate Before Cutover

Run the generated commands from `commands.json` or their documented equivalents:

```bash
control-plane setup-doctor \
  --bundle-dir ./cloud-control-profile \
  --out ./cloud-control-profile/setup-doctor.json

control-plane credential-preflight \
  --bundle-dir ./cloud-control-profile \
  --out ./cloud-control-profile/credential-preflight.json
```

Run live credential staging and keep:

```text
credential-staging.live.json
```

Run managed dependency validation and capture stdout:

```bash
zx-wrapper build-tools/tools/deployments/control-plane-managed-dependencies.ts \
  --profile ./cloud-control-profile/managed-dependencies.profile.yaml \
  --credential-directory /run/deployment-control-plane/credentials \
  --host-profile aws-ec2 \
  --aws-region us-east-1 \
  --source-host-identity i-0abc1234 \
  --source-host-kind aws-ec2 \
  > ./cloud-control-profile/managed-dependency-evidence.json
```

Then start one service process and at least two workers, and run health, readiness, and
worker-heartbeat validation. Do not mark the account protected/shared-ready until every item in
`conformance-checklist.json` passes.

## Phase 8: Cut Over

Use [Cloud Control Cutover](cloud-control-cutover.md) as the cutover authority. Cutover should prove:

- setup doctor passed
- credential preflight passed
- live credential staging evidence exists
- managed dependency evidence exists and is fresh
- image publication evidence matches runtime pull proof
- ingress DNS, TLS, health, and callback evidence are fresh
- provider-capability evidence is attached to the selected AWS topology
- no dashboard-only, raw-IaC-only, support-ticket-only, or placeholder evidence is used

If any check fails, fix the underlying IaC, credential, or evidence path and rerun validation. Do
not bypass the gate.

## Phase 9: Remote Builds, First Pass

Set up remote builds in this order:

1. Nix binary cache and signing/trust model.
2. CI agents with substituters and trusted keys.
3. `NIX_CACHE_TO` for `wheelhouse-preload`.
4. Cache manifest publishing for high-value outputs such as `.#graph-generator`, `.#test-seed`,
   selected graph outputs, wheelhouses, and tool closures.
5. Nix remote builders for Linux lanes.
6. Worker images that contain only host prerequisites plus declared Nix closures.

Current remote-build docs are in
[Remote Builds and Distributed Tests](../build-tools/docs/remote-build-setup.md).

The local conformance sequence is:

```bash
build-tools/tools/remote-exec/render-buckconfig.ts \
  --input build-tools/tools/remote-exec/remote-buckconfig.example.json

build-tools/tools/remote-exec/default-local-policy.ts
```

The rendered Buck config path comes from the input JSON's `artifactDir`; the example input writes
under `buck-out/tmp/remote-exec/example-run`. Also run the Nix remote-builder smoke tool and cache
manifest publisher in dry-run mode for the selected builder/cache policy. Keep the rendered config,
smoke evidence, cache manifest digest, and run summary with the account setup record.

Because `.envrc` intentionally masks remote builders unless `NIX_CONFIG` already contains
`builders =`, CI and smoke lanes must export their intended `NIX_CONFIG` before entering the repo.

## Phase 10: Remote Testing And Buck2 RE

Buck2 remote execution is not enabled by default. The repo has dormant remote execution profiles and
platform wiring, but no committed live Buck2 RE client config is selected as the default profile.

Do not make Buck2 RE the first fresh AWS account milestone. Enable it after:

- Nix cache and remote builders are proven.
- Worker images can realize `packages.<system>.remote-worker-tools`.
- Generated Buck2 RE config is reviewed and not committed as a developer default.
- The default-local policy still proves local developer execution works without RE credentials.
- One remote-only conformance target passes before broad rule-family rollout.
- Buck-native event logs, build reports, command reports, and run summaries are captured.
- Actions marked remote-capable have no undeclared reads, volatile env dependencies, local checkout
  assumptions, or network access during actions.

The first conformance target is:

```text
//build-tools/tools/tests/remote-exec/wrapper-fixtures:zx_ready_handles
```

Treat broader Buck2 RE as the second remote-testing milestone after the initial control-plane launch,
not as a prerequisite for service cutover. It is still part of this top-level setup: finish the
control-plane launch and Nix remote-build path first, then complete Buck2 RE conformance before
declaring the account's remote testing setup complete.

## Final Acceptance Checklist

The account is ready only when all of these are true:

- OpenTofu foundation plan/apply evidence is archived.
- `foundation_evidence` was exported and reviewed.
- EC2 host mode is `repo-owned-asg`.
- No durable AWS resource was created by custom imperative repo AWS API calls.
- `image-publication.json` exists and matches the runtime image digest.
- `runtime-input.json`, `supabase-postgres.profile.json`, and `aws-topology-evidence.json` exist.
- `cloud-control-profile/commands.json` has been followed.
- `setup-doctor.json`, `credential-preflight.json`, `credential-staging.live.json`, and
  `managed-dependency-evidence.json` exist and are fresh.
- Service, readiness, worker-heartbeat, artifact-store, database, ingress, DNS, TLS, and callback
  checks pass.
- `conformance-checklist.json` passes.
- Remote-build cache and Nix-builder smoke evidence exists.
- Buck2 RE remains disabled by default for local developers, but reviewed live Buck2 RE config,
  remote-only conformance evidence, event logs, build reports, command reports, and run summaries
  exist for the remote-testing lane.

## Common Failure Modes

- **Trying to use raw OpenTofu state as cutover evidence.** Export and validate typed evidence
  instead.
- **Using dashboard screenshots or support tickets as proof.** Convert provider facts into typed
  evidence tied to provider capabilities.
- **Starting service/worker with ad hoc env vars.** Use the generated
  `control-plane service --config ...` and
  `control-plane worker --config ...` commands.
- **Publishing an image without registry inspection evidence.** Production setup requires
  `image-publication.json`.
- **Skipping live credential staging.** Protected/shared cutover requires
  `credential-staging.live.json`.
- **Letting `.envrc` hide remote builders during smoke tests.** Export the intended `NIX_CONFIG`
  before entering the repo.
- **Treating Buck2 RE as already enabled.** It is dormant by default; prove Nix cache/builder
  readiness first.
