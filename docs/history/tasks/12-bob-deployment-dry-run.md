# 24. Dry Run Deployment Flow with Bob / Iterate

**Tier:** Developer / Stakeholder Enablement
**Priority:** 24 of 44
**Depends on:** #12 Backend Service Deployment Template, #23 Get Bob Set Up with viberoots-Based Monorepo, #4 Containerize Control Plane
**Estimated effort:** M
**Date:** 2026-05-25
**Summary:** Walk Bob through a full protected/shared deploy against a real target, document every friction point, and iterate on CLI error messages, docs, and tooling until the flow is self-service from the runbook.

## What

Conduct a live end-to-end deployment dry run with Bob — a stakeholder using viberoots as the
foundation for their own monorepo — against a dev or shared_nonprod target. Walk through the full
deployment flow together: client profile install, deployment definition, secret/Infisical wiring,
artifact build, deploy CLI invocation, approval (if required), status check, and smoke validation.
Capture every friction point and iterate on docs, tooling, or templates until the flow is
repeatable without hand-holding.

The dry run is not a simulation. It uses the real `deploy` CLI, the real control plane at
`the deployment control plane endpoint` (or its containerized successor), and real deployment metadata in Bob's
repo. The target is a dev or shared_nonprod classification — either a `nixos-shared-host` target
on the shared control plane or a provider Bob's repo is already using — so no production resources are at risk.

Concrete activities:

**Pre-run checklist**

- Confirm Bob's monorepo has a deployment package in scope from #12 and #23 with a valid TARGETS
  file, declared lane and admission policy, and at least one secret requirement or runtime config
  requirement populated.
- Confirm the control plane is reachable: `the deployment control plane endpoint` for the hosted service, or
  the containerized successor from #4.
- Confirm Bob has a client profile installed via
  `nixos-shared-host-install client install --profile <profile> --control-plane-url <deployment-control-plane-endpoint>`
  (or equivalent for the chosen provider). This URL belongs to client-profile setup; reviewed
  protected/shared deploy targets should still select their control plane through checked-in
  deployment context/profile metadata.
- Confirm Bob holds `submitter` and `admission_reporter` grants for the target deployment scope.
  Use `deploy auth explain-groups --deployment <label> --action submit` to verify the expected
  group shape before the run, then use
  `deploy admin identity grant-user --profile <profile> --action submit --user-email <bob@example.com> --apply-host`
  if the grant is absent.
- Confirm the Infisical project for Bob's deployment family is bootstrapped (per the one-command
  flow: `build-tools/tools/deployments/infisical-bootstrap.ts deployment --target <label>`) and
  that the required secret values are populated outside the bootstrap command.
- Run `deploy --deployment <label> --validate-only` and verify `admissionRequirements` contains no
  unresolved policy gaps before attempting a live run.

**Run sequence**

1. Build the artifact for the target deployment (via Buck/Nix or the standard app build path from
   Bob's repo).
2. Run the remote plan to confirm destination, artifact identity, and service client block:
   `deploy --deployment <label> --profile <profile> --plan`.
3. Run the full deploy:
   `deploy --deployment <label> --profile <profile> --artifact-dir ./dist`
   (or omit `--artifact-dir` if the deployment target resolves the artifact automatically).
4. If the run returns `pending_approval`, check status and approve:
   `deploy --deployment <label> --profile <profile> --status --text --deploy-run-id $RUN_ID`
   `deploy --deployment <label> --profile <profile> --approve --deploy-run-id $RUN_ID --approval-id <ref>`
5. Confirm the run reached a successful terminal state and smoke passed.
6. Optionally exercise a retry and a rollback using `--publish-only --source-run-id` against the
   completed run to verify the replay path also works end-to-end.

**Iteration loop**

After each friction point — a confusing error, a missing doc reference, a template placeholder
that was not obvious, a gap in the client profile install steps — file a specific note and fix it
in the same session if the fix is a one-liner, or create a tracked follow-on item if it requires
a design change. The goal is to close the gap between the documented happy path in
`docs/deployments-usage.md` / `docs/nixos-shared-host-usage.md` and what Bob actually encounters.

Iteration targets in scope:

- `docs/nixos-shared-host-usage.md`: first-time setup sequence, client profile install flags,
  `--validate-only` step, identity grant self-service path.
- `docs/nixos-shared-host-technician-checklist.md`: any SOP step that breaks on Bob's machine.
- Deployment scaffold templates from #12: placeholder values that must be replaced, copier
  variables that were unclear, missing examples in generated comments.
- `deploy admin identity grant-user --profile default` flow: any error that does not clearly
  distinguish missing `submitter` from missing `admission_reporter` access.
- Infisical bootstrap output: any step where the next action is not obvious from the output alone.
- Error messages from the deploy CLI that return `unauthorized` without actionable next steps.

## Why Now

This is the highest-signal validation step in the task sequence. The deployment system has been
built and tested in fixtures and hermetic test workspaces, but it has not been driven by an
external operator working from their own repo. Bob is the first external stakeholder attempting
this, which means every assumption baked into the docs, scaffolding, and CLI UX gets tested
against reality at once.

Running this at priority 12 — directly after the deployment template (#12) and Bob's repo setup
(#23) are in place — ensures that friction surfaces early, while the people who built the system
are still actively iterating on it. Waiting longer risks hardening rough edges into permanent doc
debt or undocumented workarounds that Bob and future adopters have to discover independently.

The dry run also validates the full end-to-end chain that no single unit or integration test can
cover: real secret resolution through Infisical, real artifact staging through the SSH-backed
profile, real control-plane admission and worker execution, and real smoke against a live target.
If any component in that chain has a real-world gap — a missing credential file name, a stale
env var reference, a provider capability that only works in fixtures — this session will surface
it.

Downstream tasks that depend on a working external onboarding path (making viberoots public at
#43, future external adopters) benefit from a clean, verified first-operator experience here.

## Risks

**Control plane availability.** If the containerized control plane from #4 is not yet live and
the legacy self-hosted control-plane host is serving the deployment control plane endpoint directly, the session is at risk from any host
maintenance window or Keycloak state drift. The fallback is to run against the hosted
service directly, accepting its limitations (single-replica, no horizontal worker scaling), but
this limits how much of the PR-2/PR-3 coordination path gets exercised.

**Identity state gaps.** Bob's user identity may not yet be provisioned in the Keycloak realm on
the current auth provider. The `deploy admin identity grant-user --profile default`
reviewed path should handle this, but if the auth provider from #6 (Supabase/WorkOS) is not yet
live and the old Keycloak realm has drifted, provisioning Bob's identity may require direct realm
editing instead of the reviewed remote-profile flow. This is a real setup cost, not just a doc
gap.

**Infisical bootstrap prerequisites.** The one-command bootstrap flow requires a working Infisical
organization, a resolved `--org-name`, and a short-lived admin token or interactive login. If
Bob's deployment family has not yet been bootstrapped and the Infisical org is not set up, the
pre-run checklist blocks before a single deploy command runs. The bootstrap flow itself is
reviewed but requires operator judgment on which secrets to populate after the project is created.

**Artifact build hermeticity on Bob's machine.** If the deployment template from #12 uses a
Buck/Nix artifact target and Bob's monorepo does not yet have a fully wired Nix dev shell, the
artifact build step may fail on Bob's machine for reasons unrelated to the deploy system. Separate
the artifact build failure mode from the deploy path failure mode so the session stays productive.

**Scope creep during the session.** A live dry run with a stakeholder creates pressure to fix
everything in real time, including issues that are design questions rather than one-liner fixes.
Timebox the session to the deploy flow itself; capture design-level friction as follow-on items
rather than resolving them on the spot.

## Trade-offs

**Live run on the legacy self-hosted control-plane host vs. a disposable fixture environment.** Running against the legacy self-hosted control-plane host
(`shared_nonprod`) means any provisioning side effects (new NixOS container, new nginx vhost,
updated platform state) are real and visible to other users of the shared host. A disposable
fixture environment would be safer but does not exist yet and would not test the real SSH staging
or Infisical credential resolution paths. The `shared_nonprod` classification is the correct risk
level for this: it is explicitly not production, it does not carry production admission policy, and
smoke failures on the legacy self-hosted control-plane host do not affect live traffic.

**One session vs. multiple shorter sessions.** A single longer session that covers the full flow
from client profile install through rollback is higher signal but harder to schedule and more
exhausting. Multiple shorter sessions (install + first deploy in session one; retry/rollback/
approval in session two) are easier to slot but risk losing continuity between runs. Prefer one
session covering the critical path with optional follow-up for the edge-case flows.

**Fixing gaps in the session vs. recording and fixing after.** Inline fixes to docs during the
session keep Bob unblocked immediately but create risk that fast edits are incomplete or introduce
inconsistencies. Recording the gap and fixing it carefully after, then re-verifying before the
session ends, is slower but safer for doc quality. In practice: fix typos and missing command
examples inline; defer architecture-level doc restructuring.

## Considerations

**Validate-only as a pre-flight.** The reviewed `--validate-only` flag emits `admissionRequirements`
including `admission_policy`, `source_ref_policy`, `allowed_refs`, `required_checks`,
`required_approvals`, and `trusted_admission_reporters` without mutating anything. This is the
right pre-run step for Bob to understand what the deployment expects before any secret or artifact
is involved. Make this step explicit in the session checklist and in `docs/nixos-shared-host-usage.md`.

**Error message quality is a first-class deliverable.** Every `unauthorized` response that does
not distinguish missing `submitter` from missing `admission_reporter`, and every status response
that does not give Bob an actionable next step, is a bug in UX, not just a gap in docs. Failures
that return a clear follow-up command (`deploy auth explain-groups --deployment <label> --action
submit`) are acceptable; failures that return an opaque HTTP status are not. Any error encountered
during the session that lacks a clear action path should generate a follow-on fix item for the
CLI output.

**The technician checklist is the support doc.** `docs/nixos-shared-host-technician-checklist.md`
is the short SOP handoff path. If Bob cannot follow that checklist from a fresh machine without
assistance, the checklist is the primary artifact to fix. Use the dry run as a live readthrough of
the checklist from Bob's perspective.

**Identity grant self-service.** The normal `deploy admin identity grant-user --profile default
--action submit --apply-host` path (without `--user-email`) grants the logged-in human. Bob should
be able to grant himself `submitter` access after initial auth is established, without requiring a
separate admin to run the command on his behalf. If this self-service path is broken or requires a
privilege that Bob does not have, record it as a follow-on: the goal is for external operators to
onboard with minimal per-user manual steps from the repo owner.

**Source revision and service-side lane governance.** The control plane fetches the reviewed
source ref from the configured SCM remote rather than trusting Bob's local checkout. If Bob's
repo has not yet configured `VBR_DEPLOY_GITHUB_TOKEN` on the service host for GitHub-backed lane
governance verification, the deploy will either fail closed or fall back to the compatibility path
requiring explicit `--admission-evidence-json`. Confirm the GitHub token is configured on the
service side before the session.

**Record the exact commands that worked.** After the session, append the exact command sequence
that produced a successful run (with placeholder values) to the relevant usage doc or technician
checklist. This is the artifact that future external operators will use. A successful dry run that
leaves no updated docs is a missed opportunity.
