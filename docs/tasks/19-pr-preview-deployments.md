# 20. PR/Preview Deployments

**Tier:** Developer Experience
**Priority:** 20 of 44
**Depends on:** #4 Containerize Control Plane, #8 Container Deployment Provider (or #10 Vercel Deployment Provider)
**Estimated effort:** M
**Date:** 2026-05-25
**Summary:** Add Jenkins PR open/close triggers that automatically submit and clean up a preview deployment using the existing Cloudflare Pages preview machinery, reporting the preview URL as a PR comment.

## What

Wire CI automation to the existing preview lifecycle so that opening a PR automatically publishes a
preview environment and closing or merging the PR automatically tears it down.

The low-level preview machinery already exists and is contract-stable:

- `cloudflare-pages-preview.ts` — derives an explicitly isolated preview target from `--source-run-id`.
  The preview branch token is `prv-<sanitized-run-id-prefix>-<8-char-sha256-suffix>`, capped to fit
  within the 64-character Cloudflare Pages hostname budget. The canonical preview URL is
  `https://<preview-branch>.<project>.pages.dev/`.
- `cloudflare-pages-preview-deploy.ts` — `submitCloudflarePagesPreviewDeploy` runs the full
  admission-gated preview publish: resolves the source-run selection, evaluates deployment admission
  with `operationKind = "preview"`, freezes a control-plane snapshot with `publishMode = "preview"`,
  and publishes the admitted exact artifact to the isolated preview target.
- `cloudflare-pages-preview-cleanup.ts` / `cloudflare-pages-preview-cleanup-control-plane.ts` —
  `cleanupCloudflarePagesPreview` calls the Cloudflare Pages deployments `DELETE` endpoint against
  the recorded `providerReleaseId`. Cleanup is a first-class audited `preview_cleanup` operation;
  it records `publish_mode = preview`, the isolated preview target identity, and a canonical cleanup
  reason (`pr_close`, `ttl_expiry`, `manual_cleanup`, or `superseded_preview`).
- `cloudflare-pages-preview-source.ts` — `resolveCloudflarePagesPreviewSelection` validates that
  the source run belongs to the same deployment, uses `publish_mode = normal`, and has
  `final_outcome = succeeded`. The preview identity selector is `{ kind: "source_run", sourceRunId }`.
- `CloudflarePagesPreviewCleanupReason` is a closed enum in the existing contract; `pr_close` is
  already a named member.

What this task adds is the CI glue layer on top of that machinery:

1. **Jenkins PR trigger** — detect when a PR is opened, updated, or reopened against a relevant
   branch. Resolve the set of preview-capable deployments affected by the PR (using
   `--from-changes` or an explicit deployment list). For each deployment: build and admit the
   artifact for the PR head revision, then call `deploy --preview --source-run-id <admitted-run-id>`
   for the resulting admitted run.

2. **Jenkins PR close/merge trigger** — detect when a PR is closed or merged. For each deployment
   that had an active preview run for that PR: call
   `deploy --preview-cleanup --source-run-id <admitted-run-id> --cleanup-reason pr_close`.
   The cleanup must use the same `--source-run-id` that was used to publish; cleanup must not attempt
   to infer the preview slot from the branch name or PR number alone.

3. **Preview URL reporting** — post the canonical preview URL (the `<preview-branch>.<project>.pages.dev`
   URL recorded in the deploy record) back to the PR as a comment or status check so engineers can
   reach the live preview without digging through CI logs.

4. **Deployment metadata opt-in** — preview must be explicitly enabled in deployment TARGETS metadata
   (`deployment.preview` must be non-null). The CI automation must skip preview publication silently
   for deployments that have not opted in, rather than failing or attempting a preview against a
   non-isolated target.

5. **State tracking across PR lifetime** — the CI layer needs a stable mapping from PR identity to
   admitted run id (the source-run-id that was used for preview publication) so that the close
   trigger can issue cleanup against the right run. This mapping must survive Jenkins restarts and
   must not rely on branch naming conventions or provider-side tag state.

## Why Now

The preview publish and cleanup code paths are contract-complete and tested. Without CI glue, every
preview deploy is a manual operator action (`deploy --preview --source-run-id ...` run by hand
against a known admitted run id). That gap means engineers never see a preview URL automatically on
a PR, which removes the main developer-workflow benefit of having preview support at all.

Priority 19 is appropriate: the foundation work (containerized control plane, a preview-capable
provider) must land first, but once those are in place there is no technical dependency blocking
this task from being the next quality-of-life investment.

## Risks

- **Admitted run id availability at PR time.** Preview publication requires `--source-run-id` pointing
  to an already-admitted normal run for the same deployment. On a feature branch that has not yet
  been admitted through the normal CI path, there may be no eligible admitted run. The CI trigger
  must either (a) admit the artifact for the PR head revision as a new deploy run before previewing,
  or (b) fail gracefully and post a "no admitted run available" status rather than attempting preview
  against an unadmitted revision. Option (a) has implications for admission evidence requirements;
  the trigger must hold `admission_reporter` authority for the affected deployment scope.

- **Cleanup reliability on PR close.** If the Jenkins PR-close event is missed (webhook delivery
  failure, worker restart, or the PR is closed while Jenkins is offline), the preview deployment will
  not be cleaned up automatically. A TTL-based janitor using the existing `ttl_expiry` cleanup reason
  is the standard mitigation; this task should define the expected TTL and document whether the
  janitor is in scope or deferred.

- **Lock contention with normal deploys.** Per contract, preview shares the normal deployment lock
  by default unless the preview meets the stronger independent-execution isolation bar. A PR-triggered
  preview that arrives while a normal deploy is running will queue behind it. The CI trigger must
  tolerate lock-wait latency and must not time out and re-submit, which would create duplicate
  queued preview runs.

- **Multiple open PRs per deployment.** If two PRs targeting the same deployment are open
  simultaneously, each generates a distinct `--source-run-id` and a distinct preview branch token
  (because the branch token is derived from the source run id, not from the PR number). Both can
  coexist in Cloudflare Pages without conflict. The state-tracking mechanism must store the
  per-PR admitted run id, not a single "current preview" pointer.

## Trade-offs

- **Admit-then-preview vs. require a prior admitted normal run.** Admitting a fresh artifact at PR
  open time gives engineers a preview of exactly the PR head, but it exercises the full admission
  path (artifact build, attestation, evidence) for every PR update. Requiring a prior admitted normal
  run is simpler but means the preview lags behind the PR head by at least one completed CI cycle.
  The contract explicitly allows preview from an admitted run lineage (`--source-run-id`); the CI
  trigger should document which model it uses and why.

- **Jenkins vs. a dedicated webhook service.** The Jenkinsfile today runs a multi-axis matrix build
  and has no PR-event handling. Adding PR trigger logic to Jenkins is consistent with the existing
  CI topology, but Jenkins PR event handling (via GitHub Branch Source or Multibranch Pipeline) can
  be harder to test than a small dedicated webhook service. Either path must end up calling the same
  `deploy --preview` CLI, so the choice is about where the event-handling logic lives, not what it
  does.

- **Per-deployment opt-in vs. per-deployment opt-out.** The existing code already enforces opt-in
  (`requireCloudflarePagesPreviewSupport` throws if `deployment.preview` is null). The CI layer
  should follow the same opt-in model rather than trying to enumerate deployments that should be
  excluded. This keeps the policy in TARGETS metadata where it belongs.

## Considerations

- The preview identity selector kind is `"source_run"` with a `sourceRunId` field. The CI state
  tracker must persist the `sourceRunId` (a `deploy_run_id` from the admitted normal run) as the
  durable key for later cleanup, not the PR number or branch name. The contract explicitly requires
  explicit selectors; `cloudflare-pages-cli.ts` rejects `--preview` without `--source-run-id`.

- The `CloudflarePagesPreviewCleanupReason` enum is closed. Cleanup on PR close must use `pr_close`.
  The CI trigger must not pass a free-form string; `normalizeCloudflarePagesPreviewCleanupReason`
  will throw on any value not in the reviewed set.

- Preview smoke runs against the isolated `<preview-branch>.<project>.pages.dev` URL, not against
  the custom domain. The smoke connect override pattern in `cloudflare-pages-preview-deploy.ts`
  allows injection of a test endpoint for integration test scenarios, but live PR previews should
  run smoke against the real preview URL with no override.

- The provider capability entry for `cloudflare-pages` gates preview behind `deployment.preview`
  being non-null. Deployments that do not declare `preview` metadata will be skipped at the
  `requireCloudflarePagesPreviewSupport` guard before any API call is made. The CI trigger should
  log a clear message when a deployment is skipped for this reason rather than silently doing nothing.

- Protected/shared preview reuses the target deployment's source-ref policy and required-check gates
  by default (contract §Operator Semantics). The CI trigger must supply appropriate admission
  evidence (`admissionEvidence`) when submitting the preview deploy, including trusted CI check
  results bound to the PR head revision, to satisfy the deployment's `required_checks`. Self-asserting
  checks without a matching `admission_reporter` grant will be rejected.

- Preview cleanup must consume provider credentials through admitted `secret_requirements` and must
  not fall back to ambient `CLOUDFLARE_API_TOKEN` environment variables (contract §Operator Semantics,
  `cloudflare-pages-preview-cleanup.ts` line 26: `allowAmbientProviderToken` is only passed when
  explicitly set). The CI credential model must route the Cloudflare API token through the same
  Infisical path used by normal deploys.
