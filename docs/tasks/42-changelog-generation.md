# 44. Changelog Generation

**Tier:** Advanced Capabilities
**Priority:** 44 of 44
**Depends on:** #28 Document Simple SDLC, #43 Make viberoots Public
**Estimated effort:** S
**Date:** 2026-05-25
**Summary:** Configure `git-cliff` with a `cliff.toml`, define the release tagging convention, add a CI stage that generates the changelog on tagged commits, and optionally surface `changelogRef` in `DeploymentCiAdmissionEvidence`.

## What

Automatically produce a human-readable `CHANGELOG.md` from the repository's git history using
Conventional Commits structure. The changelog should be generated on demand (locally or in CI) and
committed alongside any release tag.

Concretely:

1. **Choose and configure a generation tool.** The repo's commit messages follow Conventional
   Commits consistently: `fix(scope): ...`, `feat(scope): ...`, `docs(scope): ...`,
   `refactor(scope): ...`, `chore(scope): ...` — every recent commit in the log conforms. This
   makes automated parsing reliable. Two credible options:
   - **`git-cliff`** — a single Rust binary available in `nixpkgs`, configured via `cliff.toml` at
     the repo root. Output is fully customizable via a Tera template; supports scoped grouping by
     conventional-commit type. Integrates naturally into the Nix dev shell as a `pkgs.git-cliff`
     input.
   - **`conventional-changelog-cli`** — a Node.js tool installable via pnpm, already in-ecosystem
     given the repo's heavy use of zx/TypeScript build tooling. Less configurable than git-cliff
     for monorepo scoping.
   `git-cliff` is the preferred choice: it is a hermetic binary with no runtime dependency chain,
   its configuration lives in a single `cliff.toml`, and it is available in `nixpkgs-unstable` (the
   locked flake input already in use).

2. **Configure scoping for the monorepo.** The commit scope field (e.g. `infisical`, `deployments`,
   `verify`, `install`, `dev`) maps naturally to subsystem sections in the changelog. The `cliff.toml`
   should define commit groups by type (`feat` → "Features", `fix` → "Bug Fixes", `docs` →
   "Documentation", `refactor` → "Refactoring", `chore` → skipped or collapsed) and optionally
   surface the scope as a secondary grouping dimension. A single repo-level `CHANGELOG.md` is the
   right initial target; per-package changelogs can be layered later if `viberoots` evolves toward
   discrete versioned packages.

3. **Add a `generate-changelog` CI stage.** Add a stage to `build-tools/tools/ci/run-stage.ts`
   that invokes `git cliff --output CHANGELOG.md` and (in dry-run mode) exits non-zero if the
   generated output differs from what is committed. This gate confirms the changelog is never
   stale relative to the tagged commit. The stage should run only on tagged commits or release
   branches, not on every PR build, to avoid noise.

4. **Wire changelog generation into the release flow.** When a release tag is created (e.g. via
   `git tag v1.2.3`), a CI step should run `git cliff --tag v1.2.3 --output CHANGELOG.md`, commit
   the result, and push before the admitted artifact submission begins. This ensures the changelog
   attached to a release artifact reflects the exact commit range covered by that release.

5. **Surface the changelog reference in artifact metadata (optional, low priority).** The
   control-plane artifact admission record already carries extensible metadata. A `changelogRef`
   field pointing to the rendered `CHANGELOG.md` at the release commit SHA can be added to
   `DeploymentCiAdmissionEvidence` in a follow-on pass, analogous to the existing `sbomRefs` field
   added for task #35.

## Why Now

This is priority 42 of 44 — the last item on the list — because it is pure polish. None of the
platform's functional properties depend on a changelog existing. Two upstream tasks must land first:

- **#28 (Document Simple SDLC)** must establish the commit convention as a documented, enforced
  norm before the changelog tool is configured against it. The changelog is only valuable if the
  commit history it reads is consistently structured. Task #28 documents and socializes the
  Conventional Commits requirement that is already practiced but not yet written down.

- **#43 (Make viberoots Public)** is the primary consumer of a changelog. A changelog is useful
  to external contributors and downstream repo operators who want to understand what changed between
  releases. Before the repo is public, the audience for a changelog is the single team that reads
  the git log directly.

After both blockers land, generating the changelog is a small, self-contained task with no
architectural risk.

## Risks

**Changelog staleness.** If changelog generation is manual or optional, it will drift. The CI gate
in step 3 (fail if the committed `CHANGELOG.md` differs from what `git cliff` would produce on the
tagged commit) is the only reliable mitigation. Without this gate, the file will fall behind within
a few releases.

**Scope noise in a monorepo.** All subsystems commit to the same branch under different scopes.
A repo-level `CHANGELOG.md` that lists every `fix(infisical): ...` and `fix(deployments): ...` fix
as a top-level entry will be long and hard to read for an operator who only cares about one
subsystem. Mitigation: configure `cliff.toml` to collapse `fix` commits into a summary count
per-release rather than enumerate them individually, reserving individual entries for `feat` and
breaking changes. This is a configuration choice, not a structural problem.

**Release tagging convention not yet established.** The repo does not currently have a documented
tag format or release cadence. `git cliff` requires a tag to define the "from" commit of each
changelog section. Without tags, `cliff` operates against the full commit history from the
beginning, which produces one monolithic section. A minimal tagging convention (`vYYYY.MM.DD` or
semantic versioning) must be established alongside this task for the changelog to have meaningful
release sections.

## Trade-offs

**`git-cliff` vs. `conventional-changelog-cli`.** `git-cliff` is a single binary with no runtime,
configurable via `cliff.toml`, available in nixpkgs, and integrates cleanly with the Nix dev
shell. `conventional-changelog-cli` is a Node package in-ecosystem with the existing zx/TypeScript
tooling but brings a larger dependency chain and is less hermetic. For a repo that treats Nix
hermeticity as a first-class constraint, `git-cliff` is the more consistent choice.

**Repo-level vs. per-package changelog.** A single `CHANGELOG.md` at the root is simple to
generate and requires no per-package release coordination. The tradeoff is that it merges commits
from all subsystems (`infisical`, `deployments`, `install`, `verify`, etc.) into a single document,
which is broad. Per-package changelogs would be more focused but require a monorepo-aware release
tool (e.g. `release-please`) and a package versioning scheme that does not currently exist. Start
with repo-level; add per-package scoping only if downstream operators request it.

**Committed `CHANGELOG.md` vs. generated on read.** Committing the file to the repo makes it
visible in the GitHub/Gitea UI and in release tarballs without requiring the reader to install
`git-cliff`. The tradeoff is that it is a generated file in the history and must be kept in sync.
The CI staleness gate in step 3 makes this manageable. Generating on read is cleaner in theory
but invisible to operators who browse the repo without the tool installed — the wrong trade-off once
the repo is public.

## Considerations

**`cliff.toml` belongs at the repo root.** `git-cliff` looks for `cliff.toml` at the root by
default. Placing it alongside `Jenkinsfile`, `.tool-versions`, and `pnpm-workspace.yaml` keeps it
findable and consistent with the existing pattern of root-level configuration files.

**Commit type grouping should match the actual type distribution.** Looking at recent history, the
dominant types are `fix`, `feat`, `docs`, `refactor`, and `chore`. The `cliff.toml` should group
`feat` commits as "Features" (always enumerated), `fix` commits as "Bug Fixes" (enumerated or
summarized by count depending on volume), and skip `chore` and `docs` from the public changelog
body unless they are breaking changes. `refactor` can be collapsed or omitted at the operator's
discretion — it is implementation detail, not user-facing change.

**The CI stage should be a no-op on non-release branches.** Adding a changelog generation stage
that runs on every PR build would add latency to the matrix build and produce meaningless partial
changelogs. The stage should be conditioned on the presence of a version tag (or an explicit
`RELEASE=true` environment variable) so it has zero impact on the existing CI pipeline for ordinary
feature branch builds.

**Do not attach the changelog to admission evidence in the first pass.** The optional step 5 above
(surfacing `changelogRef` in `DeploymentCiAdmissionEvidence`) is not worth implementing until the
generation and staleness-gate steps are stable. The deployment admission contract is already complex
enough; adding another optional ref field before the changelog pipeline is proven creates
unnecessary coupling between a polish feature and the core admission flow.

**A tagging convention decision is a prerequisite.** Before `git cliff` can produce meaningful
per-release sections, the team must decide on a tag format. `v0.YYYY.MM.DD` (date-versioned) or
`v0.1.0` (semver) are both reasonable. This decision is out of scope for the changelog task itself
but must be made (and documented in the SDLC doc from #28) before the first tagged changelog
generation run.
