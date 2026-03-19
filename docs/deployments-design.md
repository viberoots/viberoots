# Deployments Design

This document defines how deployments should fit into this repository.

The design goals are:

- make deployments first-class project-owned targets
- keep Buck2 authoritative for structure, dependency graph, validation, and build artifacts
- keep live deployment side effects outside Buck actions
- support one app, many apps, one provider, or many instances of the same provider
- make simple static-PWA deployment feel trivial without weakening support for more complex systems

## Quick Reference

| Term        | Simple question                              | Meaning                                                  | Example                                      |
| ----------- | -------------------------------------------- | -------------------------------------------------------- | -------------------------------------------- |
| Deployment  | "Which release target are we talking about?" | A named deployable system or environment                 | `pleomino-prod`                              |
| Component   | "What are we shipping?"                      | A deployable project artifact referenced by a deployment | `//projects/apps/pleomino:app`               |
| Provider    | "Where does it live?"                        | The destination platform                                 | `cloudflare-pages`                           |
| Provisioner | "Who sets up the place first?"               | The infra or platform setup step                         | CDKTF creating DNS and a Pages project       |
| Publisher   | "Who releases the built artifact?"           | The artifact upload or publish step                      | `wrangler pages deploy dist`                 |
| Smoke check | "How do we confirm it works?"                | Lightweight post-deploy validation                       | verify `/manifest.webmanifest` returns `200` |

Short version:

- deployment = the named release target
- component = the thing being shipped
- provider = where it runs or is hosted
- provisioner = who prepares the destination
- publisher = who ships the built artifact there
- smoke check = how we confirm it worked

## Why Deployments Need Their Own Model

A deployment is not the same thing as:

- an app
- a library
- a provider account
- a single hosting product

A deployment is a named delivered system. It may represent:

- one static app
- many apps
- one app deployed many different ways
- one environment of a larger system

Examples:

- `pleomino-prod`
- `pleomino-staging`
- `pleomino-acme`
- `acme-platform-prod`

This matters because the same app may be deployed:

- to multiple provider instances
- to staging and production
- as part of a larger multi-component system

So the deployment id should be the identity of the release target, not the app target.

## Repository Layout

Deployments belong under `projects/`, not `build-tools/`, because they are project-owned deliverables.

```text
projects/
  apps/
    pleomino/
    docs-site/
  libs/
    shared-ui/
  deployments/
    pleomino-prod/
      TARGETS
      wrangler.jsonc
    pleomino-staging/
      TARGETS
      wrangler.jsonc
    acme-platform-prod/
      TARGETS
      deploy.ts
      cdktf/
        main.ts
```

The deployment id is the directory name under `projects/deployments/`.

Recommended deployment-id style:

- short
- stable
- environment-oriented
- provider-agnostic when possible

Good examples:

- `pleomino-prod`
- `pleomino-staging`
- `shared-observability-prod`

Less good examples:

- `pleomino-wrangler-prod`
- `pleomino-cloudflare-pages-prod`

Those names leak implementation detail into the identity more than necessary.

I want each deployment package to expose a canonical `:deploy` target:

```text
//projects/deployments/pleomino-prod:deploy
```

That gives us:

- stable naming
- predictable Buck labels
- room for sibling targets later, such as `:check` or `:smoke`

### What Lives In A Deployment Package

A concrete deployment package should stay small and focused.

Typical contents:

- `TARGETS`
  - the authoritative deployment definition
- provider config files
  - for example `wrangler.jsonc`
- optional smoke-check files
  - for example `smoke.ts`
- optional infra entrypoints
  - for example `cdktf/main.ts`

Things that should usually not live here:

- reusable repo-wide deployment logic
  - that belongs in `build-tools`
- reusable system-wide helper macros
  - that belongs under `projects/.../deploy/*.bzl`
- application source code
  - that belongs under `projects/apps/*`

Plain-language version:

- a deployment package should describe one release target, not become a mini framework

## One Source Of Truth

I use `TARGETS` as the authoritative deployment definition.

I do not want a parallel hand-maintained `deployment.json` by default because:

- Buck already gives us naming and dependency structure
- Buck metadata can be queried by repo tooling
- a second manifest risks drift

If we later need a provider-neutral manifest for an external consumer, we should generate it from Buck metadata rather than maintain two sources of truth.

This also means:

- helper macros may reduce repetition
- but `TARGETS` remains the source of truth even when helpers are involved

## Buck's Role

Buck should be authoritative for:

- which deployment units exist
- which project targets a deployment depends on
- validating deployment shape
- building deployment inputs
- exposing deployment metadata to repo tools

Buck should not be the main place where live release side effects happen.

I do not want standard Buck rules to directly perform:

- cloud uploads
- production publishes
- DNS mutations
- credentialed release actions

Those are orchestration concerns, not reproducible build concerns.

This is the key harmony point:

- Buck owns structure, graph, validation, and artifacts
- the deploy CLI owns side effects

## Repo-Level Deploy Command

I want one canonical deploy entrypoint for everything under `projects/deployments/`.

Examples:

```bash
deploy pleomino-prod
deploy pleomino-staging --preview
deploy pleomino-prod --validate-only
deploy pleomino-prod --provision-only
deploy pleomino-prod --publish-only
deploy --from-changes
deploy --list
```

Suggested layout:

```text
build-tools/tools/deploy/deploy.ts
build-tools/tools/deploy/providers/cloudflare-pages.ts
build-tools/tools/deploy/provisioners/cdktf.ts
build-tools/tools/bin/deploy
```

This command should:

1. resolve a deployment id to a Buck deployment target
2. query Buck for deployment metadata
3. validate provider and component rules
4. build referenced Buck targets
5. resolve concrete output paths
6. run optional provisioning
7. run publishing
8. run optional smoke checks

That gives the user one command while keeping the internal responsibilities clear.

### Deployment-Local `deploy.ts` Files

The repo-level `deploy` command should remain the canonical user-facing entrypoint.

If a deployment package contains a local `deploy.ts`, that file should be treated as an internal adapter hook, not as a second public interface users are expected to memorize.

Good pattern:

- user runs `deploy pleomino-prod`
- the repo-level deploy tool resolves the deployment target
- the repo-level deploy tool may delegate one step to a deployment-local script if needed

Plain-language version:

- `build-tools/tools/bin/deploy` is the front door
- deployment-local scripts are allowed, but they are side doors the front door may call

### Why These Flags Exist

These flags are not just convenience syntax. They exist because real deployment workflows often need one slice of the lifecycle without running the whole thing every time.

#### `--validate-only`

Use this when you want to confirm that the deployment definition is sound without making any external changes.

What it is for:

- checking that the deployment target is wired correctly
- confirming provider capability rules
- confirming referenced Buck targets exist
- confirming required config files are present

When you would use it:

- before opening a PR
- while designing a new deployment package
- in CI checks that should never touch real infrastructure
- when debugging deployment metadata or wiring

Example:

```bash
deploy pleomino-prod --validate-only
```

Plain-language version:

- "Tell me whether this deployment is well-formed, but do not build, provision, or publish anything."

#### `--provision-only`

Use this when you want to create or update infrastructure without publishing a new artifact.

What it is for:

- creating a provider project
- creating DNS
- creating a bucket
- updating durable environment configuration

When you would use it:

- first-time environment setup
- rotating infrastructure settings before a later release
- separating infra changes from application release changes
- debugging infra failures without repeatedly uploading the same artifact

Example:

```bash
deploy pleomino-prod --provision-only
```

Plain-language version:

- "Set up the place, but do not release a new build yet."

Why this matters:

- infrastructure changes often need review or stabilization before a release
- infra failures and publish failures are different classes of problems
- you may want to prepare staging or production ahead of time and publish later

Concrete example:

- a new custom domain must be created and validated
- DNS propagation may take time
- you do not want to bundle "wait for DNS" together with "publish the app"

#### `--publish-only`

Use this when the destination is already provisioned and you only want to release the built artifact.

What it is for:

- uploading a fresh static build
- re-running publication after a transient provider-side failure
- promoting the same artifact into an already-prepared environment

When you would use it:

- normal day-to-day static site releases
- retrying after a failed upload
- environments where infra is intentionally managed elsewhere
- environments that were already provisioned in a previous step

Example:

```bash
deploy pleomino-prod --publish-only
```

Plain-language version:

- "The place is already ready; just ship the build."

Why this matters:

- most releases should not need to re-run infra convergence
- publish is often the most common operational path
- keeping it separate makes retries and incident response much cleaner

Concrete example:

- the Cloudflare Pages project already exists
- DNS is already correct
- the previous deploy failed during asset upload
- you want to retry publication without touching infra

#### `--preview`

Use this when the provider supports preview-style releases and you want a non-production publish path.

What it is for:

- preview environments
- branch-style publishes
- "show me the deployed result before production"

When you would use it:

- validating a staging change
- testing a customer-specific deployment safely
- sharing a preview URL with reviewers

Plain-language version:

- "Release this somewhere safe and inspectable, not as the main production publish."

#### `--from-changes`

Use this when you want the tool to select impacted deployments based on repo changes instead of naming each deployment manually.

What it is for:

- selective deploy workflows
- automation after merges
- release tooling that follows the project graph

When you would use it:

- "deploy everything affected by this change-set"
- release automation after merging to main
- large repos where manually tracking affected deployments is error-prone

Plain-language version:

- "Figure out which deployments are impacted, then operate on those."

#### `--list`

Use this when you want visibility into what deployment units exist.

What it is for:

- discoverability
- scripting
- onboarding

Plain-language version:

- "Show me what I can deploy."

### Why The Lifecycle Needs Selective Entry Points

In small systems, it is tempting to treat deployment as one indivisible action.

In practice, that becomes clumsy quickly.

Different parts of the lifecycle fail for different reasons:

- validation may fail because a target label is wrong
- provisioning may fail because DNS or credentials are wrong
- publishing may fail because the provider upload path is temporarily unhealthy
- smoke checks may fail because the release is live but broken

Selective flags make those failure modes easier to isolate.

They also make the workflow more efficient:

- you do not re-run provisioning on every release unless needed
- you can validate deployment wiring in CI without touching live systems
- you can retry publication without redoing setup
- you can prepare infrastructure in one PR and release application changes in another

### Real-World Example: Cloudflare Pages

Suppose `pleomino-prod` uses Cloudflare Pages.

Typical uses:

- `deploy pleomino-prod --validate-only`
  - verify that the deployment package, app target, and Wrangler config are wired correctly
- `deploy pleomino-prod --provision-only`
  - create the Pages project and custom domain configuration if that is repo-owned
- `deploy pleomino-prod --publish-only`
  - upload the latest `dist` to an already-existing Pages project
- `deploy pleomino-prod`
  - run the full lifecycle in order

This is one of the main reasons the model separates:

- deployment definition
- provisioning
- publishing
- smoke validation

The separation is not theoretical. It directly supports cleaner day-to-day operations.

## Core Deployment Model

Each deployment target should define:

- a provider
- one or more components
- an optional provisioner
- a required publisher
- optional smoke-check wiring

Suggested low-level rule shape:

```python
deployment(
    name = "deploy",
    provider = "cloudflare-pages",
    components = [
        {
            "id": "web",
            "kind": "static-webapp",
            "target": "//projects/apps/pleomino:app",
        },
    ],
    provisioner = None,
    publisher = {
        "type": "wrangler-pages",
        "config": "wrangler.jsonc",
    },
    smoke = {
        "entry": "smoke.ts",
    },
)
```

Important design points:

- `components` is plural on purpose
- `provisioner` is optional
- `publisher` is required
- the package path is the deployment id
- provider-specific config should remain explicit

## Concepts

The terms below are similar enough that they can blur together if they are only described abstractly. In practice they answer different questions.

### Deployment

A deployment is the named release target.

It answers:

- what delivered system or environment are we talking about?
- where does it go?
- how is it set up?
- how is it published?

Example:

- `pleomino-prod`

### Component

A component is a deployable project artifact referenced by a deployment.

Examples:

- a static web app
- a docs site
- a worker bundle
- a future service image or runnable target

Each component should declare:

- `id`: stable name inside the deployment
- `kind`: deployable artifact type
- `target`: Buck target that produces or represents the artifact

Example:

```python
components = [
    {
        "id": "web",
        "kind": "static-webapp",
        "target": "//projects/apps/pleomino:app",
    },
]
```

### Provider

A provider is the destination platform family.

Examples:

- `cloudflare-pages`
- `cloudflare-workers-assets`
- `s3-static`
- `netlify`
- `kubernetes`

Plain-language version:

- provider = where this deployment lives

Important distinction:

- the provider is not automatically the same thing as the tool used to deploy to it

Example:

- provider: `cloudflare-pages`
- publishing tool: Wrangler

That is why `provider` and `publisher` should stay separate.

### Provisioner

A provisioner is the optional mechanism that prepares or converges the destination before publication.

Examples:

- `cdktf`
- `terraform`
- none

Plain-language version:

- provisioner = who sets up the place before we ship to it

Provisioning is for durable environment state such as:

- provider projects
- DNS
- domains
- edge configuration
- buckets
- namespaces
- access policies

Examples:

- create or update a Cloudflare Pages project
- create DNS records for a custom domain
- create an S3 bucket and policy
- prepare a Kubernetes namespace and ingress

Provisioners should be idempotent.

That means:

- the first run may create missing resources
- later runs should reconcile or confirm desired state
- a successful earlier deployment should not require changing `provisioner` to `None`

Plain-language version:

- a provisioner is not a one-time bootstrap script
- a provisioner is an ongoing "make reality match this config" step

### When To Use A Provisioner

Use a provisioner when the deployment target needs setup work that should be owned by the deployment workflow.

Good examples:

- "Create the Pages project if it does not exist."
- "Create or update DNS for this domain."
- "Create the bucket and IAM policy before upload."
- "Prepare cluster-side resources before workload rollout."

Do not use a provisioner when:

- the destination already exists
- the only task is uploading the new build
- infrastructure is intentionally managed elsewhere

Simple mental model:

- provisioner = "set up the house"
- publisher = "move the new furniture in"

### Why Provisioner Is Optional

Some deployments are just "upload the built files."

Example:

- provider: `cloudflare-pages`
- provisioner: none
- publisher: `wrangler-pages`

That is a perfectly valid deployment.

### Concrete Provisioner Examples

The examples below are intentionally simple and repetitive. The goal is to make it obvious what provisioning looks like in real use.

#### Example: Cloudflare Pages Project And Domain Are Repo-Owned

```python
deployment(
    name = "deploy",
    provider = "cloudflare-pages",
    components = [
        {
            "id": "web",
            "kind": "static-webapp",
            "target": "//projects/apps/pleomino:app",
        },
    ],
    provisioner = {
        "type": "cdktf",
        "entry": "cdktf/main.ts",
    },
    publisher = {
        "type": "wrangler-pages",
        "config": "wrangler.jsonc",
    },
)
```

What this means in plain language:

- CDKTF creates or updates the Cloudflare Pages project
- CDKTF creates or updates DNS and domain configuration
- after that, Wrangler uploads the built app

Why you would want this:

- the repo owns the environment setup
- new environments should be reproducible
- a new teammate should not have to click around in the Cloudflare dashboard by hand
- later runs can confirm the environment still matches what the repo expects

#### Example: S3 Static Site With Bucket Setup

```python
deployment(
    name = "deploy",
    provider = "s3-static",
    components = [
        {
            "id": "web",
            "kind": "static-webapp",
            "target": "//projects/apps/docs-site:app",
        },
    ],
    provisioner = {
        "type": "terraform",
        "entry": "terraform/main.tf",
    },
    publisher = {
        "type": "aws-s3-sync",
        "entry": "deploy.ts",
    },
)
```

What this means in plain language:

- Terraform creates the bucket and its access policy
- Terraform may also create CDN or domain wiring
- the publisher then uploads the built files into that bucket

Why you would want this:

- the site cannot be published until the bucket exists
- bucket and policy setup should be owned and reviewed as code
- release engineers should not have to guess whether the destination exists yet
- later runs should keep setup reconciled without changing the deployment definition

#### Example: Kubernetes Service With Namespace And Ingress Setup

```python
deployment(
    name = "deploy",
    provider = "kubernetes",
    components = [
        {
            "id": "api",
            "kind": "service",
            "target": "//projects/apps/api:image",
        },
    ],
    provisioner = {
        "type": "cdktf",
        "entry": "cdktf/main.ts",
    },
    publisher = {
        "type": "helm",
        "entry": "deploy.ts",
    },
)
```

What this means in plain language:

- CDKTF prepares namespace, ingress, secrets references, or related cluster wiring
- Helm publishes the actual service release

Why you would want this:

- service rollout and cluster setup are different concerns
- the app should not try to start before the cluster-side setup exists
- infra changes can be reviewed separately from release changes
- repeated deploys should keep the namespace and ingress aligned with desired state

#### Example: Shared Observability Deployment With Platform Setup

```python
deployment(
    name = "deploy",
    provider = "kubernetes",
    components = [
        {
            "id": "otel-collector",
            "kind": "third-party-service",
            "target": "//projects/observability/otel-collector:image",
        },
    ],
    provisioner = {
        "type": "terraform",
        "entry": "terraform/main.tf",
    },
    publisher = {
        "type": "helm",
        "entry": "deploy.ts",
    },
)
```

What this means in plain language:

- Terraform prepares shared observability infrastructure such as namespaces, service accounts, or storage
- Helm rolls out the collector itself

Why you would want this:

- shared platform services usually need real environment setup
- the release artifact is only one part of the overall deployment
- the environment setup should remain owned over time, not just on the first run

### Dumbed-Down Rule For Provisioners

If the deployment answer to this question is "yes," you probably want a non-`None` provisioner:

- "Before we ship the build, do we need to create or update the place it is going?"

If the answer is "no," `provisioner = None` is probably correct.

Examples where the answer is "yes":

- "We need to create the Pages project."
- "We need to create the bucket."
- "We need to wire DNS."
- "We need to prepare the namespace and ingress."

Examples where the answer is "no":

- "The Pages project already exists; just upload the new build."
- "The bucket already exists; just sync files."
- "Infra is managed somewhere else; this repo only publishes the artifact."

### Provisioner Ownership Over Time

If a deployment includes a provisioner, that means the deployment owns setup of the destination over time.

It does not mean:

- "run setup once and then remove the provisioner"

It does mean:

- "this deployment is responsible for keeping setup reconciled"

So:

- keep `provisioner = {...}` if the repo owns environment setup
- use `provisioner = None` only when setup is intentionally out of scope for this deployment

Examples:

- Cloudflare Pages project created and managed by this repo
  - keep the provisioner
- S3 bucket and policy managed by this repo
  - keep the provisioner
- bucket managed by another team or another repo
  - use `provisioner = None`

This is one of the reasons `--publish-only` exists.

If the deployment has a provisioner but you do not want to run provisioning on a particular release, you can use:

```bash
deploy pleomino-prod --publish-only
```

That is an operational choice for one run.

It is not a reason to edit the deployment definition.

### Common Deployment Shapes

This table is meant to be a fast pattern-matching aid.

| Shape                                   | Provider                            | Provisioner            | Publisher           | Typical use case                                                          |
| --------------------------------------- | ----------------------------------- | ---------------------- | ------------------- | ------------------------------------------------------------------------- |
| Existing Cloudflare Pages project       | `cloudflare-pages`                  | `None`                 | `wrangler-pages`    | Normal static-site or PWA releases where the Pages project already exists |
| Repo-owned Cloudflare Pages environment | `cloudflare-pages`                  | `cdktf` or `terraform` | `wrangler-pages`    | Create or update the Pages project and DNS, then publish the app          |
| Existing S3 static site                 | `s3-static`                         | `None`                 | `aws-s3-sync`       | Upload a new build to an already-prepared bucket                          |
| Repo-owned S3 static site               | `s3-static`                         | `terraform`            | `aws-s3-sync`       | Create bucket, policy, and CDN wiring, then upload the build              |
| Kubernetes service rollout              | `kubernetes`                        | `cdktf` or `terraform` | `helm` or `kubectl` | Prepare namespace and ingress, then release app workloads                 |
| Shared observability stack              | `kubernetes`                        | `terraform` or `cdktf` | `helm`              | Roll out shared collectors, agents, or platform monitoring services       |
| External vendor dependency              | not usually modeled as a deployment | usually none           | none                | A service we depend on but do not deploy from this repo                   |

Plain-language reading guide:

- if `Provisioner` is `None`, the destination is assumed to already exist
- if `Provisioner` is present, the repo is helping create or update the destination
- `Publisher` is the part that releases the built artifact

Important note:

- if something has no publisher and no repo-owned release step, it is usually not a deployment target in this repo at all
- it is usually just an external dependency that our deployments point at

### Publisher

A publisher is the mechanism that publishes the built artifact to the provider.

Examples:

- `wrangler-pages`
- `wrangler-workers-assets`
- `aws-s3-sync`
- `rsync`
- a future Helm- or kubectl-based publisher

Plain-language version:

- publisher = who takes the finished artifact and releases it

Publishing is for artifact movement and release activation:

- upload static assets
- create a release
- flip a preview or production publish

Examples:

- `wrangler pages deploy dist`
- `aws s3 sync dist s3://my-bucket`

### Smoke Check

A smoke check is a lightweight post-publish validation step.

Examples:

- verify the expected domain responds with `200`
- verify `/manifest.webmanifest` is reachable
- verify the PWA shell loads
- verify a known route returns the expected content

Plain-language version:

- smoke check = "did the deployment actually work?"

## Why Provider, Provisioner, And Publisher Must Stay Separate

If we collapse these into one vague "deploy config" concept, we lose important information:

- whether the destination already exists
- whether infra should be created or updated
- whether artifact upload uses a different tool
- whether a failure happened during setup or release

Those distinctions matter in both implementation and troubleshooting.

Examples of clearer failure modes:

- "Provisioning failed: DNS record could not be created."
- "Publish failed: Wrangler could not upload the built assets."

Those are both deployment failures, but they are not the same kind of failure.

## Real-World Scenarios

### Scenario 1: Cloudflare Pages Static App, Existing Project

You already created the Pages project manually.

Model:

- provider: `cloudflare-pages`
- component: one static web app
- provisioner: none
- publisher: Wrangler uploads `dist`

Why the split matters:

- there is no setup step
- deployment is just publication

### Scenario 2: Cloudflare Pages Static App, Repo Owns Setup Too

You want the repo to ensure the Pages project and DNS are present.

Model:

- provider: `cloudflare-pages`
- component: one static web app
- provisioner: CDKTF or Terraform
- publisher: Wrangler

Why the split matters:

- CDKTF or Terraform is good at durable config
- Wrangler is often the best artifact publication path

### Scenario 3: S3 Static Site

You host a static site in S3, possibly with a CDN in front of it.

Model:

- provider: `s3-static`
- component: one static web app
- provisioner: Terraform creates bucket, policy, domain wiring
- publisher: `aws s3 sync`

Why the split matters:

- bucket and IAM setup are long-lived infra
- file upload is a separate operational step

### Scenario 4: Kubernetes Multi-Service System

You deploy a frontend, an API, and a worker.

Model:

- provider: `kubernetes`
- components: several deployable artifacts
- provisioner: Terraform or CDKTF prepares cluster-side resources
- publisher: Helm or kubectl updates workloads

Why the split matters:

- infra changes and release changes happen at different cadences
- different tools are usually best for those jobs

### Scenario 5: One Tool Does Both

Some future provider may use one tool for both setup and release.

That is still fine.

Example:

- provider: future platform
- provisioner: `platform-cli`
- publisher: `platform-cli`

The concepts remain separate even if the implementation uses the same tool for both.

## Onboarding Checklist: How To Model A New Deployment

If I were onboarding a junior engineer, this is the checklist I would want them to follow.

### Step 1: Is This Actually A Deployment We Own?

Ask:

- are we releasing something from this repo?

If the answer is no, stop here.

Examples:

- a hosted vendor telemetry backend we only send data to
- an externally managed SaaS dependency

Those are usually not deployment targets in this repo.

### Step 2: What Is The Deployment Id?

Choose the named release target.

Examples:

- `pleomino-prod`
- `pleomino-staging`
- `shared-observability-prod`

Create:

```text
projects/deployments/<deployment-id>/
```

### Step 3: What Is The Provider?

Ask:

- where is this thing going?

Examples:

- Cloudflare Pages
- S3
- Kubernetes

Set the `provider` accordingly.

### Step 4: What Are The Components?

Ask:

- what artifacts are we actually shipping from this repo?

Examples:

- one static app
- one API image
- one docs site
- one sidecar that must roll out with the service

If it ships with this deployment, it is probably a component.

### Step 5: Do We Need A Provisioner?

Ask:

- before we publish, do we need to create or update the place this is going?

If yes, add a `provisioner`.

Examples:

- create a Pages project
- create DNS
- create a bucket
- prepare namespace and ingress

If no, set `provisioner = None`.

Examples:

- Pages project already exists
- bucket already exists
- infra is managed elsewhere

### Step 6: What Publishes The Artifact?

Ask:

- what tool actually sends the built artifact to the provider?

Examples:

- Wrangler
- `aws s3 sync`
- Helm
- kubectl

That becomes the `publisher`.

### Step 7: Is This A Shared Platform Deployment Instead?

Ask:

- is this thing shared across many systems and managed independently?

If yes, it may deserve its own deployment package instead of being hidden inside an app deployment.

Examples:

- shared observability stack
- shared ingress deployment
- shared telemetry collectors

### Step 8: Should I Use A Helper Macro?

Ask:

- is this deployment shape repeated enough to deserve an abstraction?

If yes:

- put generic helpers in `build-tools`
- put system-specific helpers under `projects`

If no:

- use the low-level `deployment(...)` primitive directly

## Fast Decision Tree

This is the shortest practical classification guide in the document.

Ask these questions in order:

1. Are we releasing something from this repo?
   - If no, it is probably not a deployment target here.
2. Does it ship with this deployment?
   - If yes, it is probably a component.
3. Does the destination need setup before release?
   - If yes, add a provisioner.
4. Is it shared across many systems?
   - If yes, consider making it its own deployment.
5. Is this pattern repeated often?
   - If yes, consider a helper macro.

## Single-Component Example: Cloudflare Pages Static PWA

```python
load("//build-tools/deploy:defs.bzl", "deployment")

deployment(
    name = "deploy",
    provider = "cloudflare-pages",
    components = [
        {
            "id": "web",
            "kind": "static-webapp",
            "target": "//projects/apps/pleomino:app",
        },
    ],
    publisher = {
        "type": "wrangler-pages",
        "config": "wrangler.jsonc",
    },
)
```

Suggested package files:

```text
projects/deployments/pleomino-prod/
  TARGETS
  wrangler.jsonc
```

Suggested `wrangler.jsonc`:

```jsonc
{
  "$schema": "../../node_modules/wrangler/config-schema.json",
  "name": "pleomino-prod",
  "pages_build_output_dir": "./dist",
  "compatibility_date": "2026-03-18",
}
```

Publish flow:

1. Buck builds `//projects/apps/pleomino:app`
2. the deploy tool resolves the built `dist`
3. the publisher uploads `dist` to Cloudflare Pages

## Multi-Instance Example: Same App, Same Provider

```text
projects/deployments/
  pleomino-prod/
  pleomino-staging/
  pleomino-acme/
```

Each deployment may point to the same app target while differing in:

- Cloudflare project name
- branch
- domain
- smoke checks
- provisioning behavior

The deployment id, not the app target, is what gives each release target its identity.

## Multi-Component Example

A deployment may represent a delivered system, not just one app.

Example:

```python
deployment(
    name = "deploy",
    provider = "custom-platform",
    components = [
        {
            "id": "marketing",
            "kind": "static-webapp",
            "target": "//projects/apps/marketing-site:app",
        },
        {
            "id": "docs",
            "kind": "static-webapp",
            "target": "//projects/apps/docs-site:app",
        },
    ],
    publisher = {
        "type": "custom",
        "entry": "deploy.ts",
    },
)
```

The model allows many components, but each provider adapter may restrict what it supports.

Examples:

- `cloudflare-pages` v1 may require exactly one `static-webapp` component
- a future `kubernetes` adapter may allow many components

That keeps the model future-proof without forcing every provider to support every topology immediately.

## Provider Capability Rules

The deployment macro and deploy CLI should validate provider-specific capability rules before publication begins.

Examples:

- `cloudflare-pages`
  - exactly one component
  - component kind must be `static-webapp`
- `cloudflare-workers-assets`
  - one static web component plus optional worker-specific config
- `kubernetes`
  - many components may be allowed

## Deployment Lifecycle

Every deployment should follow the same high-level lifecycle:

1. `validate`
2. `build`
3. `resolve`
4. `provision`
5. `publish`
6. `smoke`

### Validate

Check:

- deployment target shape
- provider value
- component list
- referenced targets exist
- provider capability rules
- required config files exist

### Build

Use Buck to build referenced component targets.

Buck remains authoritative here.

### Resolve

Resolve concrete output paths from built targets.

This is the bridge between Buck artifact labels and provider-specific publisher tools.

### Provision

Run optional infrastructure convergence.

Examples:

- `cdktf deploy`
- `terraform apply`

### Publish

Run the provider-specific artifact release step.

Examples:

- `wrangler pages deploy`
- `wrangler deploy`
- `aws s3 sync`

### Smoke

Run lightweight post-publish validation.

Examples:

- verify expected URL returns `200`
- verify PWA shell and manifest are reachable
- verify known route content

## Buck Metadata Extraction

The deploy CLI should query Buck for deployment metadata rather than maintain a second handwritten manifest.

The deployment rule should expose enough metadata for repo tooling to retrieve:

- provider
- component list
- provisioner config
- publisher config
- package path

The exact extraction mechanism can be decided during implementation. The design goal is simple:

- define once in `TARGETS`
- consume from Buck

## Higher-Level Deployment Helpers

Higher-level deployment helpers do make sense, but they should sit on top of the low-level primitive rather than replace it.

The right pattern is:

- `deployment(...)` is the canonical low-level primitive
- helpers reduce repetition for common shapes
- helpers should keep important facts visible

Good use cases:

- "single static PWA to Cloudflare Pages"
- "same app deployed to prod, staging, and customer-specific Pages projects"
- "frontend plus docs site deployed together"
- "all puzzle-game deployments use the same smoke checks"

Bad abstraction:

```python
smart_deployment(name = "prod")
```

This hides too much.

Better abstraction:

```python
cloudflare_static_pwa_deployment(
    name = "deploy",
    app_target = "//projects/apps/pleomino:app",
    wrangler_config = "wrangler.jsonc",
)
```

This is concise, but the important concepts remain visible.

## Where Helpers Should Live

Not all deployment helpers belong in `build-tools`.

There are two useful kinds of reusable deployment logic:

1. repo-wide or provider-wide helpers
2. system-specific or product-family-specific helpers

These should live in different places.

### Repo-Wide And Provider-Wide Helpers

Put helpers in `build-tools` when they are generic across many unrelated projects.

Examples:

- `deployment(...)`
- `cloudflare_static_pwa_deployment(...)`
- a future `single_component_deployment(...)`

Suggested layout:

```text
build-tools/
  deploy/
    defs.bzl
    cloudflare.bzl
    static_webapp.bzl
```

### System-Specific Or Product-Family Helpers

Put helpers under `projects/` when they encode conventions owned by one system, team, or product family.

Examples:

- all Pleomino deployments use the same smoke checks
- all puzzle-game deployments use the same domain conventions
- all customer-branded deployments include an extra docs component

These are not build-system truths. They are project-owned patterns.

Reasonable layouts:

```text
projects/
  deployment-kits/
    puzzle-apps/
      defs.bzl
```

```text
projects/
  systems/
    pleomino/
      deploy/
        defs.bzl
```

```text
projects/
  apps/
    pleomino/
      deploy/
        defs.bzl
```

If a helper is shared by multiple related deployments, I prefer a clearly shared path under `projects/` rather than burying it inside one app package.

Plain-language rule:

- if the helper makes sense for almost any project in the repo, it belongs in `build-tools`
- if the helper mainly reflects one system's conventions, it belongs under `projects`

## Three-Layer Model

The cleanest long-term model is:

1. build-system deployment primitives
2. project-owned deployment helpers
3. concrete deployment instances

### Layer 1: Build-System Primitives

Location:

```text
build-tools/deploy/*
```

Responsibilities:

- define the canonical low-level primitive
- define provider-wide abstractions
- define provider capability rules

### Layer 2: Project-Owned Helpers

Location:

```text
projects/.../deploy/*.bzl
```

Responsibilities:

- encode system-specific conventions
- reduce repetition among related deployments
- stay close to product ownership

### Layer 3: Concrete Deployment Instances

Location:

```text
projects/deployments/<deployment-id>/
```

Responsibilities:

- represent one named deployment unit
- own provider config files
- call either the primitive or an appropriate helper in `TARGETS`

This is the layering that keeps the build system powerful without forcing product-specific conventions into `build-tools`.

## Example: Generic Helper In `build-tools`

Suppose many unrelated projects need the same "one static app to Cloudflare Pages" pattern.

That belongs in `build-tools`.

```python
load("//build-tools/deploy:defs.bzl", "deployment")

def cloudflare_static_pwa_deployment(name, app_target, wrangler_config, provisioner = None):
    deployment(
        name = name,
        provider = "cloudflare-pages",
        components = [
            {
                "id": "web",
                "kind": "static-webapp",
                "target": app_target,
            },
        ],
        provisioner = provisioner,
        publisher = {
            "type": "wrangler-pages",
            "config": wrangler_config,
        },
    )
```

Use in a deployment package:

```python
load("//build-tools/deploy:cloudflare.bzl", "cloudflare_static_pwa_deployment")

cloudflare_static_pwa_deployment(
    name = "deploy",
    app_target = "//projects/apps/pleomino:app",
    wrangler_config = "wrangler.jsonc",
)
```

## Example: Project-Owned Helper Under `projects`

Suppose all puzzle-app deployments have the same smoke checks and naming conventions.

That belongs under `projects`, not `build-tools`.

Layout:

```text
projects/
  deployment-kits/
    puzzle-apps/
      defs.bzl
```

Helper:

```python
load("//build-tools/deploy:cloudflare.bzl", "cloudflare_static_pwa_deployment")

def puzzle_cloudflare_deployment(name, app_target, wrangler_config, provisioner = None):
    cloudflare_static_pwa_deployment(
        name = name,
        app_target = app_target,
        wrangler_config = wrangler_config,
        provisioner = provisioner,
    )
```

Concrete deployment:

```python
load("//projects/deployment-kits/puzzle-apps:defs.bzl", "puzzle_cloudflare_deployment")

puzzle_cloudflare_deployment(
    name = "deploy",
    app_target = "//projects/apps/pleomino:app",
    wrangler_config = "wrangler.jsonc",
)
```

## Example End-To-End Story

Suppose we want:

- a generic Cloudflare Pages helper
- a puzzle-specific wrapper
- one concrete Pleomino production deployment

### Step 1: Generic Helper

`build-tools/deploy/cloudflare.bzl` defines:

- `cloudflare_static_pwa_deployment(...)`

It knows:

- provider is `cloudflare-pages`
- publisher is Wrangler
- component kind should be `static-webapp`

It does not know anything about Pleomino.

### Step 2: Puzzle-Specific Helper

`projects/deployment-kits/puzzle-apps/defs.bzl` defines:

- `puzzle_cloudflare_deployment(...)`

It knows:

- use the generic Cloudflare helper
- apply puzzle-family conventions

It does not know about one specific deployment id such as `pleomino-prod`.

### Step 3: Concrete Deployment Package

```text
projects/deployments/pleomino-prod/
  TARGETS
  wrangler.jsonc
```

Its `TARGETS` is:

```python
load("//projects/deployment-kits/puzzle-apps:defs.bzl", "puzzle_cloudflare_deployment")

puzzle_cloudflare_deployment(
    name = "deploy",
    app_target = "//projects/apps/pleomino:app",
    wrangler_config = "wrangler.jsonc",
)
```

Now the ownership boundaries are clean:

- `build-tools` owns generic deployment machinery
- `projects/deployment-kits/puzzle-apps` owns puzzle-family conventions
- `projects/deployments/pleomino-prod` owns the concrete release target

## Third-Party Infrastructure And Sidecars

Third-party infrastructure fits into this design naturally, but it is important not to force every third-party thing into the same bucket.

The key question is:

- is this thing part of the deployed system?
- or is it shared setup that the system depends on?

That distinction determines where it belongs in the model.

### Plain-Language Rule

Ask:

- "Are we shipping this thing together with this deployment?"
  - If yes, it is probably a component.
- "Does this thing need to exist before the deployment can work, but it is not really part of the app release?"
  - If yes, it is probably provisioning or shared platform infrastructure.
- "Is this thing shared across many deployments and managed on its own lifecycle?"
  - If yes, it should probably be its own deployment unit.

### Why This Matters

If we treat every third-party system as "just another app component," we blur important ownership boundaries.

Examples of things that behave very differently:

- a sidecar that should roll out with one service
- a shared OpenTelemetry collector used by many systems
- a hosted vendor backend that no one in this repo should try to create

Those should not all be modeled the same way.

## Three Common Buckets For Third-Party Infrastructure

### 1. Third-Party Component

This is a third-party thing that is part of the deployed system itself.

Examples:

- an OpenTelemetry collector sidecar
- a reverse proxy container deployed with the service
- a metrics exporter container rolled out beside the app
- a vendor agent that runs in the same workload

Plain-language version:

- this thing ships with the system
- when the system rolls out, this thing rolls out too

This belongs in `components`.

Example:

```python
deployment(
    name = "deploy",
    provider = "kubernetes",
    components = [
        {
            "id": "api",
            "kind": "service",
            "target": "//projects/apps/api:image",
        },
        {
            "id": "otel-sidecar",
            "kind": "third-party-service",
            "target": "//projects/observability/otel-sidecar:image",
        },
    ],
    publisher = {
        "type": "helm",
        "entry": "deploy.ts",
    },
)
```

What this means:

- the API and the OpenTelemetry sidecar are part of the same delivered system
- publishing this deployment should release both together

### 2. Provisioned Dependency

This is something the deployment needs, but it is not really part of the app release itself.

Examples:

- a Cloudflare Pages project
- DNS records
- a bucket and its policy
- a hosted telemetry backend endpoint
- cluster namespace and ingress setup

Plain-language version:

- this thing must exist before the app can be released
- but it is not one of the shipped components

This belongs in the `provisioner` layer.

Example:

```python
deployment(
    name = "deploy",
    provider = "cloudflare-pages",
    components = [
        {
            "id": "web",
            "kind": "static-webapp",
            "target": "//projects/apps/pleomino:app",
        },
    ],
    provisioner = {
        "type": "cdktf",
        "entry": "cdktf/main.ts",
    },
    publisher = {
        "type": "wrangler-pages",
        "config": "wrangler.jsonc",
    },
)
```

What this means:

- the static web app is the deployed component
- the Pages project and domain wiring are setup concerns
- provisioning prepares the destination
- publishing releases the built app

### 3. Shared Platform Deployment

This is a third-party or platform capability that is shared across many systems and has its own lifecycle.

Examples:

- a shared OpenTelemetry collector deployment
- a shared observability stack
- shared ingress infrastructure
- shared metrics or logging agents installed cluster-wide

Plain-language version:

- this thing is important, but it should not be re-owned by every app deployment
- it is a platform deployment in its own right

This should usually be its own deployment package under `projects/deployments/*`.

Example layout:

```text
projects/
  deployments/
    shared-observability-prod/
      TARGETS
    pleomino-prod/
      TARGETS
    docs-prod/
      TARGETS
```

What this means:

- `shared-observability-prod` owns rollout of the shared observability stack
- `pleomino-prod` depends on that environment conceptually, but does not redeploy it every time

This is often cleaner than stuffing shared platform services into each application deployment.

## Dumbed-Down Examples

### Example 1: OpenTelemetry Sidecar Beside One Service

Suppose we have one API service and we want an OpenTelemetry collector to run beside it in the same Kubernetes deployment.

What are we really doing?

- shipping the API
- shipping the sidecar with it

That means the collector is part of the deployed system.

So it belongs in `components`.

Plain-language version:

- "When I roll out this service, I also want that telemetry sidecar to roll out."

### Example 2: Shared Cluster-Wide OpenTelemetry Collector

Suppose there is one shared collector that all applications in the cluster send data to.

What are we really doing?

- maintaining shared platform infrastructure
- not re-releasing that collector with every app deploy

That means it should probably be a separate deployment.

Plain-language version:

- "This is part of the platform, not part of one app release."

So it belongs in something like:

```text
projects/deployments/shared-observability-prod/
```

### Example 3: Hosted Vendor Service We Only Point At

Suppose we use a hosted telemetry backend from a vendor. We do not create it from this repo; we just configure the app to send data there.

What are we really doing?

- relying on an external service
- not deploying that service from this repo

That means it is not a component and not a publisher concern.

It may be:

- an external prerequisite described in docs
- or a provisioning concern if the repo owns some related local configuration such as secrets or DNS

Plain-language version:

- "We depend on it, but we are not shipping it from here."

### Example 4: Static App Plus Shared Monitoring

Suppose `pleomino-prod` is a Cloudflare Pages deployment, and the organization also has shared monitoring and alerts managed elsewhere.

What belongs in `pleomino-prod`?

- the static app component
- maybe provisioning of the Pages project and domain
- maybe smoke checks against the app's URL

What probably does not belong in `pleomino-prod`?

- a whole shared observability system reused by many deployments

Plain-language version:

- "Pleomino owns shipping Pleomino. It should not secretly become the owner of shared company monitoring."

## How To Decide Where A Third-Party Thing Belongs

This is the practical checklist I would use.

### Put It In `components` When

- it ships with this deployment
- it should roll out together with the app or system
- it is part of the delivered runtime shape

Good examples:

- sidecars
- support containers
- colocated exporters
- workload-local vendor agents

### Put It In `provisioner` When

- it is setup that must exist before publication
- it is environment configuration rather than a release artifact
- it is durable platform state

Good examples:

- DNS
- buckets
- domains
- provider projects
- namespaces
- access policy setup

### Put It In Its Own Deployment When

- it is shared across many systems
- it has an independent lifecycle
- it should be reviewed and rolled out separately
- many apps depend on it, but no single app should own it

Good examples:

- shared observability stack
- shared ingress deployment
- shared telemetry collectors
- shared platform monitoring agents

## What About `third_party/`?

The deployment definition should still live under `projects/`, even if the software being deployed is third-party.

Why:

- `third_party/` in this repo is primarily about external dependency metadata and provider wiring
- deployment ownership is a project concern
- the question is not "who wrote the software?"
- the question is "who owns deploying it here?"

So even for third-party infrastructure:

- deployment definitions belong under `projects/deployments/*`
- project-owned deployment helper macros belong under `projects/.../deploy/*.bzl` if they are system-specific

## Example: Shared Observability Deployment

Here is one plausible shape:

```text
projects/
  deployments/
    shared-observability-prod/
      TARGETS
      deploy.ts
    pleomino-prod/
      TARGETS
      wrangler.jsonc
```

Possible `shared-observability-prod/TARGETS`:

```python
load("//build-tools/deploy:defs.bzl", "deployment")

deployment(
    name = "deploy",
    provider = "kubernetes",
    components = [
        {
            "id": "otel-collector",
            "kind": "third-party-service",
            "target": "//projects/observability/otel-collector:image",
        },
        {
            "id": "metrics-agent",
            "kind": "third-party-service",
            "target": "//projects/observability/metrics-agent:image",
        },
    ],
    publisher = {
        "type": "helm",
        "entry": "deploy.ts",
    },
)
```

What this means:

- observability is treated as a real deployment target
- it can be reviewed, validated, and released on its own
- app deployments do not have to re-own it

## Why This Fits The Overall Design

This model works because deployments are defined as delivered systems, not just apps.

That gives us a clean place for:

- app-local third-party runtime pieces
- environment setup
- shared platform infrastructure

Without this separation, a deployment design tends to collapse into one of two bad extremes:

- everything is forced into "apps"
- or everything gets shoved into a vague pile of infrastructure

This design avoids both.

## Why This Fits A Powerful Buck-Based Repo

This design keeps Buck central without forcing Buck to do the wrong job.

Buck remains the authority for:

- deployment definitions
- deployment dependencies
- artifact builds
- validation
- graph reasoning

The deploy CLI owns:

- side effects
- provider tool invocation
- release orchestration

The helper layering keeps abstraction honest:

- generic logic in `build-tools`
- project conventions in `projects`
- concrete instances in `projects/deployments`

That is the right shape for a complex but disciplined build system.

## Static PWA Outcome

For a static PWA, the final developer experience should be simple:

```bash
deploy pleomino-prod
```

Under the hood that may still mean:

1. Buck builds `//projects/apps/pleomino:app`
2. the deploy tool resolves the built `dist`
3. the publisher uploads it to Cloudflare Pages
4. optional smoke checks run

The user should not need to think about that wiring.

## Initial Recommendation

Implement this in phases:

1. add a `deployment(...)` primitive and the `projects/deployments/*` package convention
2. add the repo-level `deploy` zx TypeScript command
3. implement `cloudflare-pages` publisher support for one `static-webapp` component
4. optionally add `cdktf` provisioner support
5. add impact analysis and `deploy --from-changes`
6. add higher-level helpers where repetition proves they are useful

That gives us an elegant deployment model now without blocking more complex systems later.
