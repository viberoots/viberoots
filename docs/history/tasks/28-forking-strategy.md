# 31. Decide Forking Strategy for downstream products / viberoots

**Tier:** Process & Governance
**Priority:** 31 of 44
**Depends on:** #23 Get Bob Set Up with viberoots-Based Monorepo, #24 Dry Run Deployment Flow with Bob
**Estimated effort:** S
**Date:** 2026-05-25
**Summary:** Evaluate and decide the repository relationship between viberoots (platform) and downstream product (product) — single monorepo, separate repos, or GitHub template — and document the chosen model and its implications for CI, secrets, and deployment identity.

## What

Decide and document the canonical mechanism by which a downstream product repo — such as downstream product —
is created from and related to viberoots. The decision must cover:

1. How the downstream repo gets its initial scaffold (build system, flake, Starlark helpers,
   deployment plumbing, toolchains, `third_party/`, `importer-roots.json`, etc.).
2. How upstream changes in viberoots flow into an existing downstream repo over time, if at all.
3. Whether viberoots's build-tooling and deployment-tooling layers are separable from the product
   code it currently hosts, or whether they remain coupled in a single monorepo.

The concrete candidate strategies to evaluate:

- **Single shared monorepo** — downstream product lives inside viberoots under `projects/apps/` and
  `projects/deployments/`. No forking; one repo, one Buck graph, one flake.
- **Separate repo with manual scaffold** — downstream product is an independent repo whose initial
  `build-tools/`, `toolchains/`, and `flake.nix` are copied from viberoots by hand. Upstream
  updates are adopted manually, with no automated sync path.
- **GitHub template repo** — viberoots (or a stripped derivative) is marked as a GitHub template.
  Downstream repos are created via "Use this template"; no ongoing sync mechanism is provided by
  GitHub.
- **Git subtree** — viberoots's build-tools subtree is managed inside the downstream repo via
  `git subtree`. Upstream changes can be pulled with `git subtree pull`; pushes back upstream are
  possible in principle.
- **Git submodule** — viberoots is referenced as a submodule from the downstream repo. The
  build-tools layer lives at a pinned SHA; update is a deliberate bump.

The output of this task is a written decision recorded in this document or a linked ADR, covering:
the chosen strategy, the rationale, the explicit trade-offs accepted, and the operational steps
required to set up a new downstream repo once the strategy is in effect. If the decision is
"single monorepo", that is also the answer and should state what the boundary between
viberoots-platform code and downstream product code is.

## Why Now

Task #23 (Bob's setup) has already required a pragmatic choice — likely a manual scaffold from the
current viberoots tree — and has documented that deviation explicitly. Task #24 (dry run) exercises
the resulting repo against the real control plane. At the end of both tasks, there is concrete
operational experience with what the downstream setup actually requires and where the friction is.

That experience informs this decision in a way that a theoretical evaluation cannot. The relevant
questions — does `importer-roots.json` need downstream customization? do the `repo.ts`
`WORKSPACE_ROOT`/`LIVE_ROOT` environment anchors work generically? does the stale-names lint
apply cleanly to a repo with different identity strings? — have answers after #23 and #24 are done
and are unknowns before them.

The decision must be made before #43 (make viberoots public) is scoped. A public viberoots repo
implies an external audience, and that audience needs a documented, repeatable, and honest answer
to "how do I start a repo like this?" The current answer — "copy it manually, and the forking
strategy is tracked as task #31" — is acceptable as a private interim but not as a public posture.

## Risks

**Locking in the wrong model before enough data exists.** If this task is resolved before #23 and
#24 produce real onboarding experience, the decision rests on assumptions rather than evidence.
This is why the task depends on both. Do not resolve #31 before those tasks have produced a working
downstream repo with at least one real deployment.

**Single monorepo is the path of least resistance but may not scale.** Putting downstream product inside
viberoots eliminates the upstream-tracking problem entirely but collapses the separation between
the platform layer and the product layer. It means downstream product is subject to viberoots's full
methodology — `AGENTS.md`, stale-names lint, the six-stage CI pipeline, the 250-line file
limit, all of it. If viberoots is intended to become a publicly maintained platform for multiple
downstream products, the monorepo model creates a governance question: who controls the repo, and
how are product-specific changes reviewed against platform conventions?

**Separate repos raise the upstream-tracking cost.** If viberoots releases breaking changes to the
build-tools layer — new `importer-roots.json` fields, a changed `flake.nix` interface, a revised
glue pipeline step — a downstream repo on the manual scaffold path has no automated mechanism to
adopt them. The downstream operator must track the change manually and apply it. At low downstream
count this is manageable; at higher downstream count it becomes a maintenance burden and a source
of version skew.

**Git subtree and submodule introduce operational complexity that may not be justified yet.** Both
models assume the build-tools layer is cleanly separable from the rest of viberoots. The current
repo does not enforce a hard boundary between `build-tools/` and `projects/`; some tool paths
reference `importer-roots.json` convention that may embed viberoots-specific defaults. That
coupling must be understood and either resolved or explicitly accepted before subtree/submodule
is a viable answer.

**stale-names enforcement.** If a downstream repo is a fork of viberoots, the pre-commit hook and
verify gate enforce `docs/contributor-naming-conventions.md` from day one. Blocked legacy project
names and stale remote URLs are unlikely to appear in a fresh downstream repo, but any copied
history or incorrectly scaffolded file that surfaces them will fail pre-commit. This is a
known consideration from #23 and must be factored into whatever scaffold process is documented.

## Trade-offs

| Strategy        | Upstream updates    | Governance boundary     | Setup complexity | CI/build fidelity                      |
| --------------- | ------------------- | ----------------------- | ---------------- | -------------------------------------- |
| Single monorepo | Not needed          | None — same repo        | Lowest           | Identical                              |
| Manual scaffold | Manual, ad hoc      | Implicit, by copy       | Low              | Depends on discipline                  |
| GitHub template | None after creation | None                    | Low              | Identical at fork time                 |
| Git subtree     | `git subtree pull`  | Weak — all files shared | Medium           | Identical if subtree is self-contained |
| Git submodule   | Explicit SHA bump   | Stronger — pinned ref   | Higher           | Depends on module boundary             |

The decision should also consider downstream product's intended lifecycle: is it a single team working
closely with the viberoots author, or is it intended to operate at arm's length? Close collaboration
favors the monorepo. Independent roadmap favors separate repo with explicit versioning.

## Considerations

**The `build-tools/tools/lib/repo.ts` and `importer-roots.ts` modules are the right technical
test cases for separability.** `repo.ts` resolves the repo root via `flake.nix` presence and
`WORKSPACE_ROOT`/`LIVE_ROOT` environment anchors — no hardcoded paths, no viberoots-specific
identity. `importer-roots.ts` defaults to `["projects/apps", "projects/libs"]` when no
`importer-roots.json` is present. These modules appear designed to be generic. Confirm during #23
and #24 whether this holds in practice before claiming the build-tools layer is separable without
modification.

**Task #23 explicitly defers the forking decision.** The #23 task card states: "The forking
strategy (task #31) may produce a `scaf new repo` command or a documented template clone path that
makes downstream repo creation deterministic." That is one possible outcome of this task. The other
outcomes — manual scaffold becomes canonical, monorepo is chosen, or a specific git mechanism is
adopted — are equally valid answers. Do not bias toward the `scaf new repo` outcome without
evidence that it is the right level of investment.

**GitHub template repos do not provide ongoing sync.** A template repo is a one-shot scaffold.
Downstream repos created from it immediately diverge. This is fine if viberoots's build-tools layer
is expected to be stable, but is a problem if the layer is actively developed. At current maturity,
the build-tools layer is not stable — the rename plan alone (docs/history/migrations/repo-rename.md) is still in
progress through PR-7 and PR-8. A template repo created today would encode the current naming
state and would require manual remediation as the rename completes.

**Making viberoots public (#43) does not require the forking strategy to be fully automated.** A
documented, honest manual process is an acceptable public answer if it correctly represents the
current state of the tooling. The forking strategy decision should distinguish between "the
canonical answer" and "the tooling that automates it"; the decision can be made before the tooling
is built, and the tooling can be a follow-on.

**A concrete downstream product should not be named in the viberoots repo.** Downstream product
names should be treated as external context, not committed platform design. This task is the
appropriate place to formalize the generic relationship between viberoots and downstream repos.

**Record the decision as an ADR if the answer is non-obvious.** If the strategy is "single
monorepo", that is simple enough to state in this document. If the strategy involves a separate
repo with a specific mechanism (subtree, submodule, template), a formal ADR in `docs/adrs/`
following the existing pattern is the right artifact — consistent with ADR-00001's treatment of
the monorepo structure decision.
