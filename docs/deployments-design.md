# Deployments Design

This document defines how deployments should fit into this repository.

The design goals are:

- make deployments first-class project-owned targets
- keep Buck2 authoritative for structure, dependency graph, validation, and build artifacts
- keep live deployment side effects outside Buck actions
- support one app, many apps, one provider, or many instances of the same provider
- make simple static-PWA deployment feel trivial without weakening support for more complex systems

This document is a design for the intended deployment model, not a claim that every part is already implemented.

The key promise of this document should be:

- you can tell what belongs in a deployment package
- you can tell which tool owns which part of the lifecycle
- you can model a new deployment without guessing where concepts belong
- you can understand what `deploy <deployment-id>` is expected to do end to end

This document tries to answer three different questions at once:

- what the deployment model is
- what operator-facing behavior the repo should guarantee
- what choices are still implementation details

When those three get mixed together, onboarding gets muddy. So throughout this doc:

- "contract" means behavior callers should be able to rely on
- "example" means an illustration, not a mandatory implementation detail
- "not fixed yet" means the model is decided, but some operational policy is still open

## Quick Reference

| Term        | Simple question                              | Meaning                                                  | Example                                      |
| ----------- | -------------------------------------------- | -------------------------------------------------------- | -------------------------------------------- |
| Deployment  | "Which release target are we talking about?" | A named deployable system or environment                 | `pleomino-prod`                              |
| Component   | "What are we shipping?"                      | A deployable project artifact referenced by a deployment | `//projects/apps/pleomino:app`               |
| Provider    | "Where does it live?"                        | The destination platform                                 | `cloudflare-pages`                           |
| Provisioner | "Who sets up the place first?"               | The infra or platform setup step                         | CDKTF creating DNS and a Pages project       |
| Publisher   | "Who releases the built artifact?"           | The artifact upload or publish step                      | `wrangler pages deploy <resolved-dist>`      |
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

Preference rule:

- provider config should contain only provider-native settings that are not already modeled authoritatively in deployment metadata
- if a provider-native file needs values such as provider project name or environment-specific identifiers, those should ideally be generated from or injected by deployment metadata rather than hand-maintained in multiple places

Path rule:

- any file path referenced from deployment metadata should be interpreted relative to that deployment package unless explicitly documented otherwise
- for example, `wrangler.jsonc`, `smoke.ts`, and `cdktf/main.ts` all resolve from `projects/deployments/<deployment-id>/`

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

For protected or shared environments, the canonical `deploy` CLI should still be the front door, but that
front door should submit or hand off mutating work to the shared control plane rather than performing
provider-side mutation directly from an arbitrary local machine.

Shared-control-plane trust boundary:

- protected or shared-environment credentials must be used only by vetted shared adapter or provisioner code running in the shared control plane
- deployment-local hooks, repo-authored per-deployment scripts, or equivalent arbitrary package-local code must not run with protected/shared credentials in the shared control plane
- deployment-local hooks may still be allowed for local workflows or explicitly isolated preview/local targets where those credentials and side effects are not shared-environment sensitive
- if an implementation needs any exception to that rule, it should require explicit sandboxing, allowlisting, and separate policy review rather than silently reusing the normal control-plane path

Protected/shared extension model:

- protected or shared-environment mutation may execute only vetted built-in adapter, provisioner, and smoke-runner code in the shared control plane
- deployment-local `deploy.ts`, deployment-local provisioner entrypoints, deployment-local smoke entrypoints, or equivalent package-local executable hooks are not part of the normal protected/shared execution model
- those deployment-local hooks remain available only for local workflows or explicitly isolated preview/local targets unless a separately reviewed sandboxed exception path is introduced
- provider adapters should reject protected/shared deployment shapes that require package-local executable logic the shared control plane is not allowed to run

Semantic contract for the canonical Buck `:deploy` target:

- the canonical Buck `:deploy` target is a declaration and metadata target, not a live mutating action
- it exists so repo tooling can discover deployments, validate structure, query metadata, and resolve artifacts
- operators should not treat `buck2 run //projects/deployments/...:deploy` as the public deployment interface
- the repo-level `deploy` CLI remains the only intended operator-facing entrypoint for live mutation
- if an implementation uses `buck2` internally while servicing the deploy CLI, that is an implementation detail rather than a second supported workflow

## Required Contracts

The design leaves some implementation details open, but the following behavioral contracts should be treated as fixed:

- every concrete deployment lives at `projects/deployments/<deployment-id>/`
- every concrete deployment exposes a canonical `:deploy` target
- `TARGETS` is the source of truth for deployment metadata
- Buck builds artifacts, but does not perform the live publish itself
- the repo-level `deploy` command is the only public entrypoint operators are expected to learn
- the canonical Buck `:deploy` target is for declaration, discovery, validation, and artifact resolution
  - it is not a public live-mutation interface for operators
- file paths inside deployment metadata are relative to the deployment package by default
- deployment-local scripts are implementation hooks, not a second public workflow
- provider adapters may impose narrower rules than the generic deployment model
- deployment hooks and substantive deployment automation must follow the repo-wide script policy
  - substantive automation is zx TypeScript with `#!/usr/bin/env zx-wrapper`
  - thin `build-tools/tools/bin/*` wrappers may delegate into that TypeScript entrypoint
- each concrete deployment identifies one named live target in normal publish mode
  - promotion reuses artifact identity across deployments; it does not make one deployment dynamically become many environments
- protected or shared-environment mutating deploys must run through the shared deploy control plane
  - local workflows may validate, build, resolve, or publish only to explicitly isolated local or preview targets
- preview publication must never silently reuse the normal live target
  - preview targeting must be explicit in deployment metadata or explicit in provider-adapter policy for a safely isolated target class
- deployment metadata is authoritative for the repo deployment model
  - provider config files are provider-native inputs, not a second source of truth for core deployment facts
  - when the same conceptual value would otherwise appear in both places, generation or runtime injection is preferred over duplication
- provider-target identity is part of the required deployment contract
  - examples, extracted metadata, and deployment records should represent it consistently rather than treating it as optional shorthand
  - if an example intentionally omits it for brevity, the text should say so explicitly

If an implementation choice would break one of those contracts, the implementation should change rather than the operator workflow.

## Decisions Locked Now

The following operating-model decisions are now part of the intended design direction and should be
treated as planned policy, not open brainstorming:

- promotion should prefer reusing the exact previously built artifact rather than rebuilding per environment
- promotion should move the same artifact across distinct deployment ids that each name one explicit live target
  - one deployment should not implicitly select among multiple shared environments at publish time
- promotion should use one-way fast-forward environment branches
  - later environments advance only after required checks pass for earlier environments within the same independently promoted lane
- rollback for bad app releases should prefer redeploying a prior known-good artifact
  - if that is not available or not appropriate, rollback should use a new revert commit promoted forward through the same branch flow
  - moving environment branches backward should not be the normal rollback mechanism
- provider-native rollback should be treated as an emergency stabilization path, followed by control-plane and Git reconciliation
- the shared deployment control plane should use a central Postgres-backed backend
  - it should back deployment-record storage
  - it should back shared-environment deploy locking
- shared-environment locking should use an explicit lock scope
  - the default lock scope should be derived from `provider` plus a normalized canonical provider-target identity
  - explicit overrides are special-case escape hatches and must validate as at least as strict as the derived scope
  - one active mutating run should run per lock scope
  - different lock scopes may run in parallel
  - rollback, retry, and redeploy actions should take the same lock as the normal deploy path
  - preview should share the main deployment lock by default
  - preview runs may use separate lock scope only when they publish to isolated preview targets
  - the shared lock implementation must provide lease expiry plus stale-holder protection such as fencing or an equivalent safety mechanism
- deployments may declare explicit prerequisites on other deployment ids
  - prerequisite modes should be narrow by default: `ordering_only` or `health_gated`
  - prerequisites should be same-lane by default
  - cross-lane prerequisites require explicit reviewed shared-platform semantics
  - admission, orchestration, and changed-based selection should consume the same prerequisite metadata
- deploy records should include first-class lineage identifiers
  - every run gets a globally unique `deploy_run_id`
  - retries, rollbacks, and promotions should set `parent_run_id`
  - promotions of the same built artifact across environments should carry an `artifact_lineage_id`
- each component kind should resolve to a canonical provider-neutral data shape with required fields and artifact identity
  - publishers consume that resolved data shape and must not rediscover artifact semantics ad hoc from build outputs
- each deployment should declare explicit provider-target identity in deployment metadata
  - adapters must not infer the live target from directory names, branch names, CLI defaults, or unchecked provider config drift
- protected or shared-environment `--publish-only` must identify the exact artifact being published
  - it must not mean "publish whatever was most recently built on this machine"
  - rebuilding during `--publish-only` is out of policy for those environments unless the operator is intentionally creating a new deploy run instead of reusing an existing artifact
- deploy records should distinguish operation kind from final outcome
  - operation kinds include at least normal deploy, preview deploy, retry, promotion, and rollback
  - success or failure outcome must remain separate from the kind of run being performed
- deploy records should use separate canonical vocabularies for final outcomes and lifecycle states
  - terminal final outcomes: `validation_failed`, `build_failed`, `resolve_failed`, `provision_failed`, `publish_failed`, `smoke_failed_after_publish`, `succeeded`
  - lifecycle states: `queued`, `running`, `waiting_for_lock`, `cancelling`, `cancelled`
- automatic retry policy should be conservative and step-specific
  - `validate`, `build`, and `resolve` should not auto-retry
  - `provision` should not auto-retry by default; explicit operator rerun is preferred
  - `publish` may auto-retry for clearly transient failures, up to 2 retries with backoff
  - `smoke` may auto-retry for transient readiness/network failures, up to 3 retries within an overall timeout budget
- secrets should use `secretspec` as the repo-level contract layer and Vault as the initial production backend
- protected or shared-environment deploys should be admitted only through CI or the shared control plane
  - direct local mutating deploys to those environments are out of policy except for explicitly controlled emergency procedures
- local-only fallback should be explicitly limited
  - shared environments must use the central Postgres control plane
  - personal local/dev workflows may use a local filesystem lock plus a local structured deployment record
  - local-only fallback records are non-authoritative and must not be used for shared environments
- production-facing smoke checks should be required and blocking by default
  - canonical URL by default
  - deployment-specific preview URL only when explicitly configured
  - timeout and retry policy should be explicit, not implicit
  - a production-facing deployment may omit or downgrade smoke only through an explicit documented exception
- provisioners should be non-destructive by default during normal deploy flows
  - delete or replace behavior that can remove owned live resources should require an explicit separate operator path or equivalent break-glass intent
- `--provision-only` should not build or consume artifact-derived inputs in v1
- `protection_class` should use a closed enum: `local_only`, `shared_nonprod`, `production_facing`

These decisions are now reflected in the detailed design sections below. The remaining work is to
turn them into implementation-grade detail and execution plans without changing the policy
direction.

## Deliberately Not Fixed Yet

This design is intentionally opinionated about the model, but still leaves some implementation policy choices open:

- the exact Postgres schema and lease mechanics for the shared deployment control plane, while still preserving lease expiry and stale-holder protection

Those are real decisions, but they are operational-policy details layered on top of this model rather than reasons to change the model itself.

## Repo-Level Deploy Command

I want one canonical deploy entrypoint for everything under `projects/deployments/`.

Examples:

```bash
deploy pleomino-prod
deploy pleomino-prod --preview
deploy pleomino-prod --validate-only
deploy pleomino-prod --provision-only
deploy pleomino-prod --publish-only --run-id <deploy-run-id>
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

### Deployment Id Versus Preview Run

This distinction needs to stay explicit because it is one of the easiest places for a new engineer to get confused.

- deployment id answers "which named release target is this?"
- `--preview` answers "what publish mode should this run use?"

So:

- `pleomino-prod` and `pleomino-staging` are different deployments
- `deploy pleomino-prod --preview` is still operating on `pleomino-prod`
- preview should not silently invent a second deployment id or bypass the deployment package's validation rules

Plain-language version:

- staging is usually a different deployment
- preview is usually a different way to publish one deployment

### Preview Versus Lower Environments

This is the simplest reliable distinction:

- a lower environment is a named, long-lived deployment target
- a preview is a short-lived or per-change publish mode for one deployment

Examples of lower environments:

- `pleomino-dev`
- `pleomino-staging`
- `pleomino-prod`

Examples of previews:

- "publish a preview for PR-184"
- "publish a branch preview for `feature/new-nav`"
- "publish a one-off review build for commit `abc1234`"

Plain-language version:

- lower environments are standing rooms in the building
- previews are temporary demo rooms

Policy boundary:

- if the target is stable, named, long-lived, and repeatedly reused, it should usually be modeled as its own deployment id instead of as preview mode
- preview mode is for isolated per-run or per-change targets derived from explicit policy
- preview mode must not become a vague alias for "some non-prod place"

### Deployment-Local `deploy.ts` Files

The repo-level `deploy` command should remain the canonical user-facing entrypoint.

If a deployment package contains a local `deploy.ts`, that file should be treated as an internal adapter hook, not as a second public interface users are expected to memorize.

Protected/shared clarification:

- package-local executable hooks are out of policy for protected/shared deploys in v1
- any example using a package-local executable hook should be read as local-only, isolated-preview-only, or illustrative legacy shape unless it explicitly says the hook is replaced by vetted built-in control-plane code

Good pattern:

- user runs `deploy pleomino-prod`
- the repo-level deploy tool resolves the deployment target
- the repo-level deploy tool may delegate one step to a deployment-local script if needed

Plain-language version:

- `build-tools/tools/bin/deploy` is the front door
- deployment-local scripts are allowed, but they are side doors the front door may call

### Why These Flags Exist

These flags are not just convenience syntax. They exist because real deployment workflows often need one slice of the lifecycle without running the whole thing every time.

Flag interaction rules:

- default `deploy <id>` means `validate -> build -> resolve -> provision? -> publish -> smoke?`
- `--validate-only` runs validation only
- `--provision-only` still performs `validate`, but it must not build, resolve artifacts, or publish
  - in v1, provisioners may consume only stable declared deployment metadata, not resolved build outputs or artifact-derived inputs
- `--publish-only` still performs `validate` and `resolve`, but it must skip provisioning
  - it may build only when the caller did not provide or select an already-built artifact reference
  - promotion-grade, retry, and rollback-grade publish-only paths should prefer the exact previously resolved artifact rather than rebuilding
  - for protected or shared environments, `--publish-only` must require an explicit immutable selector
  - the normal protected/shared selector should be `--run-id <deploy-run-id>`
  - an optional lower-level `--artifact-ref <artifact-ref>` path may exist for vetted admin or automation use, but it must still identify one exact immutable artifact
  - for those environments it must not fall back to "latest local build output" or an implicit rebuild on the operator's machine
- `--preview` changes the publish mode, not the deployment identity
- `--list` does not mutate anything
- `--from-changes` selects deployment ids first, then runs the same lifecycle each selected deployment would normally run

Mutual-exclusion rule:

- `--validate-only`, `--provision-only`, and `--publish-only` should be mutually exclusive

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
deploy pleomino-prod --publish-only --run-id <deploy-run-id>
```

Plain-language version:

- "The place is already ready; ship this exact previously recorded build."

Why this matters:

- most releases should not need to re-run infra convergence
- publish is often the most common operational path
- keeping it separate makes retries and incident response much cleaner

Concrete example:

- the Cloudflare Pages project already exists
- DNS is already correct
- the previous deploy failed during asset upload
- you want to retry publication for that exact recorded run without touching infra

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

Safety rule:

- preview must publish to an explicitly isolated preview target
- if a provider cannot guarantee that isolation, the adapter should reject `--preview` for that deployment rather than silently publishing to the normal live target with preview-like labeling

How preview target selection works:

- preview target selection must be rule-based, not operator-invented per run
- the deployment metadata may explicitly declare preview targeting behavior
- or the provider adapter may define a deterministic derivation rule from deployment metadata plus run context such as PR number, branch name, or commit SHA
- the rule must be validated before any mutating step

What "explicit" means here:

- acceptable: "for this deployment, preview publishes to a provider-managed branch-preview target derived from the git ref"
- acceptable: "for this deployment, preview publishes to ephemeral namespace `preview-<pr-number>`"
- not acceptable: "the engineer picks a bucket/project/namespace at runtime without a checked policy"

Preview lifecycle examples:

- CI-managed PR preview
  - CI detects PR 184
  - CI runs `deploy pleomino-prod --preview`
  - the provider adapter derives an isolated target such as `preview-pr-184`
  - smoke runs against the preview URL
  - when the PR closes or the preview expires, CI or the control plane destroys that isolated target or asks the provider to expire it
- Branch preview with provider-managed ephemeral target
  - CI publishes a branch preview using the provider's native preview facility
  - the provider owns most of the lifecycle
  - repo policy still requires that the preview target be isolated from the normal live target
- Manual local preview to a personal isolated target
  - a developer may run preview locally only when the provider adapter supports a clearly isolated local or personal preview target
  - that preview must not mutate any shared deployment target
  - if isolation cannot be proven, local preview is out of policy

Creation and destruction policy:

- previews are usually created automatically by CI or the shared control plane in response to PRs, review requests, or other automation triggers
- manual preview creation is allowed only for explicitly isolated local or personal preview targets
- preview destruction should be automatic by default
  - on PR close or merge
  - on explicit preview expiry or TTL
  - on manual cleanup through the control plane when automation cannot do it
- preview cleanup must target only the isolated preview resources; it must not share destructive paths with the normal deployment

Non-interference guarantees:

- preview must use an isolated provider target, isolated publish path, and isolated smoke target
- preview must not reuse the normal deployment's live project, bucket, namespace, release name, or equivalent mutable target identity
- if preview and non-preview can still affect the same live target, they must share the same lock scope and preview must be treated as non-isolated
- provider adapters must validate the isolation rule before publishing
- if the adapter cannot prove isolation, it must reject preview mode for that deployment

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

Default diff-base policy:

- local use should compare against `git merge-base HEAD @{upstream}`
- CI pull-request use should compare against the merge-base with the PR target branch
- post-merge automation should compare against the previous successful deploy baseline for the relevant environment branch when that data is available
- if no upstream or baseline can be determined, the tool should fail explicitly and ask for an override instead of silently choosing an unsafe diff base

Environment-lane policy:

- each concrete deployment belongs to one environment branch lane for protected/shared mutation
- the unit of a lane is one independently promoted deployment family, not the whole repo and not one individual deployment id
- lane membership should be explicit deployment metadata, not only an implicit naming convention
- a family lane may own branches such as `env/<family>/dev -> env/<family>/staging -> env/<family>/prod`
- the authoritative baseline for an environment-mutating `--from-changes` run is the last successful deploy baseline recorded for that lane
- one mutating `--from-changes` invocation for protected or shared environments should stay within one environment lane
- if the changed set affects deployments in multiple environment lanes, the selector should require explicit lane selection or split the result into separate non-mutating result sets rather than mutating all lanes at once
- local or non-mutating inspection flows may still report deployments across multiple lanes when that is useful for visibility

Prerequisite expansion policy:

- `--from-changes` should understand explicit deployment prerequisites from deployment metadata
- when a changed deployment is an explicit prerequisite of another deployment, the selector may widen the result set according to documented policy rather than leaving downstream prerequisite enforcement entirely to later orchestration
- widening for prerequisites should be conservative and explainable, not ad hoc
- prerequisite widening should respect environment-lane boundaries for mutating runs

Impact-selection contract:

- `--from-changes` must use Buck-authoritative graph data to decide which deployments are impacted
- every deployment-local file that can affect validation, provider-target identity, provisioning, publishing, smoke behavior, or target identity must either:
  - be declared on the canonical deployment target and therefore participate in Buck-visible impact analysis
  - or be covered by an explicit documented widening rule
- this is a required contract of the deployment rule shape, not just a best-effort selector implementation detail
- the intended flow is:
  - collect changed files for the selected diff base
  - map those files to affected Buck targets using repo build metadata
  - walk Buck reverse dependencies from those targets to concrete deployment targets
  - de-duplicate the resulting deployment ids and then run the normal lifecycle for each selected deployment
- the implementation must use a conservative expansion rule for repo-global inputs that can affect many deployments even when no single app target changed directly
  - examples include deployment macros and shared helper code under `build-tools/`, provider adapters, flake or toolchain inputs, and other repo-wide deployment/build wiring
- deployment-local files such as `wrangler.jsonc`, `smoke.ts`, provisioner entrypoints, or generated provider-config inputs must not fall through an unmapped gap where they change deployment behavior without selecting the deployment
- when a change touches such a repo-global input, the selector should widen the impacted set according to documented policy rather than silently under-selecting deployments
- `--from-changes` is allowed to over-select for safety; it is not allowed to under-select because an implementation skipped Buck graph expansion or ignored repo-global inputs

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
- `deploy pleomino-prod --publish-only --run-id <deploy-run-id>`
  - publish a selected previously built artifact, or a fresh artifact only when that environment's admission policy allows it, to an already-existing Pages project
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
    provider_target = {
        "id": "pleomino-prod-pages",
    },
    protection_class = "production_facing",
    promotion_lane = "pleomino",
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
        "type": "http-smoke",
        "path": "/",
    },
)
```

In this example:

- `protection_class` is included because environment classification is part of the authoritative deployment contract
- `promotion_lane` is included because this example represents a named environment that participates in protected/shared promotion policy
- deployments that are truly local-only or otherwise outside protected/shared promotion policy may omit `promotion_lane`, but that omission should be intentional and explained by the deployment's policy class
- the smoke block uses a built-in smoke runner shape instead of a package-local executable hook because this example is compatible with protected/shared policy

Suggested metadata shape conventions:

- the deployment macro is the authoritative source for repo-level deployment metadata, even if the exact extraction mechanism evolves later
- dictionary-valued fields should use stable, explicit keys rather than relying on positional meaning or provider-specific shorthand
- this document intentionally standardizes a small shared outer shape now so adapter authors and reviewers do not keep reopening the same field-shape question later
- the goal is to standardize the repo-level contract without overfitting every provider to one rigid semantic vocabulary
- recommended conventions for the low-level deployment shape are:
  - `provider_target`
    - required
    - should be a structured object, not a bare string
    - should include at least a stable provider-side identifier under `id`
    - may include additional provider-neutral qualifiers when needed, such as account, namespace, region, or environment class
  - `promotion_lane`
    - required for deployments that participate in protected/shared promotion policy
    - identifies the independently promoted deployment family this deployment belongs to
    - should be explicit deployment metadata rather than inferred only from naming convention
  - `protection_class`
    - required
    - closed enum: `local_only`, `shared_nonprod`, `production_facing`
    - this classification should drive admission, smoke expectations, and whether shared-control-plane execution is required
  - `components[*]`
    - required, non-empty list
    - each component should include `id`, `kind`, and `target`
    - `id` should be stable within the deployment, not derived from list position
  - `publisher`
    - required
    - should include a stable `type`
    - file references such as `config` should be package-relative unless documented otherwise
  - `provisioner`
    - optional
    - when present, should include a stable `type`
    - file references such as `entry` or config paths should be package-relative unless documented otherwise
  - `smoke`
    - optional
    - when present, should explicitly describe how smoke runs, such as an `entry`, a named built-in smoke class, or other adapter-defined validated shape
    - production smoke exceptions should be represented explicitly as a nested `smoke.exception` object rather than by omitting the field and hoping readers infer intent
  - `prerequisites`
    - optional
    - when present, should be an explicit list of deployment-id prerequisites rather than free-form prose
    - each prerequisite should declare whether it is `ordering_only` or `health_gated`
    - prerequisites should stay narrow and non-recursive by default

Important design points:

- `components` is plural on purpose
- `provisioner` is optional
- `publisher` is required
- `provider_target` identifies the concrete live destination this deployment owns in normal publish mode
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

A deployment may also declare explicit prerequisites on other deployments when ordering or health gating
must be part of the repo-owned release model.

Plain-language version:

- "deploy this thing"
- and, when explicitly declared, "only after these other deployment units are in the required state"

### Component

A component is a deployable project artifact referenced by a deployment.

Examples:

- a static web app
- a docs site
- a worker bundle
- a future service image or runnable target

Each component should declare:

- `id`: stable name inside the deployment
- `kind`: deployable artifact contract, not just an arbitrary label
- `target`: Buck target that produces or represents the artifact

The important nuance is that `kind` should describe the artifact shape the publisher can consume.

Examples:

- `static-webapp` means "a publisher can expect a static-site artifact layout"
- `service` means "a publisher can expect a service/image style artifact"

It should not just mean:

- "some string this team found descriptive"

Each `kind` should also imply one canonical resolved output shape.

Plain-language version:

- `kind` does not just label the component
- `kind` tells `resolve` what standard provider-neutral data shape must come out for publishers to consume

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

### Provider Target

A provider target is the concrete live destination a deployment mutates in normal publish mode.

Examples:

- one Cloudflare Pages project
- one S3 bucket plus related publish endpoint
- one Kubernetes cluster/namespace/release tuple

Plain-language version:

- provider = what family of platform this is
- provider target = the exact live thing this deployment changes

Policy:

- every concrete deployment should declare explicit provider-target identity in authoritative deployment metadata
- normal promotion between environments should happen by reusing the same artifact across different deployment ids, each with its own provider target
- adapters must not silently derive the live target from branch names, directory names, ambient CLI defaults, or unchecked duplication in provider-native config files
- when preview mode is supported, preview target selection must also be explicit
  - either deployment metadata declares the preview target shape directly
  - or the provider adapter defines a deterministic, validated derivation from deployment metadata to an isolated preview target
  - falling back to the normal provider target is not an acceptable preview implementation

Field-shape guidance:

- `provider_target` should be represented as a structured metadata object, not as free-form prose or an opaque positional tuple
- the minimum required field is `id`, meaning the stable provider-side target identifier for normal publish mode
- when additional qualifiers are needed to uniquely identify the live target, represent them as explicit named fields rather than encoding them into one ambiguous string
- this is an intentional standardization decision for the document, not an accidental example style choice
- the shared `id` field gives validation, deployment records, and adapter wiring one predictable canonical identifier while still allowing provider-specific qualifiers beside it
- examples in this document use compact shapes for readability; production adapters may require additional validated fields, but should preserve the same explicit-object model

Minimum `smoke.exception` fields:

- `owner`
- `reason`
- `scope`
- one review boundary field: `review_by` or `expires_at`

### Prerequisites

A prerequisite is an explicit dependency from one deployment id to another deployment id.

Allowed modes:

- `ordering_only`
  - the prerequisite deployment must have completed its required admission path before this deployment may mutate
- `health_gated`
  - the prerequisite deployment must both satisfy ordering requirements and currently meet its declared health or smoke contract
  - by default this means a fresh admission-time or revalidation-time health check against the prerequisite deployment's declared smoke or health target
  - provider-specific health evidence may satisfy the gate only when the adapter explicitly maps it to that health contract and documents equivalent or stronger freshness guarantees
  - a historical last-successful smoke record is supporting context, not sufficient on its own for `health_gated`

Policy:

- prerequisites must be explicit deployment metadata, not inferred from naming conventions or tribal knowledge
- prerequisites are deployment-to-deployment relationships, not arbitrary resource-level dependency scripts
- prerequisites should be narrow and non-recursive by default
- a deployment may declare zero or more prerequisites, but each prerequisite must name one concrete deployment id and one explicit mode
- orchestration, admission, and `--from-changes` logic should all consume the same prerequisite metadata rather than inventing separate notions of dependency
- prerequisites should be same-lane by default
- cross-lane prerequisites are forbidden unless they are explicitly marked and reviewed as shared-platform dependencies with documented admission, locking, and health semantics
- prerequisite graphs must be DAGs
- self-dependencies are invalid
- direct or indirect prerequisite cycles are invalid and must be rejected at validation time

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
    provider_target = {
        "id": "pleomino-prod-pages",
    },
    components = [
        {
            "id": "web",
            "kind": "static-webapp",
            "target": "//projects/apps/pleomino:app",
        },
    ],
    provisioner = {
        "type": "cdktf-stack",
        "config": "cdktf/stack.json",
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

Example `wrangler.jsonc`:

```jsonc
{
  "$schema": "../../node_modules/wrangler/config-schema.json",
  "compatibility_date": "2026-03-18",
}
```

Why this file is intentionally small:

- Buck deployment metadata says which component is being deployed and which publisher is used
- the provisioner owns creation and reconciliation of the Pages project and DNS
- `wrangler.jsonc` only carries provider-native publish settings for Wrangler itself
- the deploy CLI still passes the resolved artifact path at runtime instead of relying on a checked-in output directory
- if Wrangler needs a project identifier such as `name`, the preferred model is to inject or render it from deployment metadata rather than duplicate it by hand here

Why you would want this:

- the repo owns the environment setup
- new environments should be reproducible
- an operator should not have to click around in the Cloudflare dashboard by hand
- later runs can confirm the environment still matches what the repo expects

#### Example: S3 Static Site With Bucket Setup

```python
deployment(
    name = "deploy",
    provider = "s3-static",
    provider_target = {
        "id": "docs-site-prod",
        "bucket": "docs-site-prod",
    },
    components = [
        {
            "id": "web",
            "kind": "static-webapp",
            "target": "//projects/apps/docs-site:app",
        },
    ],
    provisioner = {
        "type": "terraform-stack",
        "config": "terraform/main.tf.json",
    },
    publisher = {
        "type": "aws-s3-sync",
        "config": "publisher.json",
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
    provider_target = {
        "id": "prod-us-west/api-prod/api",
        "cluster": "prod-us-west",
        "namespace": "api-prod",
        "release": "api",
    },
    components = [
        {
            "id": "api",
            "kind": "service",
            "target": "//projects/apps/api:image",
        },
    ],
    provisioner = {
        "type": "cdktf-stack",
        "config": "cdktf/stack.json",
    },
    publisher = {
        "type": "helm-release",
        "config": "helm/values.yaml",
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
    provider_target = {
        "id": "prod-us-west/shared-observability/otel-collector",
        "cluster": "prod-us-west",
        "namespace": "shared-observability",
        "release": "otel-collector",
    },
    components = [
        {
            "id": "otel-collector",
            "kind": "third-party-service",
            "target": "//projects/observability/otel-collector:image",
        },
    ],
    provisioner = {
        "type": "terraform-stack",
        "config": "terraform/main.tf.json",
    },
    publisher = {
        "type": "helm-release",
        "config": "helm/values.yaml",
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
deploy pleomino-prod --publish-only --run-id <deploy-run-id>
```

That is an operational choice for one run.

It is not a reason to edit the deployment definition.

### Ownership And Drift

Provisioners should only reconcile resources the deployment explicitly owns.

There are three buckets:

- repo-owned resources
  - safe for the provisioner to create, update, and reconcile over time
- validated external prerequisites
  - must exist for the deployment to work, but should only be checked or referenced, not mutated by this deployment
- forbidden out-of-band mutations
  - things this deployment must not silently try to manage because ownership belongs elsewhere

Plain-language rule:

- if this deployment owns the resource lifecycle, the provisioner may reconcile it
- if another system or team owns it, this deployment should validate or reference it, not take control of it

Examples:

- repo-owned
  - a Pages project created by this repo
  - bucket and policy defined by this repo
  - namespace and ingress managed by this repo
- validated external prerequisite
  - a shared vendor endpoint the app talks to
  - a shared platform service deployed elsewhere
  - a bucket or domain managed by another team
- forbidden out-of-band mutation
  - mutating shared cluster resources from an app-local deployment
  - changing a provider project that another repo owns

Why this matters:

- it keeps provisioners idempotent without turning them into unsafe "fix everything" tools
- it preserves ownership boundaries between app deployments and shared platform systems
- it reduces accidental drift fights between two control planes

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

This is the checklist I would want a new reader to follow.

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

## New Deployment Happy Path

If you are adding a new deployment for the first time, the shortest correct workflow should be:

1. create `projects/deployments/<deployment-id>/`
2. add a `TARGETS` file with a `deployment(name = "deploy", ...)`
3. point `components[*].target` at existing Buck build targets
4. add provider config files such as `wrangler.jsonc` only when that provider needs them
5. decide whether setup is repo-owned
6. set `provisioner = None` if setup is external, or configure a real provisioner if setup is repo-owned
7. run `deploy <deployment-id> --validate-only`
8. if the deployment is `local_only`, run `deploy <deployment-id>` once validation passes
9. if the deployment is `shared_nonprod` or `production_facing`, submit the mutating run through CI or the shared control plane once validation passes

What you should not have to do:

- invent a second manifest format
- call provider CLIs directly as the primary workflow
- copy build outputs by hand into the deployment package
- guess whether Buck or the deploy CLI is responsible for a given step

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
    provider_target = {
        "id": "pleomino-prod-pages",
    },
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
  "compatibility_date": "2026-03-18",
}
```

Important note:

- the deploy CLI should pass the resolved Buck output path to the publisher
- this example intentionally does not rely on a checked-in `./dist` directory inside the deployment package
- if a provider config format also has a local output-dir field for its own tooling, Buck-resolved artifact paths are still authoritative for the actual deployment flow
- if a provider project identifier such as Wrangler `name` is needed, the preferred model is to derive it from deployment metadata instead of hand-maintaining it in both places
- if duplication is temporarily kept, validation should fail on mismatch

Layer responsibility in this example:

- `TARGETS`
  - names the deployment, provider, provider target, component, and publisher wiring
- `wrangler.jsonc`
  - contains provider-native Wrangler settings that are not already modeled authoritatively elsewhere
- deploy CLI
  - resolves the built artifact path, injects or renders any derived provider-native values, and invokes the publisher with that path

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

If checked-in provider config files are kept separate per deployment, they should differ only in provider-native settings that are not already derived from deployment metadata:

```jsonc
// projects/deployments/pleomino-prod/wrangler.jsonc
{
  "$schema": "../../node_modules/wrangler/config-schema.json",
  "compatibility_date": "2026-03-18",
}
```

```jsonc
// projects/deployments/pleomino-staging/wrangler.jsonc
{
  "$schema": "../../node_modules/wrangler/config-schema.json",
  "compatibility_date": "2026-03-18",
}
```

What stays the same across those deployments:

- the app target may still be `//projects/apps/pleomino:app`
- the deployment model still comes from `TARGETS`
- the deploy CLI still resolves and passes the built artifact path

What changes:

- deployment id
- provider target identity
- provider-native project selection, ideally injected or rendered from deployment metadata
- any deployment-specific domain, smoke, or provisioning wiring

## Multi-Component Example

A deployment may represent a delivered system, not just one app.

Multi-component lifecycle semantics:

- components are still built and resolved independently
- the provider adapter must define whether publish executes serially or in parallel for a supported multi-component deployment
- unless a deployment or provider adapter explicitly documents stronger guarantees, the default deployment-level policy is `ordered_best_effort`
- `ordered_best_effort` means:
  - components publish in a deterministic adapter-defined order
  - a later component does not start until the earlier component's publish step has returned
  - true cross-component atomicity is not implied
- adapters may explicitly support `parallel_best_effort` or `all_or_nothing`, but they must say so
- partial publish success must be recorded per component in the deployment record
- deployment-level smoke should run only after the publish phase completes according to the selected policy
- retry and rollback must operate from recorded per-component artifact and publish state, not from guesses about what probably succeeded

First-class rollout-shape policy:

- a multi-component deployment may explicitly declare component ordering, dependency barriers, or phased smoke checkpoints in deployment metadata
- when such rollout metadata is present, adapters must either honor it or reject the deployment as unsupported
- when rollout metadata is absent, the adapter-defined `ordered_best_effort` default applies
- phased smoke checkpoints should be explicit about which component group they validate and whether later phases may proceed on failure
- the same declared rollout shape should not silently change meaning across adapters

Operational consequence:

- if one component publishes and a later component fails under a best-effort policy, the deployment run is a publish failure
- the deployment record must preserve which components published successfully, which did not, and which artifact identity each component used
- any follow-up retry or rollback must use that recorded state explicitly

Example:

```python
deployment(
    name = "deploy",
    provider = "custom-platform",
    provider_target = {
        "id": "marketing-docs-prod",
    },
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
        "type": "custom-built-in",
        "config": "publisher.json",
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

The important split is:

- the generic deployment model defines what is expressible in principle
- each provider adapter defines what is actually supported right now

That means a deployment may be valid in the abstract model but still rejected by a specific provider adapter. That is expected, not a contradiction.

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

Artifact contract:

- each component target must produce a publishable artifact shape for its declared `kind`
- the deploy CLI is responsible for resolving the built output path or paths from Buck
- publishers consume resolved artifact paths; they should not assume a hand-created local `dist/` directory inside the deployment package unless that is explicitly part of the component contract
- when a deploy path is intentionally reusing a previously built artifact, `build` may be skipped and `resolve` should instead load the recorded artifact reference and validate it against policy
- for protected or shared environments, mutating publish flows should prefer previously recorded immutable artifact references over machine-local rebuilds

### Resolve

Resolve concrete output paths from built targets.

This is the bridge between Buck artifact labels and provider-specific publisher tools.

The output of `resolve` should be provider-neutral deployment data such as:

- component id
- component kind
- Buck target label
- concrete artifact path
- optional metadata the publisher needs, such as a default entrypoint, image reference, or archive path

Canonical contract rule:

- each component kind should resolve to one standard provider-neutral data shape with required fields
- that shape should include stable artifact identity appropriate to the kind, such as a content fingerprint, image digest, or equivalent strong reference
- publishers consume the resolved data shape rather than rediscovering semantics from build outputs
- provider adapters may validate that a resolved component kind is supported, but they should not invent a second artifact contract for the same kind

Minimum required resolved-component fields:

- `id`
- `kind`
- `target`
- `artifact_identity`
- `artifact_ref`

Operational rule:

- `resolve` is the point where Buck-specific artifact references become plain runtime inputs for provisioners, publishers, and smoke checks
- after `resolve`, later steps should not have to re-query Buck just to rediscover the same artifact paths
- `resolve` may work from either a freshly built target or a previously recorded artifact reference, but in both cases it must produce the same provider-neutral resolved deployment data shape

### Provision

Run optional infrastructure convergence.

Examples:

- `cdktf deploy`
- `terraform apply`

Provisioner safety policy:

- normal deploy flows should treat owned infrastructure convergence as non-destructive by default
- create and in-place update are normal provisioner behavior
- normal deploy flows must not delete, replace, rename, or transfer ownership of live resources
- delete, replacement, rename, or ownership-transfer operations require an explicit separate migration path or equivalent break-glass intent
- app artifact rollback should not imply destructive infra rollback

### Publish

Run the provider-specific artifact release step.

Examples:

- `wrangler pages deploy`
- `wrangler deploy`
- `aws s3 sync`

Publish safety policy:

- publishers must consume explicit resolved artifact inputs; they must not rediscover artifacts from mutable local working state
- publish retries must be safe under ambiguous provider outcomes such as request timeout after the provider may already have accepted the release
- when the provider supports idempotency keys, request correlation ids, version preconditions, or equivalent publish de-duplication controls, the publisher should use them
- when the provider does not support a strong idempotency primitive, the adapter must reconcile remote state before retrying a publish after an ambiguous result
- automatic retry is allowed only when the adapter can either prove the earlier attempt did not take effect or prove that retrying is idempotent for that provider operation
- if the adapter cannot prove either of those conditions, it must stop and surface the run as a publish failure that requires explicit operator follow-up

### Smoke

Run lightweight post-publish validation.

Examples:

- verify expected URL returns `200`
- verify PWA shell and manifest are reachable
- verify known route content

### Smoke Check Policy

Smoke checks are post-publish validation, not a replacement for build, unit, or integration tests.

Policy:

- the English concept "production-facing" must come from authoritative deployment metadata such as `protection_class = "production_facing"`, not from ad hoc team labeling
- deployments classified as `production_facing` must have smoke checks unless an explicit documented exception says otherwise
- deployments classified as `production_facing` should treat smoke checks as blocking by default
- `publish succeeded` and `smoke failed` must be reported as a distinct overall outcome
- smoke checks should run against the canonical deployment URL by default
- a deployment may explicitly configure a preview-specific smoke URL when preview mode publishes to an isolated preview target
- smoke checks should consume resolved deployment outputs and runtime deployment context instead of rediscovering deployment facts ad hoc
- deployments that intentionally omit smoke checks outside non-`production_facing` classifications should document that choice in deployment metadata or provider adapter policy rather than rely on silent absence

Timeout and retry policy:

- smoke checks should use an explicit timeout budget
- default smoke classes should be standardized
  - `static-webapp`: 5 minute total budget, including retries
  - `service` and `third-party-service`: 10 minute total budget, including retries
  - adapters may define additional classes only when they document them explicitly
- smoke may auto-retry for transient readiness or network failures, up to 3 retries within that timeout budget
- retries should not hide a final smoke failure; they only reduce false negatives from brief propagation or readiness delays

Preview policy:

- preview may use a lighter smoke policy only when that difference is explicitly documented by the deployment or provider adapter
- preview does not change deployment identity; it only changes publish mode and, when configured, the smoke target
- preview should not be used as a loophole to bypass the normal admission policy for protected or shared environments

Exception representation policy:

- a `production_facing` smoke omission or downgrade must be represented explicitly in a nested `smoke.exception` object in deployment metadata
- the same authoritative classification that marks a deployment as `production_facing` should also drive admission policy and local-mutation restrictions
- the minimum `smoke.exception` fields are:
  - `owner`
  - `reason`
  - `scope`
  - one review boundary field: `review_by` or `expires_at`
- the exception object may additionally include an explicit downgrade mode when smoke is reduced rather than omitted
- silent omission of smoke wiring is not an acceptable way to waive production smoke

Outcome guide:

- publish failed
  - smoke does not run
- publish succeeded and smoke succeeded
  - overall result is success
- publish succeeded and smoke failed
  - overall result is failure, specifically post-publish failure
- preview publish succeeded and preview smoke failed
  - overall result follows the documented preview policy, but the distinction from plain publish success must remain visible

## Retry, Concurrency, And Locking

The deployment system should be conservative about retries and explicit about concurrency.

Retry policy by step:

- `validate`
  - no automatic retry
- `build`
  - no automatic retry by default
- `resolve`
  - no automatic retry
- `provision`
  - no automatic retry by default
  - explicit operator rerun is preferred
- `publish`
  - may auto-retry for clearly transient provider or network failures
  - up to 2 retries with backoff
- `smoke`
  - may auto-retry for transient readiness or network failures
  - up to 3 retries within the overall smoke timeout budget

Shared-environment locking policy:

- shared environments should use a central Postgres-backed control plane for deploy coordination
- every deployment should resolve to a lock scope
- the default lock scope should be derived from `provider` plus a normalized canonical provider-target identity
- any explicit lock-scope override is a documented escape hatch for special cases, not the normal path
- an override must validate as at least as strict as the provider-target-derived scope; it must not permit two runs that could mutate the same live target to proceed independently
- all fields required to uniquely identify the mutable live target must participate in that normalized identity
- only one active mutating run should run for a lock scope at a time
- different lock scopes may run in parallel
- rollback, retry, promotion, and redeploy should take the same lock as a normal deploy against that target scope
- the shared lock implementation must prevent stale holders from continuing to mutate a target after ownership is lost

Preview locking policy:

- preview shares the main deployment lock by default
- preview may use separate lock scope only when the preview target, publisher path, and smoke target are all isolated from the non-preview target

Default lock-acquisition behavior:

- when a shared-environment lock is already held, the default behavior should be to wait in queue with a bounded timeout
- entering the queue gives a run the right to re-check and proceed later, not the right to execute an old plan unchanged
- after acquiring the lock, a queued run must revalidate current deployment state before any mutating step
- that revalidation should at least confirm that the run is still allowed to publish the intended revision or artifact to that target
- if the run's assumptions are stale after revalidation, it should exit without publishing and report that it was superseded or must be rerun
- interactive or incident-response workflows may offer an explicit fail-fast mode, but queued-with-revalidation should be the shared-environment default

Cancellation policy:

- cancellation before any mutating step begins should stop the run cleanly before side effects occur
- the deployment record should preserve that a cancellation request stopped the run before mutation
- for a clean pre-mutation cancellation, the deployment record should use `lifecycle_state = cancelled` and `final_outcome = null`
- once a mutating step such as `provision` or `publish` has started, cancellation is best-effort rather than guaranteed interruption
- a run must not report a clean `cancelled` outcome if provider-side mutation may already have happened and the system has not reconciled that state
- if cancellation arrives during or after a mutating step, the run should:
  - stop scheduling later steps when possible
  - reconcile whether the current step changed remote state
  - record the most accurate final outcome based on what actually happened, such as `provision_failed`, `publish_failed`, `smoke_failed_after_publish`, or `succeeded`
  - preserve enough deployment-record detail to show that a cancellation request occurred during the run
- provider adapters should document whether their provision and publish paths are interruptible, non-interruptible, or only safely cancellable between sub-steps
- cancellation must not imply automatic rollback of infrastructure or published artifacts

Local-only fallback policy:

- shared environments must use the central Postgres control plane
- personal local or dev workflows may use a local filesystem lock plus a local structured deployment record
- local-only fallback is non-authoritative and must not be used as the locking or record system for shared environments

Admission policy:

- mutating deploys for protected or shared environments should run only through CI or the shared deploy control plane
- direct local mutation of those environments is out of policy except for explicitly controlled emergency procedures
- local workflows remain valid for validation, build, resolve, and isolated preview or local targets

Release-admission contract for protected/shared environments:

- a run is eligible to mutate a protected or shared environment only when all of the following are true:
  - the source revision comes from the allowed environment branch for that deployment lane
  - required checks for that environment have passed for the admitted revision or artifact
  - any required human or policy approval has been granted
  - the deployment's explicit `promotion_lane` and `protection_class` metadata are present, valid, and match the intended target and admission path
  - artifact provenance is present and valid for the intended target
  - for protected/shared publish, the artifact was produced by trusted CI from the admitted source revision
  - the attestation for that artifact binds artifact identity to source revision plus deployment metadata and provider-config fingerprints
  - the shared control plane verifies that attestation before publish
  - the selected artifact or revision still matches the environment's promotion and admission policy
  - any explicit deployment prerequisites are satisfied according to their declared mode
    - for `health_gated`, that means a fresh health verdict at admission time unless explicitly documented provider-specific evidence is accepted as equivalent
- after waiting in queue and revalidating, "still allowed" means at least:
  - the environment branch still points to an allowed revision for this run
  - the artifact identity still matches the approved revision or approved prior run
  - the run has not been superseded by a later admitted run for the same lock scope
  - any required approval has not been revoked, expired, or invalidated by newer policy state
  - any health-gated prerequisite still satisfies its declared health requirement, using a fresh revalidation-time health verdict unless explicitly documented equivalent provider evidence is accepted
- if any of those checks fail after revalidation, the run must exit without mutating the target and report that it was superseded, stale, or no longer admitted
  - in those cases, the deployment record should preserve `final_outcome = null` and a specific `termination_reason`

Operator-facing lifecycle states:

- in-progress states
  - `queued`
  - `running`
  - `waiting_for_lock`
  - `cancelling`
- ended before canonical final outcome
  - `cancelled`

Run classification:

- every deployment record should include an `operation_kind`
- minimum operation kinds:
  - `deploy`
  - `preview`
  - `retry`
  - `promotion`
  - `rollback`
- `operation_kind` and `final outcome` answer different questions
  - operation kind says what sort of run this was
  - final outcome uses the canonical terminal outcome vocabulary for the run's completed result
  - lifecycle state tracks run progress and cancellation states such as `queued`, `waiting_for_lock`, `cancelling`, and `cancelled`
  - `cancelled` is a lifecycle state, not a canonical terminal `final outcome` value

Why this matters:

- it prevents overlapping publishes and confusing deploy history
- it keeps retry behavior predictable and auditable
- it makes shared environments safer without overcomplicating personal local workflows

## Promotion And Rollback

Promotion should prefer reusing the exact previously built artifact rather than rebuilding per environment.

That rule also applies to rollback-grade redeploys and publish-only retries whenever the intent is to
re-ship a known artifact rather than create a new one.

Artifact retention policy:

- any workflow that depends on immutable artifact reuse must keep that artifact and its immutable reference retrievable for the full supported promotion, retry, and rollback window
- for protected or shared environments, artifact retention is a required part of the deployment contract, not an optional implementation convenience
- an implementation must not garbage-collect or otherwise lose the only approved artifact for an in-policy promotion or rollback path while that path is still expected to be available
- if the artifact has expired or been intentionally removed, the system should surface that condition explicitly rather than silently rebuilding and treating the rebuild as equivalent
- retention duration and storage mechanics may be decided during implementation, but the operator-facing policy is that a supported artifact-reuse path must remain practically usable

Planned promotion model:

- use one-way fast-forward environment branches
- each independently promoted deployment family should have its own lane such as `env/<family>/dev -> env/<family>/staging -> env/<family>/prod`
- additional environment branches for that family may extend the lane when needed, but should follow the same fast-forward-only policy
- a later environment should advance only after required checks pass for the earlier environment
- promotion should preserve artifact identity across environments whenever the workflow is "prove once, promote forward"
- promotion should operate across distinct deployment ids such as `pleomino-staging` and `pleomino-prod`, not by having one deployment dynamically retarget itself

Plain-language version:

- later environments should receive code and artifacts that were already proven earlier, starting with the earlier branch in the same family lane
- promotion should move forward through the branch flow, not invent a second release path

Minimum branch-policy assumptions:

- each family lane should have protected environment branches such as `env/<family>/dev`, `env/<family>/staging`, and `env/<family>/prod`
- promotion should happen by fast-forwarding the next environment branch, not by rebuilding from an unrelated revision
- direct pushes to later environment branches should be disallowed except for controlled emergency procedures
- required checks for each environment should run before that environment branch advances
- deploy automation for a named environment should use the corresponding environment branch as its default source of truth

Rollback policy for bad app releases:

- first choice is redeploying a prior known-good artifact
- if that is not available or not appropriate, create a revert commit and promote it forward through the same branch flow
- moving environment branches backward should not be the normal rollback mechanism

Operational distinction:

- a rollback run is an operation kind, not a special success/failure outcome
- a successful rollback run should still record `final outcome = succeeded`
- the fact that it was a rollback should be visible through `operation_kind`, `parent_run_id`, and artifact lineage or replacement metadata

Provider-native rollback policy:

- provider-native rollback may be used as an emergency stabilization path
- if it is used, the deployment control plane and Git history should be reconciled afterward so live state and declared state do not drift silently

Boundary between app rollback and infra rollback:

- rollback of published artifacts is not the same thing as rollback of provisioned infrastructure
- infrastructure rollback may require a separate controlled change or reconcile step
- the deployment system should not imply that every publish rollback automatically undoes infra changes

Why this matters:

- it keeps release history auditable
- it makes rollback compatible with fast-forward promotion
- it avoids hidden rebuilds or hidden branch rewrites

## Buck Metadata Extraction

The deploy CLI should query Buck for deployment metadata rather than maintain a second handwritten manifest.

The deployment rule should expose enough metadata for repo tooling to retrieve:

- provider
- provider-target identity
- promotion lane or family membership
- protection/environment classification
- preview-target identity or preview-target derivation policy when preview is supported
- explicit deployment prerequisites when present
- component list
- provisioner config
- publisher config
- admission or protection classification needed to decide whether mutation must go through the shared control plane
- smoke policy metadata, including any explicit production exception
- lock-scope override when it differs from the provider-target-derived default
- package path

That metadata should be sufficient for the deploy CLI to assemble the whole lifecycle without scraping provider config files for core deployment facts.

In other words:

- provider config files contain provider-specific settings
- deployment metadata contains the repo's deployment model
- the deploy CLI should combine them, not guess one from the other

Precedence and consistency rules:

- deployment metadata is authoritative for repo-level facts such as provider, components, provisioner or publisher shape, deployment id, and package-relative config references
- deployment metadata is authoritative for provider-target identity used by mutating operations
- provider config files are authoritative only for provider-native settings inside the tool they configure
- if the same fact is represented in both places, the design should either:
  - generate one from the other to avoid duplication
  - or require validation-time equality and fail on mismatch
- the deploy CLI must not silently let provider config override Buck deployment metadata for core deployment facts

Preferred pattern:

- generation or runtime injection is better than duplication
- for example, a provider project identifier such as Wrangler `name` should ideally come from deployment metadata and be rendered or injected into provider-native config at publish time
- if the file must be checked in with that field duplicated, validation should fail on mismatch rather than silently picking one source
- the same rule applies to any other provider-target identifier, such as bucket names, release identifiers, namespaces, or equivalent live-target selectors

The exact extraction mechanism can be decided during implementation. The design goal is simple:

- define once in `TARGETS`
- consume from Buck

The external contract should stay stable even if the extraction mechanism changes. Callers should depend on deployment metadata fields, not on one particular Buck query implementation detail.

### Secrets And Runtime Inputs

Deployment metadata must remain non-secret.

What belongs in deployment metadata:

- provider
- promotion lane or family membership
- protection/environment classification
- components
- provisioner and publisher config references
- package-relative file paths
- non-secret identifiers such as project names, domains, or feature flags

What does not belong in deployment metadata:

- API tokens
- cloud credentials
- kube credentials
- signing keys
- long-lived secrets of any equivalent kind

Input classes:

- deployment metadata
  - repo-defined, Buck-visible, non-secret
- runtime configuration
  - selected mode, resolved artifact paths, non-secret environment selection, runtime target selection
- secrets
  - sensitive values injected only at deploy-runtime boundaries

Policy:

- checked-in deployment files such as `TARGETS`, `wrangler.jsonc`, and `smoke.ts` must not contain credentials or secret values
- publishers, provisioners, and smoke checks receive secrets only as runtime inputs
- Buck metadata is not a secrets channel
- `secretspec` should be the repo-level contract/interface for required secret inputs
- Vault should be the initial production backend behind that contract
- backend switching should remain possible without changing deployment metadata semantics
- runtime-secret injection must avoid leaking secret material into Buck metadata, checked-in files, or durable deployment records

Anti-patterns:

- embedding credentials in `TARGETS`
- embedding credentials in provider config files
- teaching provider adapters to infer secrets from checked-in repo state

## Deployment Record And Provenance

Every deploy run should produce a provider-neutral deployment record.

Minimum required fields:

- `deploy_run_id`
  - globally unique for every deploy attempt
- `deployment_id`
- Buck deployment label
- `operation_kind`
  - such as `deploy`, `preview`, `retry`, `promotion`, or `rollback`
- `lifecycle_state`
  - such as `queued`, `running`, `waiting_for_lock`, `cancelling`, or `cancelled`
- `termination_reason`
  - `cancelled`, `superseded`, or `no_longer_admitted` when the run ends without reaching a canonical terminal outcome
  - should be `null` when the run does reach a canonical terminal outcome
- source revision identifier
- actor or trigger source, such as human, CI job, or automation
- publish mode, such as normal or preview
- provider-target identity
- resolved component list
- artifact identity for each published component
- deployment metadata fingerprint or stable snapshot reference
- provider-native config fingerprint or stable snapshot reference for any checked-in provider config consumed by the run
- target provider and provider-instance identifier when applicable
- canonical remote publish identifier for each published component when the provider exposes one
- start time and end time
- final outcome
  - required only when the run reaches a canonical terminal outcome
  - should be `null` for runs that end without reaching a canonical terminal outcome

Additional recommended fields:

- `parent_run_id`
  - when the run is a retry, rollback, or promotion derived from an earlier run
- `artifact_lineage_id`
  - when the same built artifact is promoted across environments
- smoke result
- lock scope
- provider-specific details added by the adapter
- prerequisite evaluation details when explicit prerequisites affected admission or orchestration

Lineage requirement:

- `parent_run_id` is required when the run is a retry, rollback, or promotion derived from an earlier run
- `artifact_lineage_id` is required when the same built artifact is intentionally reused across environments or redeploy paths
- these lineage fields are optional only for runs that truly have no parent or no artifact-lineage relationship

Artifact identity rules:

- if an artifact already has a strong native identity, such as an image digest or content-addressed store identity, record that directly
- if an artifact is not produced through a fully content-addressed path, `resolve` should compute or surface a stable content fingerprint
- publish should consume the resolved artifact from the build step, not rebuild implicitly
- publish-only, promotion, retry, and rollback flows should accept a previously recorded artifact reference and should not rebuild unless the operator is intentionally creating a new artifact
- a recorded artifact reference for a supported reuse flow must remain retrievable for the applicable retention window
- provider-instance identifiers used during publish should come from authoritative deployment metadata or generated config, not from silently drift-prone duplicated checked-in fields
- the deployment record should preserve the canonical resolved component data shape or a stable projection of it, rather than only loosely structured adapter-specific paths
- the deployment record should make it obvious when the same artifact identity was published under different deployment metadata or provider-config inputs
- when a provider exposes a concrete release, deployment, version, or revision identifier, the deployment record must preserve that identifier per published component rather than burying it in optional adapter detail

Recommended deployment-record field-shape guidance:

- `provider_target` in the deployment record should preserve the same conceptual identity declared in deployment metadata, not a lossy human-only label
- deployment metadata provenance should preserve a stable fingerprint or snapshot reference to the metadata evaluated for the run
- provider-config provenance should preserve a stable fingerprint or snapshot reference for each provider-native config file that materially influenced publish behavior
- `resolved component list` should preserve one entry per component id, not just an unordered blob of adapter output
- each resolved component entry should keep at least:
  - component `id`
  - component `kind`
  - source Buck `target`
  - resolved artifact identity
  - concrete artifact location or equivalent provider-neutral reference
- `final outcome` should use the canonical vocabulary exactly rather than near-synonyms
- `publish mode` and `operation_kind` should stay separate even when one implies the other in common cases

Nix-aligned guidance:

- prefer recording store path plus stable content fingerprint instead of only a mutable local path string
- prefer publishers that accept explicit resolved artifact inputs instead of rebuilding or re-exporting artifacts internally
- where a component kind naturally yields a digest, such as OCI images or fixed-output archives, that digest should be part of the deployment record

Canonical final-outcome vocabulary:

- terminal
  - `validation_failed`
  - `build_failed`
  - `resolve_failed`
  - `provision_failed`
  - `publish_failed`
  - `smoke_failed_after_publish`
  - `succeeded`
- `null`
  - used when a run ends without reaching a canonical terminal outcome, such as clean pre-mutation cancellation or a non-mutating terminal exit after revalidation

Canonical termination-reason vocabulary:

- `cancelled`
- `superseded`
- `no_longer_admitted`

Canonical lifecycle-state vocabulary:

- non-terminal
  - `queued`
  - `running`
  - `waiting_for_lock`
  - `cancelling`
- ended before canonical final outcome
  - `cancelled`

Storage guidance:

- shared deployment records should be persisted in the central Postgres-backed control plane
- structured CLI output is still useful, but it is an interface, not the sole source of truth
- the record contract should remain stable even if the storage schema evolves

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

def cloudflare_static_pwa_deployment(name, app_target, provider_target, wrangler_config, provisioner = None):
    deployment(
        name = name,
        provider = "cloudflare-pages",
        provider_target = provider_target,
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
    provider_target = {
        "id": "pleomino-prod-pages",
    },
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

def puzzle_cloudflare_deployment(name, app_target, provider_target, wrangler_config, provisioner = None):
    cloudflare_static_pwa_deployment(
        name = name,
        app_target = app_target,
        provider_target = provider_target,
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
    provider_target = {
        "id": "pleomino-prod-pages",
    },
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
    provider_target = {
        "id": "pleomino-prod-pages",
    },
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
    provider_target = {
        "id": "prod-us-west/api-prod/api",
        "cluster": "prod-us-west",
        "namespace": "api-prod",
        "release": "api",
    },
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
        "type": "helm-release",
        "config": "helm/values.yaml",
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
    provider_target = {
        "id": "pleomino-prod-pages",
    },
    components = [
        {
            "id": "web",
            "kind": "static-webapp",
            "target": "//projects/apps/pleomino:app",
        },
    ],
    provisioner = {
        "type": "cdktf-stack",
        "config": "cdktf/stack.json",
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
      helm/values.yaml
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
    provider_target = {
        "id": "prod-us-west/shared-observability/shared-observability",
        "cluster": "prod-us-west",
        "namespace": "shared-observability",
        "release": "shared-observability",
    },
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
        "type": "helm-release",
        "config": "helm/values.yaml",
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

## Operational Best Practices And Remaining Work

This design is now strong on both the structural model and the core operator-facing policy
direction.

The remaining work is not "decide the deployment model again."

The remaining work is:

- preserve this contract while designing implementation details
- implement the remaining control-plane and schema details without relaxing the now-decided operational defaults
- turn this finished design into a separate implementation plan

The most important implementation-planning follow-ups are:

- immutable artifact identity and promotion
  - the design now requires artifact reuse for promotion-grade and rollback-grade flows
  - implementation planning still needs to define the exact per-kind resolved schema fields and how artifact references are persisted and selected in tooling
- rollback and redeploy procedure
  - the design now defines rollback direction and run classification
  - implementation planning still needs exact operator procedures and control-plane actions
- locking and control-plane mechanics
  - the design now defines lock-scope behavior, shared Postgres-backed coordination, and the need for stale-holder protection
  - implementation planning still needs lease, fencing, wait-vs-fail, and conflict-resolution details
- secrets runtime wiring
  - the design now defines the metadata-versus-secret boundary and the `secretspec` and Vault direction
  - implementation planning still needs concrete runtime injection interfaces, names, and audit handling
- smoke-check defaults
  - the design now defines required-versus-exception policy for production, explicit timeout classes, and bounded retry semantics
  - implementation planning still needs exact metadata field names and any adapter-specific extensions beyond the default classes
- provider-adapter enforcement
  - the design now defines metadata precedence, explicit provider-target identity, drift ownership, and lock-scope expectations
  - implementation planning still needs adapter-level validation hooks, helper conventions, and exact provider-target field naming
- shared-environment admission
  - the design now defines that protected or shared-environment mutation goes through CI or the shared control plane
  - implementation planning still needs the concrete approval, authentication, and emergency-procedure mechanics
- provisioner safety boundaries
  - the design now defines non-destructive-by-default normal deploy behavior
  - implementation planning still needs the exact break-glass interface for destructive owned-resource operations

These are not gaps in the deployment model.

They are the handoff points from design completion into implementation planning.

### Design-Completion Goal

When the design-document PRs in this area are complete, the repository should be in this state:

- a reader can tell how to model a deployment in the repo
- a reader can tell which operational behaviors are mandatory policy
- a reader can tell which details are still implementation mechanics rather than open design questions
- an implementation-planning effort can begin without first revisiting core policy

### Remaining Design-Doc Work

The remaining documentation work should focus on tightening summaries and examples around the
already-chosen design, not inventing a second round of structural changes.

Recommended final documentation tasks:

1. add a compact operational policy summary table
   - one row each for provenance, promotion, rollback, secrets, locking, metadata precedence, drift ownership, and smoke handling
2. add one example deployment record
   - include `deploy_run_id`, `operation_kind`, `parent_run_id`, artifact identity, lock scope, and final outcome
3. add one short example of artifact reuse across promotion or rollback
   - show the difference between "build new artifact" and "publish previously recorded artifact"
4. add one short example of metadata-versus-provider-config precedence
   - show a valid configuration and the expected behavior on mismatch
5. add one short example of explicit smoke exception policy for a non-production deployment
   - make clear that production requires smoke unless explicitly waived
6. add one compact operator summary for lock scope
   - explain when `deployment-id` is sufficient and when multiple deployment ids must share a lock scope
7. do one final example-consistency pass for provider-target identity
   - make sure concrete deployment examples, metadata examples, and deployment-record examples either include `provider_target` consistently or explicitly state when it is omitted for brevity
8. do one final editorial pass to keep normative policy visually dominant
   - compress, relocate, or otherwise de-emphasize process-heavy planning text once it has served its design-refinement purpose
   - keep the settled normative sections easy to scan without losing the historical design-completion guidance

Success condition for the final design revision:

- the design is complete enough that implementation planning can focus on schema, commands, adapters, control-plane mechanics, and rollout order rather than reopening policy questions

## Design-Doc PR Sequence

These PRs are design-document PRs, not production implementation PRs.

Their job is to make the completed design easier to implement faithfully.

Any PR section added in the future should also explicitly state that:

- any policy deviation from this design must be surfaced and discussed rather than silently introduced
- any meaningful ambiguity discovered while refining the design should be brought to the repository owner for a decision before the PR scope is finalized

## PR-1: Add operator-facing examples and summary tables for the completed design

### Description

This PR should make the now-chosen design easier to consume by adding compact summaries and concrete
examples without changing policy direction.

### Scope & Changes

- Update [docs/deployments-design.md](/Users/kiltyj/Code/bucknix-fresh/docs/deployments-design.md):
  - add a compact operational policy summary table
  - add one concrete example deployment record
  - add one concrete example of artifact reuse for promotion or rollback
  - add one concrete example of lock scope where two deployment ids share one mutable provider-side target
  - add one concrete example of metadata precedence versus provider config mismatch

### Tests (in this PR)

- Manual read-through for consistency with:
  - `Deployment Lifecycle`
  - `Promotion And Rollback`
  - `Buck Metadata Extraction`
  - `Deployment Record And Provenance`
- Prompt the repository owner about any policy deviation, contradiction, or meaningful ambiguity discovered while preparing the PR.

### Docs (in this PR)

- Update [docs/deployments-design.md](/Users/kiltyj/Code/bucknix-fresh/docs/deployments-design.md) with:
  - one short operator-reference table
  - one example deployment record
  - one example artifact-lineage story
  - one example lock-scope story
  - one example metadata precedence story

### Acceptance Criteria

- A reader can quickly find the mandatory policies without re-reading the whole document.
- A reader can see how operation kind differs from final outcome.
- A reader can see how artifact reuse is supposed to work for promotion or rollback.
- A reader can see how metadata precedence and lock scope work in concrete examples.

### Risks

The examples could accidentally introduce policy drift if they contradict the normative sections.

### Mitigation

Treat examples as explanatory material only and cross-check them against the normative sections.

### Consequence of Not Implementing

The design remains correct but harder to consume, making implementation planning slower and more
error-prone.

### Downsides for Implementing

Adds more normative-adjacent examples that must stay in sync with the main design.

### Recommendation

Implement.

### Collaboration Note

- Prompt the repository owner before landing any policy deviation from this design.
- Prompt the repository owner when a meaningful ambiguity is discovered and the PR would otherwise have to choose a policy direction on its own.

## PR-2: Finalize the now-decided operator defaults in the design document

### Description

This PR should make the design document internally complete and consistent around the
now-decided operator defaults without changing the core model.

### Scope & Changes

- Update [docs/deployments-design.md](/Users/kiltyj/Code/bucknix-fresh/docs/deployments-design.md):
  - verify that the chosen default diff base for `--from-changes` is reflected consistently in all command and automation sections
  - verify that the chosen default smoke timeout budgets by class are reflected consistently in smoke policy and examples
  - verify that the already-defined `smoke.exception` metadata shape is reflected consistently in policy, examples, and validation guidance
  - verify that the minimum branch and protection assumptions for the fast-forward promotion model are reflected consistently
  - optionally refine queue timeout values and stale-run detection details in the design doc without changing the default queued-with-revalidation policy

### Tests (in this PR)

- Manual read-through for consistency with:
  - `Repo-Level Deploy Command`
  - `Smoke Check Policy`
  - `Retry, Concurrency, And Locking`
  - `Promotion And Rollback`
- Prompt the repository owner about any policy deviation, contradiction, or meaningful ambiguity discovered while preparing the PR.

### Docs (in this PR)

- Update [docs/deployments-design.md](/Users/kiltyj/Code/bucknix-fresh/docs/deployments-design.md) with:
  - any missing metadata field naming needed to support the chosen diff-base, smoke, and promotion policies
  - one short note on branch-protection assumptions for promotion if implementation detail needs to be more concrete
  - one short note confirming the `smoke.exception` shape and where validators should read it
  - one short note on queue timeout and stale-run detection detail if more precision is needed

### Acceptance Criteria

- The document consistently defines changed-based deploy selection, lock contention, and smoke timing defaults.
- The promotion model has enough branch-policy detail to serve as input to later implementation planning.
- No section of the design document quietly re-opens already decided operator defaults.

### Risks

The defaults could be chosen too early and later prove awkward in practice.

### Mitigation

Choose defaults that are explicit, conservative, and easy to override through later implementation configuration without changing the core design.

### Consequence of Not Implementing

The design document remains slightly incomplete at the handoff boundary into implementation planning, and later work may have to pause to restate defaults that should already be settled here.

### Downsides for Implementing

Locks in more operator-facing defaults that later tooling must respect.

### Recommendation

Implement.

### Collaboration Note

- Prompt the repository owner before landing any policy deviation from this design.
- Prompt the repository owner when a meaningful ambiguity is discovered and the PR would otherwise have to choose a policy direction on its own.

## Design Completion Recommendation

Complete the design document in phases:

1. finalize the normative operational sections so they fully match the locked decisions in this document
2. add compact summary tables and concrete examples for provenance, promotion, rollback, lock scope, metadata precedence, and smoke policy
3. translate the now-decided defaults into implementation-planning detail without re-opening them
4. run one final consistency pass across the whole document so examples, summaries, appendices, and normative sections all say the same thing
5. declare the document ready for a separate implementation-planning phase

That gives us an implementation-ready design without mixing design completion and production implementation in the same plan.

After those design-document phases are complete, the repository should be ready for a separate
implementation-planning effort.
