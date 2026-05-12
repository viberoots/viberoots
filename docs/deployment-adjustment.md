# Deployment Design Adjustment

This addendum records the intended adjustment to the deployment design so the
repository aligns with current GitOps best practices while staying native to the
Buck2-orchestrated deployment model.

The existing deployment design already has several strong foundations:

- `TARGETS` is the authoritative source for deployment metadata.
- Buck2 owns deployment structure, dependency graph, validation, and build
  artifacts.
- Live mutation is kept out of ordinary Buck actions.
- Protected/shared mutation goes through the deployment control plane.
- Deployments use explicit provider target identity, admission policy, immutable
  admitted artifacts, replay snapshots, and deployment records.
- Secrets and runtime config are declared as contract references rather than
  committed values or ambient environment assumptions.

The part that should change is the branch-backed environment lane model. The
design should no longer require long-lived `env/<family>/<stage>` branches for
protected/shared deployment promotion.

## Target Model

Use this split of authority:

- Git `main` stores desired deployment definitions, policy, provider target
  metadata, rollout rules, and shared Buck/Starlark composition.
- Buck2 interprets and validates that desired deployment model.
- CI builds, tests, signs, attests, and submits immutable artifacts or source
  revisions.
- The deployment control plane is the authoritative deployment-state system for
  admitted runs, current stage state, artifact identities, promotion lineage,
  approval evidence, rollback candidates, lifecycle state, audit events, and
  recovery state.

Git should answer:

- what deployments exist
- how they are configured
- what policy and promotion rules apply
- what source refs are allowed

The control plane should answer:

- what is deployed now
- which artifact was admitted
- who or what submitted it
- which checks and approvals admitted it
- which run promoted, retried, or rolled back from which prior run
- whether a run is pending, queued, running, succeeded, failed, superseded, or
  cancelled

This is not pure Argo/Flux-style GitOps where Git is also the release-state
database. It is a controlled deployment model: Git and Buck2 own desired
configuration, while the control plane owns admitted release state. That is the
preferred model for this repository because the deployment system needs
admission payload binding, immutable artifact identity, idempotency, approvals,
audit records, rollback evidence, and in-doubt-run recovery.

## Remove Environment Branches

The design should remove these requirements:

- every protected/shared lane is branch-backed
- every lane must define `stage_branches`
- environment branches govern promotion
- protected/shared admission normally reads from `env/<family>/<stage>`

Long-lived environment branches can become alternate configuration universes.
They increase drift risk and resemble the branch-per-environment model that
modern GitOps guidance generally avoids.

The replacement is:

- `main` is the single Git source of truth for deployment definitions.
- `lane_policy` defines stage ordering, promotion edges, artifact reuse mode,
  compatibility, and governance, but not environment branches.
- admission policies gate source revisions from reviewed refs such as protected
  `main`, release tags, or explicitly reviewed commit references.
- the control plane tracks the current admitted run and artifact for each
  deployment stage.

Illustrative lane policy shape:

```python
deployment_lane_policy(
    name = "lane",
    defaults = "//projects/deployments:defaults",
    stages = ["dev", "staging", "prod"],
    allowed_promotion_edges = ["dev->staging", "staging->prod"],
    artifact_reuse_mode = "same_artifact",
    governance_policy = ":lane_governance",
    visibility = ["PUBLIC"],
)
```

`deployment_lane_governance` should no longer be centered on
environment-branch protections. It should instead describe reviewed source-ref
policy, trusted CI/admission reporters, approval boundaries, and promotion
governance for the lane.

## Do Not Mirror Release Pointers Into Git By Default

Do not add hand-authored or routinely updated release-pointer JSON files to the
repository as the normal source of stage state.

The preferred design is:

- Git PRs change deployment definitions and policy.
- Control-plane approvals and submissions change what artifact is deployed to a
  stage.
- Stage state is stored in the control-plane backend and exposed through
  operator/status APIs.

This avoids a second mutable Git surface whose updates could race with
admission, approval, artifact retention, or rollback logic.

A control-plane stage-state record should preserve information equivalent to:

```json
{
  "deployment_id": "data-room-web-prod",
  "stage": "prod",
  "current_run_id": "run_123",
  "source_run_id": "run_098",
  "source_revision": "git_sha",
  "artifact_identity": "sha256:...",
  "artifact_reuse_mode": "same_artifact",
  "parent_run_id": "run_098",
  "release_lineage_id": "release_456",
  "artifact_lineage_id": "artifact_789"
}
```

If a later governance requirement demands Git-visible promotion evidence, the
repository may add a derived audit mirror on `main`. That mirror must not be an
authoritative deploy input. The control plane must remain authoritative because
it owns the actual admission payload, artifact binding, approval evidence,
idempotency state, lifecycle state, and rollback eligibility.

## Buck2 As The Base/Overlay Replacement

Do not adopt Kustomize as the primary composition mechanism.

The Buck2-native equivalent of base/overlay should be:

- shared deployment-family macros in Starlark
- shared defaults in `projects/deployments/<family>-shared/`
- concrete stage deployments under
  `projects/deployments/<deployment-id>/TARGETS`
- explicit stage deltas for provider target identity, protection class,
  admission policy, runtime config requirements, secret requirements, resource
  sizing, ingress hostnames, smoke checks, rollout policy, and prerequisites
- validation that rejects drift when fields should come from shared family
  policy rather than per-stage copy-paste

Provider-native files may still exist, but they are inputs below the Buck2
deployment metadata layer. They must not become a second source of truth for core
deployment facts.

For Kubernetes, the deployment model should prefer:

- Buck2 metadata for deployment identity, component identity, lane policy,
  provider target, smoke, secrets, runtime config, and rollout policy
- Helm or other provider-native templates only where they are useful as
  rendering mechanisms
- control-plane injection of admitted immutable image digests or artifact refs
- pre-admission rendering or validation of generated values/manifests
- fingerprints or retained copies of rendered values/manifests in the execution
  snapshot

Jenkins, local scripts, or humans should not edit Kubernetes YAML, Helm values,
or image tags as the promotion mechanism.

## Immutable Artifact Promotion

The Kustomize `newTag` recommendation maps to an admitted artifact identity in
this repository, not to a YAML tag update.

For container deployments, use immutable image digests or retained artifact
references. Avoid mutable tags such as `latest`, `dev`, `staging`, or `prod` as
release identities.

For lanes with:

- `artifact_reuse_mode = "same_artifact"`: promotion reuses the exact admitted
  artifact across stages.
- `artifact_reuse_mode = "rebuild_per_stage"`: promotion reuses the admitted
  source revision and requires a newly built, admitted stage-specific artifact
  before the target-stage publish.

Promotion must not silently rebuild during production release unless the lane
explicitly declares `rebuild_per_stage` and the target-stage artifact is admitted
with provenance.

## Operator Flows

First deploy to a lower stage should submit an admitted source revision and
artifact:

```bash
deploy --deployment //projects/deployments/data-room-web-dev:deploy \
  --source-revision "$GIT_SHA" \
  --artifact-ref "$IMAGE_DIGEST_OR_ARTIFACT_REF" \
  --admission-evidence "$JENKINS_CHECKS"
```

Promotion should select an earlier admitted run:

```bash
deploy --deployment //projects/deployments/data-room-web-staging:deploy \
  --promote \
  --source-run-id <dev-run-id>
```

```bash
deploy --deployment //projects/deployments/data-room-web-prod:deploy \
  --promote \
  --source-run-id <staging-run-id>
```

Rollback should redeploy a prior known-good admitted run:

```bash
deploy --deployment //projects/deployments/data-room-web-prod:deploy \
  --rollback \
  --source-run-id <prior-prod-run-id>
```

Rollback must not require moving a branch backward, editing a release-pointer
file, or changing mutable tags.

## CI Integration

The system can remain Git-driven without using environment branches.

Recommended CI model:

- Git event decides when to request a deploy.
- Buck2 decides what deployment metadata and build graph mean.
- CI builds, tests, signs, attests, and submits immutable artifacts.
- The control plane decides whether the run is admitted and executed.
- The control plane records what actually deployed.

For dev:

1. A change merges to protected `main`.
2. Jenkins observes the `main` push.
3. Jenkins runs Buck2 validation, builds, tests, and packaging.
4. Jenkins records artifact provenance, SBOMs, signatures, and checks required
   by admission policy.
5. Jenkins submits the dev deployment request to the control plane.
6. The control plane verifies the source revision, Jenkins identity, required
   checks, artifact-to-source binding, deployment metadata, provider target,
   secret requirements, runtime config requirements, and idempotency key.
7. If admitted, the control plane deploys and records the run.

For staging and production:

- Jenkins may trigger promotion requests automatically or on operator action.
- The control plane must enforce promotion edges, artifact reuse mode,
  compatibility, required approvals, source-run eligibility, and target-stage
  policy.
- Jenkins must not directly mutate protected/shared targets as a peer deployment
  authority.

Suggested policy shape:

| Stage | Trigger | Approval | Artifact behavior |
| --- | --- | --- | --- |
| Dev | Auto on protected `main` merge | Usually none | Build and admit from the `main` SHA |
| Staging | Auto or manual promotion from a dev run | Optional or release-owner | Reuse the admitted dev artifact when the lane is `same_artifact` |
| Prod | Manual promotion from a staging run | Required | Reuse the admitted staging artifact when the lane is `same_artifact` |

This is Git-driven delivery intent, not Git as the deployment-state database.
That distinction avoids the common footgun where CI writes tags, YAML, or
environment branches directly and thereby bypasses admission.

## Footguns To Avoid

The adjusted design should explicitly reject these patterns:

- long-lived branch-per-environment configuration
- release state as hand-maintained Git files
- mutable image tags as deployment identity
- direct Jenkins mutation of protected/shared targets outside the control plane
- manual `kubectl edit` as an accepted path
- ambient kubeconfig, Helm, cloud-provider, or secret environment state for
  protected/shared mutation
- production promotion by rebuilding unless the lane explicitly declares
  `rebuild_per_stage`
- rollback by branch rewind, mutable tag reassignment, or editing pointer JSON
- provider-native config drift that contradicts Buck2 deployment metadata
- approvals that do not bind to the exact source revision, artifact identity,
  target environment, provider target, runtime config references, secret
  references, and reviewed plan/diff when applicable
- replay that reinterprets newer templates, provider config, release actions, or
  metadata instead of using the admitted execution snapshot plus narrow current
  invariant checks

## Required Control-Plane Guarantees

Because the control plane owns release state, the design must preserve and
emphasize these guarantees:

- durable backend storage for admitted runs, current stage state, approval
  evidence, deployment records, artifacts, replay snapshots, and recovery state
- backup and restore objectives appropriate to `shared_nonprod` and
  `production_facing` protection classes
- append-only or otherwise tamper-evident audit events for submissions,
  approvals, promotion, rollback, retry, cancellation, recovery, and break-glass
- stable operator APIs for listing current stage state and explaining why a
  specific artifact is deployed
- idempotent submission and run-action contracts
- exact artifact retention for the supported promotion, retry, and rollback
  windows
- rendered Kubernetes values/manifests or fingerprints retained in execution
  snapshots where rendering affects replay safety
- explicit drift detection or reconciliation policy for live provider state
- secret-safe logs, records, snapshots, events, and dashboards

Operator inspection should answer, without reading environment branches:

- what is deployed in each stage
- which source revision and artifact identity are live
- which run admitted the artifact
- which checks and approvals authorized it
- what the promotion parent was
- what rollback candidates are currently valid
- whether live provider state matches the admitted target state

## Documentation Changes Implied

The existing deployment docs should be updated to reflect these policy changes:

- Replace branch-backed lane invariants with main-backed Buck2 metadata plus
  control-plane-owned release state.
- Remove or rewrite references to `stage_branches` as mandatory lane policy.
- Change admission-policy examples from `allowed_refs = ["env/..."]` to
  protected `main`, release tags, or another reviewed source-ref policy.
- Rewrite promotion descriptions so `--source-run-id` selects an admitted run
  under control-plane state rather than a run made promotable by an environment
  branch.
- Update `deployment_lane_governance` examples to describe source-ref,
  CI/admission reporter, approval, and promotion governance instead of
  environment branch protection.
- Add control-plane current-stage-state read APIs and operator examples if they
  are not already documented.
- Add Kubernetes-specific guidance for digest injection, rendered manifest
  validation, and drift handling without Kustomize.

The adjusted design should be described as:

> Git-triggered, CI-built, Buck2-defined, control-plane-admitted deployments.

That model preserves the important GitOps properties: single source of desired
configuration, reviewable policy, immutable artifacts, reproducible deployment,
auditable promotion, drift control, and safe rollback. It avoids adopting
Kustomize as a second composition layer and avoids environment branches as a
second configuration source.
