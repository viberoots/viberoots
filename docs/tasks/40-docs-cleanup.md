# 42. Clean Up / Organize viberoots Docs

**Tier:** Advanced Capabilities
**Priority:** 42 of 44
**Depends on:** none
**Estimated effort:** M
**Blocks:** #41 make viberoots public
**Date:** 2026-05-25
**Summary:** Archive stale content (`build-history/`, `design-history/`, completed migration runbooks), add a `docs/README.md` navigation index, update the top-level `README.md` with a project overview, and remove the committed `.DS_Store`.

## What

Audit, prune, consolidate, and cross-reference the `docs/` directory so it is coherent enough to
present to external contributors. This is housekeeping work, not new feature documentation.

The current state of `docs/` is the product of organic growth across a multi-year build-system
evolution. The directory is large (roughly 180 files across 8 subdirectories), contains several
distinct documentation types that are not cleanly separated, and has no index or navigation aid.

**Concrete sub-tasks, in order:**

1. **Identify and archive or delete stale documents.** The following categories are candidates:

   - `docs/build-history/` — 78 files of alignment notes (`quad-alignment-1.md` through
     `quad-alignment-40.md`, `trio-alignment-*.md`, `hmr-phase-*.md`, `cpp-patches-final.md`, etc.)
     representing incremental session notes from active development. These are not reference material;
     they are session logs. They should either be archived outside the main tree or deleted. Two
     log files (`verify-2026-02-09T20-03-53-668Z-9970-7d1a04585c6af.log`, `verify-timing-41min.log`)
     and two move-map text files also live here and are purely ephemeral.

   - `docs/design-history/` — 50+ files of similar session-note and completion-checkpoint
     material (`PR1-COMPLETE.md`, `PR2-SUMMARY.md`, `linking-plan-1.md` through `linking-plan-11.md`,
     `quad-alignment-41.md` through `quad-alignment-48.md`, `cpp-go-cleanup.md` through
     `cpp-go-cleanup-4.md`, etc.). Each file captures one iteration of a past design pass. None of
     these are reference documents; they are snapshots that have been superseded by the code that
     landed them.

   - `docs/cpp/` — four files about C++ provider work (`curated-providers.md`,
     `drop-cpp-provider.md`, `nix-built-cpp-test.md`, `overlays.md`). `overlays.md` is referenced
     from `README.md` and is current. The others may be historical notes from a now-stable C++
     provider path. Evaluate each for current relevance before deleting.

   - `docs/pnpm/` — eight files covering Node/pnpm integration work. Several (e.g.,
     `pnpm-go-cpp-parity.md`, `pnpm-go-cpp-parity-2.md`, `node-pr-3.5.md`) appear to be PR-session
     notes rather than ongoing references. `hermetic-node-modules.md`, `pnpm-exporter-adapter.md`,
     and `node-golang-addon.md` may have reference value. Evaluate each.

   - Root-level one-off docs that have been fully executed: `repo-rename.md` (the rename is
     complete), `runtime-prefix-migration.md`, `pleomino-deployment-directory-migration.md`,
     `host-migration-instructions.md` (Parts A-C are historical; Part D may still be active),
     `deployment-scope-cleanup.md`. Verify each is no longer actionable before removing.

   - `docs/handbook/` contains a mix of authoritative reference docs (`testing.md`, `ci.md`,
     `tooling.md`, `conventions.md`, `patching.md`, `starlark-api.md`) and plan/session docs
     (`nix-gaps-plan.md`, `nix-gaps-prs.md`, `nix-gaps-baseline.md`, `nix-gaps-exceptions.json`,
     `nix-gaps.md`, `e2e-test-gaps.md`, `reorg-phase-0-baseline.md`, `cpp-provider-sync-migration.md`,
     `logging-enhancement.md`). The nix-gaps cluster in particular (`nix-gaps-plan.md`,
     `nix-gaps-prs.md`, `nix-gaps-baseline.md`, `nix-gaps.md`) is a completed migration effort (PR-1
     through PR-26 are implemented per `nix-gaps-prs.md`). These files should move to an archive or
     be trimmed to a short completion notice pointing at the enforcement tests now in place.

2. **Add a `docs/README.md` navigation index.** The `docs/` directory has no index file. A reader
   opening `docs/` on GitHub sees 180 files with no orientation. The index should describe each
   active subdirectory, list the primary reference documents by category (design, contract, usage,
   runbooks, handbook), and note that `build-history/` and `design-history/` are historical archives
   rather than current reference material.

3. **Add a `docs/adrs/README.md` process document (task #27 output).** This is a separate task
   (#27) but is a prerequisite for a complete docs index. Coordinate with or merge with #27.

4. **Add or update a `docs/tasks/README.md` index.** The 35 existing task files have no index.
   A brief table of tasks by number, title, tier, and status (if known) would make the task list
   navigable without reading each file.

5. **Review `README.md` for accuracy.** The top-level `README.md` is titled "Go build — Nix-first
   quickstart" and describes Go scaffolding workflows in detail. It does not mention: the deployment
   system, the control plane, Infisical secrets, TypeScript/zx tooling, or the ADR corpus. It also
   does not acknowledge that viberoots is a multi-language monorepo beyond its opening build-system
   context. For public presentation, `README.md` should introduce the project at a higher altitude
   (what viberoots is, what it does, why) and link to `docs/handbook/getting-started-on-a-pr.md`
   and `docs/handbook/sdlc.md` (task #28 output) for onboarding detail. The current Go-quickstart
   content can remain but should be subordinate to a project overview section.

6. **Verify cross-references are not broken by any deletions.** `README.md` currently references
   `docs/handbook/patching.md`, `docs/handbook/new-language-walkthrough.md`,
   `docs/handbook/adding-language.md`, `docs/cpp/overlays.md`, `docs/handbook/ci.md`,
   `docs/handbook/troubleshooting.md`, `docs/handbook/testing.md`, and
   `docs/handbook/macro-stamping-cookbook.md`. Several other docs link to each other using absolute
   paths (e.g., `control-plane-plan.md` links to `cloud-control-design.md` and `infisical-plan.md`).
   Any deletion must be preceded by a grep for inbound links.

**Files confirmed as current reference material to preserve intact:**

- `docs/deployments-design.md`, `docs/deployments-contract.md`, `docs/deployments-schema.md`,
  `docs/deployments-usage.md`, `docs/deployment-provider-capabilities.md`,
  `docs/deployment-scenarios.md` — the normative deployment model cluster
- `docs/control-plane-plan.md`, `docs/cloud-control-design.md`, `docs/control-plane-containerization.md`,
  `docs/control-plane-nixos-container-module.md`, `docs/control-plane-non-nixos-host-profile.md`,
  `docs/control-plane-runtime-configuration.md`, `docs/control-plane-web-ui.md`,
  `docs/control-plane-mcp.md`, `docs/control-plane-horizontal-scaling.md` — the containerization
  and operations cluster
- `docs/infisical-design.md`, `docs/infisical-plan.md`, `docs/infisical-bootstrap.md` — the
  secrets cluster
- `docs/sprinkleref.md`, `docs/sprinkleref-check.md` — the sprinkleref reference tooling
- `docs/deployment-control-plane-observability.md`, `docs/deployment-adjustment.md`,
  `docs/deployment-family-composition.md`, `docs/deployments-implementation-plan.md`,
  `docs/deployment-plan.md`, `docs/deployment-secrets-api.md`, `docs/deployment-verify-scope.md`,
  `docs/external-deployments-plan.md` — the deployment operations cluster
- `docs/nixos-shared-host-setup.md`, `docs/nixos-shared-host-technician-checklist.md`,
  `docs/nixos-shared-host-usage.md` — the NixOS host runbooks
- `docs/handbook/` authoritative references: `testing.md`, `ci.md`, `tooling.md`, `conventions.md`,
  `patching.md`, `starlark-api.md`, `new-language-walkthrough.md`, `adding-language.md`,
  `troubleshooting.md`, `getting-started-on-a-pr.md`, `macro-stamping-cookbook.md`,
  `exporter-adapter-cookbook.md`, `planner-plugin-cookbook.md`, `provider-sync-cookbook.md`,
  `language-interop.md`, `node-macros.md`, `node-tests.md`
- `docs/contributor-naming-conventions.md` — enforced by lint
- `docs/adrs/` — all 8 ADRs, current and authoritative
- `docs/tasks/` — all task descriptions, including this one
- `docs/json-prompt-usage.md` — active tooling reference

## Why Now

Task #43 (make viberoots public) depends on this. The current `docs/` directory presents poorly to
a first-time reader: it contains more historical session notes than reference material, has no
navigation index, and a `README.md` that describes only Go builds. A public repository with 180
undifferentiated docs files is harder to evaluate and contribute to than one with a clear structure.

Clean docs also reduce the surface area that `stale-names-lint` must cover. Deleted files cannot
produce stale-name violations on future rename passes.

Priority 40 makes sense: most of the design and plan documents that have been actively in flux are
now stable enough to leave alone, so the risk of auditing them is lower than it would have been
six months ago.

## Risks

**Deleting a document that is referenced but not obviously linked.** Some documents are linked from
handbook entries, plan files, task descriptions, or inline code comments rather than from an index.
A grep for the filename is necessary before any deletion, not just a scan of the most obvious
referencing documents. The deployment plan (`docs/deployment-plan.md`) in particular links to a
large number of peer documents using absolute paths that will break silently if the target is
removed.

**Misjudging what is "historical."** `docs/design-history/quad-alignment-42.md` through
`quad-alignment-48.md` are in `design-history/` but continue the numbering of `build-history/`
files. The content must be read, not just dated, before a file is classified as archivable. A
completed plan entry that still contains the only written record of a non-obvious constraint is
not archivable even if the implementation work is done.

**README.md revision scope creep.** Rewriting `README.md` to introduce the project can expand
into a full onboarding doc. Keep it under 150 lines: project overview, quick-start links, key
concept summary, pointer to handbook. Anything longer belongs in `docs/handbook/sdlc.md` (task #28)
or `docs/handbook/getting-started-on-a-pr.md`.

**Stale-names-lint on renamed or new files.** Any new index files (`docs/README.md`,
`docs/adrs/README.md`, `docs/tasks/README.md`) must pass the stale-names lint check. Do not use
former repository names, repo-identity uses of generic legacy names, old personal remotes, or
fresh-clone placeholder names in any new or updated document.

## Trade-offs

**Archive vs. delete for `build-history/` and `design-history/`.** Moving the session-note
directories to a top-level `archive/` directory or a `docs/archive/` preserves git history
accessibility without cluttering `docs/`. Outright deletion keeps the tree smaller and removes
lint surface area permanently. The cost of deletion is that the reasoning behind some non-obvious
build-system decisions becomes harder to trace through git log alone. The recommendation is to
delete files that are pure session logs (timing logs, move-map text files, completion-checkpoint
notes) and archive files that contain the only prose record of a constraint or decision that is not
yet captured in an ADR, design doc, or code comment.

**One navigation index vs. per-directory READMEs.** A single `docs/README.md` is easier to
maintain but requires a reader to return to it each time they descend into a subdirectory. Per-
directory READMEs provide in-place orientation but multiply the maintenance surface. The
recommendation is `docs/README.md` for the top level, `docs/adrs/README.md` for the ADR process
(already specified in task #27), and `docs/tasks/README.md` as a lightweight table. Other
subdirectories (`handbook/`, `cpp/`, `pnpm/`) do not need their own READMEs if the top-level index
describes them clearly.

**README.md scope.** The current `README.md` serves as a detailed Go-quickstart. Replacing it with
a project overview will be noticed by anyone who has bookmarked it as the Go build reference. The
trade-off is acceptable: the Go quickstart content should move to a `docs/handbook/go-quickstart.md`
(or an existing handbook doc) and be linked from `README.md`, not removed.

## Considerations

- Run `grep -r "docs/build-history\|docs/design-history" /Users/kiltyj/Code/viberoots/docs /Users/kiltyj/Code/viberoots/README.md` before archiving any file in those directories. Inbound references from active documents prevent deletion.

- The `docs/handbook/nix-gaps-baseline.md` file is machine-generated (it records a `node ...` command and a timestamp). Its regeneration command is embedded in the file. If the file is useful for future baseline comparisons, document where to regenerate it. If the migration it tracked is complete and enforced by tests, the file is archivable.

- `docs/handbook/nix-gaps-exceptions.json` is a machine-read allowlist. Check whether any tooling still references it before removing it. If the nix-gaps policy is now enforced by a different mechanism, the file can go.

- `docs/handbook/reorg-phase-0-baseline.md` is a three-section snapshot recording that `i`, `b`, `v` passed at a specific reorg moment. This has no ongoing reference value and is a clear deletion candidate.

- `docs/design-history/PR1-COMPLETE.md` and `docs/design-history/PR2-SUMMARY.md` are completion checkpoints for past PRs. These are the purest examples of archivable content: they were useful when the PR was being reviewed and have no ongoing reference value.

- METHODOLOGY.XML section `DocumentationBuildingProcess` asks "Is there enough documentation for future reference?" and "Does the documentation accurately reflect the current state of the system?" Both questions apply here. The session-note accumulation in `build-history/` and `design-history/` represents documentation that no longer reflects the current system; retaining it uncritically violates the second criterion.

- The `docs/tasks/` directory has gaps in its numbering (tasks 27, 32, 36-39 are missing). The index for `docs/tasks/README.md` should note these are reserved or unassigned, not imply the sequence is complete.

- Do not add a `docs/.DS_Store` exception to any tool. Delete it in the same commit as other cleanup; it should not be in the repository at all.
