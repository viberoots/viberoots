# 23. Get Bob Set Up with viberoots-Based Monorepo

**Tier:** Developer / Stakeholder Enablement
**Priority:** 23 of 44
**Depends on:** #11 Backend Service Build Template(s), #12 Backend Service Deployment Template
**Estimated effort:** M
**Date:** 2026-05-25
**Summary:** Stand up a working viberoots-based monorepo for Bob: devshell, first successful build, first local deploy, and a short operator runbook covering the recurring development and deployment workflow.

## What

Onboard Bob onto a viberoots-based monorepo so he can build, test, and run a first deployment end
to end. This is not about adding Bob as a contributor to the viberoots repo itself — it is about
enabling Bob to operate a separate downstream monorepo that uses viberoots's build system, scaffold
tooling, and deployment infrastructure as its foundation.

The concrete deliverables are:

1. **Repo scaffold** — Bob's repo exists with the standard viberoots-derived layout:
   `build-tools/`, `projects/apps/`, `projects/libs/`, `projects/deployments/`, `toolchains/`,
   `target_platforms/`, `third_party/`, and a working `flake.nix` / `flake.lock`. The forking
   strategy for creating this scaffold (task #31) feeds into this task; if #31 has not resolved a
   canonical forking model, the most practical available path — likely a manual scaffold from the
   current viberoots tree — is taken here and the deviation is documented.

2. **Devshell** — `direnv allow` loads the dev shell without errors on Bob's machine. All required
   tools are accessible: `buck2`, `go`, `node`, `pnpm`, `nix`, `uv`, `zx-wrapper`, `scaf`,
   `deploy`, and the `i`, `b`, `v` wrappers.

3. **First build** — at least one application target (using the backend service build templates
   from task #11) builds successfully through `nix build` or `buck2 build`. The glue pipeline runs
   without intervention: `node build-tools/tools/buck/glue-pipeline.ts` completes, the prebuild
   guard is satisfied, and a clean `v` run produces no failures on the skeleton repo.

4. **First deployment flow** — at least one deployment target (using the deployment template from
   task #12) can be submitted and admitted locally. The minimum bar is a `local_only` deploy that
   admits an artifact, writes a deploy record, and exits without error. A `shared_nonprod` or
   protected/shared run against the existing control plane (or a cloud-hosted successor, depending
   on where task #4 lands) is the stretch goal for this task; the dry-run flow with Bob (task #24)
   takes that stretch further.

5. **Identity** — Bob has a named, scoped identity in the control plane. This cannot happen until
   task #6 (auth provider) lands, so if #6 is not complete this task delivers the local deploy
   path only and records the auth gap as a tracked blocker for task #24.

6. **Runbook** — a short operator-facing runbook or checklist documenting the exact steps Bob
   followed to reach a working state. This runbook lives in Bob's repo, not in viberoots, and
   becomes the seed document for future downstream operator onboarding (task #43 / making
   viberoots public).

## Why Now

Priority 11 is justified by the combination of stakeholder dependency and end-to-end validation
value. Bob represents the first external consumer of the whole stack. Getting him operational
means:

- The backend service build templates (#11) and deployment template (#12) are proven in a real
  downstream context, not just in viberoots's own test suite.
- The scaffold path, devshell, and glue pipeline work for a repo that is not viberoots itself. Any
  gap in the "fork and go" story surfaces here and can be fixed before it affects more users.
- Task #24 (dry-run deployment flow with Bob) is blocked until Bob has a working repo. Deferring
  this task delays the first real validated deployment exercise with an external collaborator.
- Task #7 (auth provisioning IaC) and task #6 (auth provider) call out Bob setup explicitly as a
  motivation for getting identity provisioning auditable and executable from a clean state. Reaching
  that state requires at least one real onboarding attempt to surface what is missing.

## Risks

**Forking strategy (#31) unresolved.** If the canonical mechanism for creating a viberoots-based
downstream repo is not settled before this task starts, the scaffold step must make a pragmatic
choice and document the deviation. A manual copy of the current viberoots tree is a viable fallback
but creates an upstream-tracking burden that will have to be revisited once #31 is resolved.

**Devshell cold start on a foreign machine.** The first `nix develop` on Bob's machine is a cold
pull from the Nix binary cache. If the cache is warm or a NAR is missing, this can take
significantly longer than expected and may surface substituter config or `nix-command`/`flakes`
experimental-feature issues. These are operator-environment problems, not repo bugs, but they will
consume onboarding time.

**Glue pipeline assumptions about repo structure.** The glue pipeline (`export-graph`,
`sync-providers`, `gen-auto-map`) operates against the live Buck graph. If Bob's repo deviates from
viberoots's directory layout expectations — or if the pipeline has hardcoded paths that assume the
repo is viberoots itself — the pipeline can fail with obscure errors. The `build-tools/tools/lib/repo.ts`
and `importer-roots.ts` modules are the most likely places to expose such assumptions.

**Auth gap if #6 is not complete.** Without a real auth provider, Bob cannot have a scoped
identity, cannot log in to the control plane as a named operator, and cannot get an audited
protected/shared deploy. The task can still be delivered for the local deploy path, but the gap
must be clearly tracked so task #24 is not scheduled before #6 completes.

**Provider secrets not yet wired for Bob's deployment family.** A first real protected/shared
deployment requires that Infisical holds the deployment credentials for Bob's deployment target and
that `sprinkleref --check` passes. This requires a live Infisical project for Bob's deployment
family, which in turn requires the OpenTofu provisioning from task #7 (or a manual bootstrap). If
neither has landed, the local-only path is the ceiling for this task.

**Machine environment variation.** viberoots is developed on macOS (Darwin). Bob's machine may
differ in CPU architecture, OS, or available tooling. The devshell is hermetic but `nix develop`
behavior, binary cache availability, and Buck daemon startup are all sensitive to the host
environment in practice. A Linux or ARM host can surface issues not caught during viberoots-native
development.

## Trade-offs

**Local-only deploy first vs. waiting for a full protected/shared path.** Delivering the local
deploy path now validates the build templates and deployment template in a real downstream context
without waiting for task #6 and task #7 to complete. The cost is a two-phase onboarding for Bob:
first local, then protected/shared once auth and provisioning are ready. This is the right
trade-off given that #6 and #7 are themselves L-effort tasks with unresolved dependencies.

**Manual scaffold vs. waiting for #31.** The forking strategy (task #31) may produce a `scaf new
repo` command or a documented template clone path that makes downstream repo creation
deterministic. If #31 is not complete, the manual scaffold approach for Bob creates a one-off
deviation that will need reconciliation later. That debt is preferable to blocking Bob's setup
indefinitely.

**Runbook lives in Bob's repo vs. in viberoots docs.** The operator-facing runbook that captures
the steps Bob followed belongs in Bob's repo so it is maintained alongside the repo it describes.
If it were committed to viberoots, it would encode Bob-specific paths, IDs, and machine details
that have no place in the upstream build system. The trade-off is that viberoots does not
automatically benefit from lessons learned during Bob's onboarding; those lessons must be pulled
back as explicit improvements to the upstream scaffold, handbook, or troubleshooting docs.

## Considerations

**Use the existing technician checklist pattern as the reference.** `docs/nixos-shared-host-technician-checklist.md`
shows what a short, actionable operator SOP looks like in this repo. Bob's onboarding runbook
should follow the same pattern: sequential numbered steps, explicit success criteria for each step,
and a final handoff checklist. Do not invent a new document format.

**`direnv` and `nix-direnv` are prerequisites, not optional.** The getting-started guide
(`docs/handbook/getting-started-on-a-pr.md`) is explicit: `nix-direnv` must be installed before
`direnv allow` is run. Bob must have both installed before the devshell can be loaded. Confirm this
before any other step.

**Prebuild guard is the first real integration test.** After the glue pipeline runs, the prebuild
guard (`node build-tools/tools/buck/prebuild-guard.ts`) verifies that the glue output is fresh and
present. If this fails, nothing else will build cleanly. It is the right first checkpoint in Bob's
onboarding sequence.

**Stale-names enforcement applies to Bob's repo from day one.** If Bob's repo is a fork of
viberoots, the `stale-names-lint` pre-commit hook and verify gate will run and enforce the
canonical naming rules from `docs/contributor-naming-conventions.md`. The blocked legacy project
names are unlikely to appear in a fresh downstream repo, but any copied history or scaffolded
template that surfaces them will fail the pre-commit hook. Bob
should understand this before his first commit.

**The `build-tools/tools/lib/importer-roots.ts` and `repo.ts` modules are the most likely sources
of viberoots-specific assumptions.** These files define how the tooling discovers importers, the
repo root, and the Buck graph. If Bob's repo has a different root name, remote URL, or directory
structure, any hardcoded assumption in these files will surface as a glue pipeline failure or a
surprising error in the provider sync. Inspect and test these paths explicitly during onboarding.

**Identity provisioning needs a reviewed entry point.** Task #7 notes that Bob setup requires the
identity provisioning story to be "documented, auditable, and executable from a clean state." If
#7 is not complete when Bob's onboarding starts, a manual Infisical project bootstrap (following
the `infisical-bootstrap.md` runbook) is the fallback. Document exactly which steps were manual so
they can be replaced by the OpenTofu stack when #7 lands.

**The forking decision (#31) affects long-term upstream tracking, not day-one functionality.** For
the purpose of this task, Bob needs a working repo, not a perfectly upstreamable one. Record what
was done to create the scaffold and what would need to change if a different forking model is
selected later. Do not design a general forking mechanism here — that belongs in #31.
