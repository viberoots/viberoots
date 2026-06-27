# 28. Document Simple SDLC

**Tier:** Process & Governance
**Priority:** 28 of 44
**Depends on:** none (but informed by #24 Dry Run Deployment Flow with Bob)
**Estimated effort:** S
**Date:** 2026-05-25
**Summary:** Write `docs/handbook/sdlc.md` covering the full development lifecycle as it actually works: local dev with the nix devshell, Conventional Commits, the Jenkins CI stage pipeline, code review, merge, and the path to production.

## What

Write a concise SDLC reference document — one place a new contributor or downstream repo operator
can read to understand exactly how a change moves from idea to production in a viberoots-based
repo. The document describes what actually happens today, not an aspirational process.

The document should cover the full life cycle in plain language:

1. **Local development** — clone, `direnv allow` + `nix-direnv`, verify dev shell (`nix --version`,
   `buck2 --version`, `node --version`, `go version`). Edit code. Regenerate glue if Buck graph or
   provider mappings changed (`node build-tools/tools/buck/glue-pipeline.ts`). Run the test suite
   locally before pushing: `i && b && v` (coverage off by default; see `TESTING.md` for the
   canonical policy).

2. **Commit and push** — Conventional Commits format, real newlines, no `--no-verify`. Pre-commit
   hooks enforce file-size lint, stale-name checks, and lint-staged scoping. Push to a feature
   branch.

3. **CI pipeline** — Jenkins picks up the branch and runs a matrix build across
   `aarch64-darwin`, `aarch64-linux`, and `x86_64-linux`. Each matrix cell executes the following
   stages in order via `node build-tools/tools/ci/run-stage.ts --stage <name>`:
   - `codegen` (optional, best-effort)
   - `export-graph` — freeze Buck graph to `build-tools/tools/buck/graph.json`
   - `sync-providers` — regenerate language provider rules deterministically
   - `gen-auto-map` — map targets to providers for tight invalidation
   - `prebuild-guard` — fail fast if glue is stale or missing (no auto-fix in CI)
   - `nix-gaps-policy` — policy gate on inventory/exception allowlist drift
   - `cpp-addon-smoke` — C++ addon viability check
   - `file-size-lint` — strict source-file size enforcement (`--scope=source --fail=true`)
   - `patches-lint` — strict patch format enforcement for Go and Python
   - `nix-build-graph-generator` — hermetic Nix build warms the store per arch
   - `wheelhouse-preload` — Python wheelhouse build + optional binary cache push
   - `buck-test` — full test run; coverage is a separate explicit opt-in pass

4. **Review** — PR is reviewed against `AGENTS.md` and `build-tools/docs/build-system-design.md`
   for architectural compliance (SoC, DRY, KISS, file-size, determinism). CI must be green on all
   three matrix platforms before merge.

5. **Merge** — squash or merge commit to `main`. Generated glue is not committed; CI regenerates
   it from scratch on every run.

6. **Deployment** — changes that affect a deployment target follow the deployment contract in
   `docs/deployments-contract.md`. The short version: `TARGETS` is authoritative; Buck extracts
   metadata; the `deploy` CLI submits to the control plane; protected/shared mutation requires
   CI-attested artifact admission, optional approval, and control-plane worker execution. Local-only
   targets can be deployed directly for dev/smoke purposes.

The output is a single Markdown file, likely `docs/handbook/sdlc.md`, that fits comfortably in one
reading session. It links to the existing detailed docs (`TESTING.md`, `docs/handbook/ci.md`,
`docs/deployments-contract.md`, `docs/handbook/getting-started-on-a-pr.md`) rather than
duplicating them.

## Why Now

Two concrete dependencies make this useful at priority 25:

- **Bob onboarding (#23, #24).** The dry-run experience with Bob is the highest-fidelity signal
  available for what a new operator actually needs to understand to operate a viberoots-based repo.
  This document should be written after that experience is available, so it describes the real
  friction points rather than a hypothetical happy path.

- **Making viberoots public (#43).** Task #43 blocks on new contributors having a viable entry
  point. A getting-started guide and a PR walkthrough already exist
  (`docs/handbook/getting-started-on-a-pr.md`), but they are dense and implementation-oriented.
  The SDLC document is the higher-altitude complement: it answers "what is the overall process?"
  before diving into commands and tooling details.

Priority 25 places this after the majority of the build and deployment infrastructure is
established, so the document describes something stable rather than infrastructure still actively
changing.

## Risks

**Process drift between writing and reality.** The Jenkinsfile, the CI stage runner
(`build-tools/tools/ci/run-stage.ts`), and the deployment contract are all actively maintained.
A doc written at point-in-time can fall out of date quickly. Mitigation: keep the document at the
right altitude — describe the stage names and the logical flow, not the exact flags of each stage
runner invocation. Link to the authoritative sources for details.

**Scope creep toward a tutorial.** `docs/handbook/getting-started-on-a-pr.md` is already a long,
detailed contributor guide. The SDLC document risks becoming a second version of the same content.
The constraint is: one page, lifecycle overview only, link out for depth. If sections start
duplicating existing handbook content, cut them.

**Dependency on #24 for real experience.** If task #28 is started before #24 completes, the
deployment section of the SDLC will be based on docs rather than operator experience. That is
acceptable but produces a less grounded document. The "depends on" relationship is soft — the doc
can be drafted early and updated after #24 — but the deployment section in particular benefits from
having been exercised end to end with a real operator.

## Trade-offs

**One document vs. updating existing docs.** An alternative to a new `docs/handbook/sdlc.md` is
adding an SDLC overview section to an existing doc such as `docs/handbook/getting-started-on-a-pr.md`
or the top-level `README.md`. The trade-off: adding to existing docs risks further increasing the
length of files that are already long. A standalone `sdlc.md` is easier to link to from `#43` and
from the future public-facing contribution guide, and it keeps the lifecycle overview separable
from the implementation detail in the contributor guide.

**Level of detail in the deployment section.** The deployment contract (`docs/deployments-contract.md`)
is highly detailed and policy-oriented. The SDLC document should not reproduce it. The right depth
for the SDLC is: what triggers a deployment, what the operator invokes, what the control plane
decides, where to read for more. Everything past that belongs in the deployment-specific docs.

## Considerations

**Use `docs/handbook/ci.md` as the canonical reference for stage details.** That document already
describes what each CI stage does at the right level of abstraction. The SDLC document should link
to it rather than repeating the stage descriptions.

**The three-word local workflow is `i && b && v`.** This is the canonical pre-push command cited
in `docs/handbook/getting-started-on-a-pr.md` and enforced by the methodology. The SDLC document
should surface this explicitly and prominently so new contributors learn it immediately.

**Jenkins is the current CI system, not a future aspiration.** The Jenkinsfile uses a matrix build
across three architectures with no agent-level caching beyond what Nix and Buck provide natively.
Document this as the actual mechanism, not as "CI of some kind."

**Generated glue is never committed.** This is a meaningful constraint that differs from many
monorepos. CI regenerates glue from scratch. Local development regenerates it on demand. Any SDLC
document that omits this will cause contributor confusion when they see that `graph.json`,
`auto_map.bzl`, and provider files are not in the repo history.

**AGENTS.md is a general methodology, not a viberoots-specific SDLC doc.** It defines coding
principles and enforcement checkpoints but does not describe the actual lifecycle of a change in
this repository. The SDLC document fills that gap — it should reference the methodology for the
quality gate it imposes on code review, without reproducing the methodology text itself.

**Link to `docs/deployments-contract.md` for the deployment section, but do not excerpt it.** The
contract document is long and policy-dense. The SDLC should give a one-paragraph summary of
"how a change reaches a protected/shared deployment" and link to the contract for everything else.
