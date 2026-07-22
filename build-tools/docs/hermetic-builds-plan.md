# Hermetic Builds Implementation Plan

This plan implements [`hermetic-builds-design.md`](hermetic-builds-design.md). It moves `b` from
Nix-backed artifact construction to an enforceable hermetic-build contract while preserving live
`d` workflows and a clearly non-release local development-build path.

## Reviewed Context

- [`hermetic-builds-design.md`](hermetic-builds-design.md)
- [`build-system-design.md`](build-system-design.md)
- [`../../AGENTS.md`](../../AGENTS.md)
- [`../../docs/README.md`](../../docs/README.md)
- [`../../docs/handbook/getting-started-on-a-pr.md`](../../docs/handbook/getting-started-on-a-pr.md)
- [`../../docs/handbook/testing.md`](../../docs/handbook/testing.md)
- [`../../docs/history/process/turbo-mode.md`](../../docs/history/process/turbo-mode.md)
- [`nixpkgs-source-selection-plan.md`](nixpkgs-source-selection-plan.md)

## Non-goals

- Byte-identical artifacts across different Nix systems or platforms.
- Hermetic hot reload, deployment execution, or explicit `b --impure` diagnostics.
- Compatibility fallbacks to live paths, ambient tools, inherited selectors, or impure evaluation.
- Eager devshell closures, broader source snapshots, or changes to dependency/cache semantics.
- A clean-worktree release policy beyond rejecting relevant untracked inputs; tracked modifications
  remain content-addressed inputs unless release policy separately forbids them.

## Implementation Guardrails

- Preserve `u` as the repair command and keep `i` and `b` read-only for tracked state.
- Reuse source-role filters, tool-path authority, Nix command assembly, remote policy, and ownership
  cleanup helpers. Add a shared abstraction only when it becomes the single authority.
- Fail closed on inventory failure, ambiguous ownership, external paths, unsupported entries,
  unprovable builder policy, or missing immutable inputs.
- Treat CoW as an optional copy optimization only. Clone and full-copy paths must produce identical
  bundle manifests and NAR identities; neither path may change the input contract.
- Keep `nix`'s documented bootstrap exception. Every artifact-affecting tool must resolve from a
  declared `/nix/store` path.
- Preserve support for `aarch64-darwin`, `aarch64-linux`, and `x86_64-linux`; platform-specific copy
  optimizations and sandbox checks must preserve the same artifact contract.
- Do not claim hermeticity in active docs until all acceptance gates pass.
- Keep implementation source and test files at or below 250 lines and update generators rather than
  emitted state. This plan document is intentionally detailed beyond that limit.

## Validation Policy

- This plan explicitly authorizes Turbo Mode. Full validation is deferred to the PR-3 integration
  milestone and the mandatory PR-5 final checkpoint; it is not skipped.
- Every PR adds focused positive and negative tests, updates its owning docs, and records elapsed
  time plus cold/warm disk evidence under the handbook guardrails.
- Capture store-path additions by role, temporary bundle roots, `.viberoots/workspace`, and
  `buck-out`; preserve first-failure evidence before cleanup or GC.
- Run the exact failing target first, then neighboring tests. Do not start broad validation while a
  focused regression or bounded cleanup assertion is failing.
- Each PR must run formatting/lint checks for touched files, the smallest meaningful build and `v`
  selectors, previously failing tests in the subsystem, and an independent scope review before
  commit. High-risk changes require broader targeted validation without automatically turning every
  PR into a full-suite checkpoint.
- Run `i && b && ALL_TESTS=1 v` after PR-3 and PR-5, with no source edits during measured runs.
  Coverage remains opt-in.
- Independent scope review must verify that dependency, cache, snapshot, and compatibility behavior
  did not expand beyond this plan.

## Turbo Mode Policy

- Record the viberoots base commit before PR-1. Scoped verification must use
  `GITHUB_BASE_REF=<current-turbo-base> v ...`; never inherit a stale base from another PR range.
- PRs 1-2 use focused validation and accumulate integration debt. PR-3 runs the first full-suite
  milestone; after it passes and is committed, that commit becomes the scoped base for PR-4.
- PR-4 uses focused plus broader targeted validation for its high-risk execution-policy surface.
  PR-5 runs the mandatory final full suite, reruns every high-risk selector, and closes the ledger.
- Any focused failure blocks the sequence until its root cause and first-failure evidence are
  resolved. Do not mask it with a fallback, weaker assertion, cache cleanup, or scope reduction.
- A PR must escalate to full validation early when focused evidence cannot bound graph, toolchain,
  remote-execution, platform, or shared test-harness impact. Record the escalation in the ledger.
- After each passing full checkpoint is committed, update the Turbo Mode base to that commit.
- Prepare later work during validation only across non-overlapping ownership boundaries; never let a
  later PR depend on an unresolved failure or uncommitted contract from an earlier PR.

## De-Risking Checkpoints

1. After PR-1, policy inspection and CI rejection work without changing artifact identity.
2. After PR-2, selected and full builds consume immutable bundles and warm repeats add no new bundle
   identity for unchanged content.
3. After PR-3, ordinary local `b` is pure with or without relevant untracked source; the latter is
   visibly non-release. Run the first full-suite checkpoint.
4. After PR-4, hostile host tools, environment, filesystem, and network cannot affect artifacts.
5. After PR-5, independent same-system builders agree and the hermetic claim may be enabled.

## Integration Debt Ledger

For every PR whose full suite is deferred, record the PR number, commit hash, Turbo Mode base,
focused commands and log paths, elapsed time and disk evidence, skipped broader validation, and any
assumption or known integration risk. Review and close every entry at PR-3 and PR-5.

- Until PR-2, graph selectors and normal materialization may still require impure evaluation.
- Until PR-3, local relevant untracked inputs do not have the final development-bundle contract.
- Until PR-4, broad environment inheritance and unqualified Buck action tools remain gaps.
- Until PR-5, hermeticity is enforced locally but lacks the independent-builder release proof.

### PR-1 Deferred Full-Suite Record

- Commit: the PR-1 commit containing this record.
- Turbo Mode base: `0b93ea6b564cf84e45669de3df99d59cfdcab484`.
- Focused validation: `i && b && v` with the complete 18-selector affected union and the canonical
  five-target enforcement floor. The command, elapsed time, selector list, and bounded disk and Nix
  deltas are recorded in
  `.viberoots/workspace/buck/codex-test-logs/i-b-v-hermetic-pr1-final.evidence.log`; complete command
  output is in the sibling `i-b-v-hermetic-pr1-final.log`.
- Broader validation deferred: `ALL_TESTS=1` remains mandatory at the PR-3 checkpoint under the
  Turbo Mode policy.
- Open integration assumptions: graph selection and ordinary materialization may still require
  impure evaluation until PR-2; relevant untracked inputs retain the provisional local-development
  contract until PR-3; environment and tool qualification remain PR-4 scope; independent-builder
  agreement remains PR-5 scope.

### PR-2 Deferred Full-Suite Record

- Commit identity: the viberoots commit with subject `build: materialize immutable evaluation
bundles` whose first parent is `fc0d992daf592feeafe18b4b9016bada1012b704`. Parent plus subject
  identifies the commit without the impossible requirement that a commit contain its own final
  hash.
- Turbo Mode base: `fc0d992daf592feeafe18b4b9016bada1012b704` in viberoots and
  `77d6891079fb26579df0ccd829007306a4366ab9` in the parent repository.
- Focused validation: the fresh post-review `i && b && v` passed the complete 19-selector affected
  union plus the canonical five-target project-enforcement floor, including
  bundle lifecycle and identity, filtered-source exclusion and cleanup, selected and full
  materialization, runnable selection, planner/Node neighbors, hard owner death, and Darwin capture
  cleanup. Project enforcement completed 5/5 in 9 seconds with one thread, the shared pass completed
  19/19 in 21 seconds, and the full focused command took 66 seconds. Output is recorded in
  `.viberoots/workspace/buck/codex-test-logs/i-b-v-hermetic-pr2-final-post-review-concrete-20260716-105915.log`;
  bounded disk, Nix-path, process, and cleanup evidence is in the sibling
  `hermetic-pr2-final-post-review-concrete-evidence-20260716-105915` directory. The preceding focused
  cleanup regression passed 2/2 and is recorded in the sibling
  `hermetic-pr2-cleanup-regression-evidence-20260716-105113` directory. Changed-file ESLint and
  Prettier passed before verify; verify used a documented lint-preflight waiver for an unchanged
  parent `flake.lock` hash that the stale-name scanner misclassified as a migration label.
- Disk and lifecycle evidence: the final focused run added 45,545,048 direct NAR bytes, including
  one 65,496-byte identity fixture bundle. Workspace growth was 316 KiB and `buck-out` growth was 128
  KiB. Measured temp roots were empty and no bundle root, registration descendant, capture path,
  owned process, or owned orphan remained; the shared noindex parent contained only its zero-size
  metadata marker.
- Broader validation deferred: `ALL_TESTS=1` remains mandatory at the PR-3 checkpoint under the
  Turbo Mode policy.
- Open integration assumptions: selector environment and normal `--impure` removal remain PR-3;
  environment and tool qualification remain PR-4; independent-builder agreement remains PR-5.

### PR-3 Full-Suite Checkpoint Record

- Commit identity: the viberoots commit with subject `feat(build): classify local development
bundles` whose first parent is `0ea3873d428cc2d79598be91b10a57b16d08a5da`. Parent plus subject
  identifies the checkpoint commit without requiring the commit to contain its own final hash.
- Focused validation: the exact checkpoint failures, new structural contracts, root-cause groups,
  and conservative affected union passed before the full suite. The affected union passed 341/341
  twice; the second run is recorded in
  `.viberoots/workspace/buck/codex-test-logs/hermetic-pr3-conservative-union341-warm-20260716-153550.log`.
  A real unchanged `b //projects/apps/viberoots-site:app` selector then passed twice, with the second
  invocation adding zero Nix paths, source identities, or evaluation-bundle identities; evidence is
  in the sibling `hermetic-pr3-production-identity-20260716-160345.log`.
- Full checkpoint: exact `i && b && ALL_TESTS=1 v` passed all 1,889 targets in 7,189 seconds with no
  failure, timeout, infrastructure failure, source edit, or concurrent GC. Project enforcement
  passed 5/5, enforcement 45/45, isolated 14/14, isolated-bounded 15/15, resource-limited 246/246,
  and shared 1,564/1,564. The supervising log is
  `.viberoots/workspace/buck/codex-test-logs/i-b-all-tests-v-hermetic-pr3-restart-20260716T232737Z.log`,
  the copied complete verify log has the sibling `.verify-full.log` suffix, and bounded timing,
  disk, Nix-role, process, load, and cleanup evidence is in the sibling
  `hermetic-pr3-restart-20260716T232737Z` evidence directory.
- Disk and lifecycle evidence: APFS used 8,855,968 KiB while surviving added Nix paths accounted for
  6,969,160 KiB and retained verify temp accounted for 325,732 KiB. Added Nix paths comprised 545
  source paths, 78 evaluation bundles, one 4 KiB capture identity, and 1,369 other closure paths.
  Source fingerprints were unchanged; no run-owned process, deleted-open file, reviewed-origin
  repository, or nonempty capture-construction root remained. The two retained capture base
  directories were zero-size metadata-marker roots. The remaining APFS delta was preserved as
  evidence and not hidden with cleanup or GC.
- Ledger reconciliation: PR-1/PR-2 debt for ordinary selector impurity, immutable bundle consumption,
  and the relevant-untracked local-development contract is closed by this checkpoint. Broad
  environment inheritance and action-tool qualification remain explicit PR-4 scope, and
  independent-builder agreement remains explicit PR-5 scope; neither is concealed as deferred PR-3
  validation debt.

### PR-4 Environment, Tool, Sandbox, And Network Checkpoint Record

- Commit: `eb880edc012fedb51fbe62686fca44615913183a`; parent checkpoint:
  `dd21b0176b421fe529cc9b0544d2b8dd88b0e1f5`.
- Turbo Mode base: `83347852d8fcd3143aa4d7a542537ed7b2e9d98c` in viberoots.
- Focused and lifecycle validation: the stale-global-input regression was preserved, reduced to the
  single projects/config hash authority, and proven deterministically as stale failure, explicit
  `u` repair, and immediate read-only `b` consumption. The meaningful related group and conservative
  affected cold/warm union passed with bounded disk, identity, process, deleted-open-file, and owned
  cleanup evidence. Independent scope/root-cause, storage, environment/tool, and sandbox/network
  reviews found no material blocker.
- Broad checkpoint: the completed mandatory run is recorded in
  `.viberoots/workspace/buck/codex-test-logs/pr4-mandatory-final-replay-20260721-141826.log` and its
  retained evidence. It reported one individual-test contract failure after the production paths
  had passed; that test and its enforcement neighbor passed after the scoped fixture correction.
  The later PR-5 mandatory full checkpoint passed the complete superset and closes the remaining
  broad-validation debt without weakening PR-4's execution boundaries.
- Ledger reconciliation: ambient environment, host-tool, sandbox, network, action isolation, and
  cleanup debt is closed. Independent-builder release evidence remains PR-5 administration scope.

### PR-5 Final Local Checkpoint And External Evidence Record

- Commit: `3565f6308daa00fa64f6e64f32a715987285eb6a`; parent checkpoint: `5b55316`.
- Focused validation: the exact seven-target regression set and independently expanded 31-target
  conservative affected union passed. Cold/warm profiling of representative runnable and scaffold
  tests showed stable warm identities and no persistent code time regression. The prior broad-run
  slowdown was attributed to cold identity fanout plus host/GC contamination rather than a source
  regression.
- Mandatory local checkpoint: `env -u NODE_PATH VBR_GC_MODE=off i && b && ALL_TESTS=1 v` passed all
  1,945 tests after an explicit `u` repaired the expected post-GC generated-language staleness.
  Project enforcement passed 5/5, enforcement 46/46, isolated 14/14, isolated-bounded 15/15,
  resource-limited 259/259, and shared 1,606/1,606. The supervising log is
  `.viberoots/workspace/buck/codex-test-logs/pr5-mandatory-full-post-reboot-gc-after-u-20260721.log`;
  the complete verify log is
  `.viberoots/workspace/buck/verify-logs/verify-2026-07-22T06-44-14-370Z-12681-9288bce540038.log`.
  Resource-limited completed in 64m43s and shared in 63m27s with no run-owned cleanup failure or
  concurrent GC.
- Reviews: independent material scope, plan, and design reviews found no remaining production or
  test architecture bypass. The implementation includes the fixed six-family by three-system by
  two-builder protected lane, signed registry/aggregate, readback, publication admission, language
  graduation, and complete attestation/registration/import/sign administration.
- External release evidence: not yet executed for this revision. This checkout has no prepared
  Jenkins context, six reviewed builder authorities, owner-only transports, signed registry/store
  administration, or protected Jenkins credentials. The deployment key is unrelated. The public
  hermeticity claim must remain disabled until an administrator runs
  `VBR_PROTECTED_REPRODUCIBILITY=1` for the frozen revision and retains the signed aggregate and
  readback evidence. This is an external release-administration blocker, not deferred repository
  implementation or local validation debt.

## PR-1: Establish Hermetic Policy Authority And Evidence

### 1. Intent

Create one typed policy authority for build classification and make current gaps observable and
rejectable before changing evaluation inputs.

### 2. Scope of changes

- Add canonical `hermetic`, `local-development`, and explicit diagnostic classifications; inventory
  impurity, selector environment, tool paths, daemon sandbox settings, builders, and substituters.
- Make CI, release, cache-publication, provenance, and deployment admission reject explicit impure
  artifact builds. Emit a stable evidence record without secrets or machine identity.

### 3. External prerequisites

Nix must expose effective client/daemon configuration; CI job classification must be available.

### 4. Tests to be added

Test policy parsing, hostile/missing configuration, CI rejection, secret redaction, and unchanged
artifact identity. Measure focused cold/warm inspection time and disk growth.

### 5. Docs to be added or updated

Document classifications and provisional diagnostics in build-system and CI/operator references.

### 5.5. Expected regression scope

Startup checks, `b` argument handling, CI admission, and build evidence reporting.

### 6. Acceptance criteria

Every artifact entrypoint has one classification; protected jobs reject impurity; evidence is
read-only, deterministic, and does not alter current pure-build outputs.

### 7. Risks

Client configuration may not prove remote-builder policy, or evidence may capture host noise.

### 8. Mitigations

Represent unknown policy explicitly and fail protected jobs closed; normalize only reviewed fields.

### 9. Consequences of not implementing this PR

Later enforcement would duplicate policy and could leave publication paths unguarded.

### 10. Downsides for implementing this PR

Strict admission exposes misconfigured CI and builders before artifact migration is complete.

## PR-2: Materialize Immutable Evaluation Bundles

### 1. Intent

Make selected and full graph evaluation consume one filtered, content-addressed input contract.

### 2. Scope of changes

- Add the versioned bundle schema, deterministic materializer, manifest/digest, store registration,
  ownership cleanup, and immutable viberoots reference reuse.
- Move source, graph, label/platform selection, classification, lock/hash/provider identities, and
  modified tracked files into the bundle. Migrate selected and full evaluator entrypoints to bundle
  paths.
- Exclude recursive workspace state, outputs, caches, logs, credentials, unrelated projects, and
  mutable host paths through the existing source-role authority.

### 3. External prerequisites

PR-1 policy classification and existing source-role/filter authorities.

### 4. Tests to be added

Test manifest determinism, exclusions, external symlink and unsupported-file rejection, CoW/full-copy
parity, same NAR identity, and zero new warm bundle identity. Failure, timeout, interruption, and
owner termination must leave no owned root, descendant process, or hidden capture inode. Rejections
must identify the offending path or ownership ambiguity without exposing host secrets.

### 5. Docs to be added or updated

Document schema ownership, filtering, lifecycle, CoW's non-semantic role, and inspection evidence.

### 5.5. Expected regression scope

Graph export, selected builds, full materialization, source modes, temp repos, and remote snapshots.

### 6. Acceptance criteria

All normal evaluators read the immutable bundle as their sole source/graph authority; no live
generated/cache roots enter it; failed and interrupted construction leaves no owned resources;
cold/warm disk evidence is bounded.

### 7. Risks

Filters may omit required source or duplicate large immutable inputs across consumer bundles.

### 8. Mitigations

Use role manifests and parity fixtures; reference the filtered viberoots store identity once.

### 9. Consequences of not implementing this PR

Environment cleanup cannot make mutable graph and source selection hermetic.

### 10. Downsides for implementing this PR

Initial cold builds pay bounded hashing and registration cost for the new bundle.

## PR-3: Remove Automatic Impurity And Classify Local Development Builds

### 1. Intent

Make ordinary `b` evaluate purely while retaining unstaged local source usability without granting
that output release status.

### 2. Scope of changes

- Replace `BUCK_GRAPH_JSON`, `BUCK_TARGET`, `WORKSPACE_ROOT`, language override, and root-lock selector
  reads with bundle fields and remove `--impure` from normal full and selected materialization.
- Detect relevant untracked inputs through source-role inventory: create a labeled development
  bundle locally, fail in protected jobs, and reserve explicit `b --impure` for diagnostics.
- Preserve `d` against the live importer and keep `u`, `i`, and `b` mutation boundaries intact.

### 3. External prerequisites

PR-2 bundle support for hermetic and local-development classifications.

### 4. Tests to be added

Test clean, tracked-modified, relevant-untracked, ignored, ambiguous, and inventory-failure states;
unset and poison former selectors; verify publication rejection, explicit temp-repo development
bundles, cleanup, and real watcher observation of new files. Prove stale state leaves `i` and `b`
tracked-clean and emits the `u` repair instruction.

### 5. Docs to be added or updated

Update command, testing, source-mode, hot-reload, and diagnostic-impurity documentation.

### 5.5. Expected regression scope

`u/i/b/d/v`, graph selection, temp repositories, source modes, CI, and publication admission.

### 6. Acceptance criteria

Normal `b` never invokes impure Nix; local relevant untracked input is visibly non-release; CI fails
closed; `d` hot reload and clean-tree artifact identity remain functional.

### 7. Risks

Inventory errors could hide new files or classify generated outputs as source.

### 8. Mitigations

Share source-role authority, expose inclusion reasons, and reject incomplete or ambiguous inventory.

### 9. Consequences of not implementing this PR

Local convenience continues to silently weaken the artifact contract.

### 10. Downsides for implementing this PR

Untracked build inputs produce non-release artifacts and require tracking before CI can build them.

## PR-4: Enforce Tool, Environment, Sandbox, And Network Boundaries

### 1. Intent

Prevent ambient host state from affecting bundle evaluation, Buck actions, or Nix derivations.

### 2. Scope of changes

- Apply one mode-aware environment allowlist to `b`, Buck, Nix, CI, and remote execution; isolate
  home/temp/config roots and reject artifact selectors outside the bundle.
- Remove trusted devshell session inputs before canonical TypeScript admission, and restore caller
  compiler, language, and package selectors that differ from the trusted baseline so admission
  rejects them; neither class may enter bundle, derivation, or runtime environments.
- Reject unknown artifact-affecting variables in CI, strip harmless unknowns locally, fail local
  known-selector injection, and use a smaller declared transport allowlist remotely.
- Declare/store-qualify Buck action shells and tools, including copy/materialization tools; retain
  only the Nix bootstrap exception.
- Require Buck artifact rules to declare source, provider, lockfile, patch, toolchain, generated, and
  bundle inputs; classify probe/orchestration rules so they cannot publish artifacts.
- Require effective sandboxing without fallback, multi-user daemon operation where supported,
  reviewed builders/substituters and keys, and no host-path exceptions; enforce derivation network
  policy.
- Keep artifact outputs under Buck outputs or `/nix/store`, and remove clocks, timestamps, random
  identifiers, branches, and user configuration from artifact construction.

### 3. External prerequisites

PR-1 policy authority, PR-2 bundle input, and builders capable of reporting policy.

### 4. Tests to be added

Use hostile `PATH`, `HOME`, XDG, compiler, language, selector, clock, and locale/timezone inputs;
canary host-file and network reads; fixed-output hash success/failure; local/remote tool-closure
parity; direct-action and supported-platform enforcement tests. Every rejection must provide a
tested remediation diagnostic, and policy must come from the effective daemon/builder rather than
client environment text.

### 4.5. De-risking protocol

- Before editing production behavior, inventory every artifact executor, environment builder, Buck
  action tool, CI and remote boundary, sandbox and builder policy reader, and network-capable path.
  Add structural coverage that fails when a new entrypoint bypasses the canonical authorities.
- Implement and validate five authority checkpoints in order: environment policy, store-qualified
  tools, declared Buck inputs, effective sandbox/builder/substituter policy, and derivation
  network/fixed-output policy. Freeze the source between checkpoints and do not carry an unexplained
  failure into the next authority.
- Run the hostile-environment matrix across every supported artifact language and mixed-language
  build. Separately prove that live `d` workflows keep their intended working-tree behavior without
  leaking that environment or source authority into artifact builds.
- Build conservative affected-target unions for every shared authority change, including indirect
  language, runnable, temp-repository, CI, publication, and remote-execution consumers. Record cold
  and identical warm timing, disk, Nix-path, source/bundle identity, process, capture, and cleanup
  evidence; unchanged warm inputs must add no source or bundle identity.
- Require separate material reviews for environment/tool authority, sandbox/network policy, and
  overall scope/guardrail compliance. Reviewers should report substantive bypasses or missing
  evidence rather than stylistic or wording preferences.
- Escalate to `i && b && ALL_TESTS=1 v` within PR-4 when a shared environment, tool, graph, sandbox,
  network, or remote-execution change cannot be bounded by a meaningfully smaller affected union, or
  when that union approaches the complete validation inventory. Do not carry unbounded uncertainty
  into PR-5 merely because PR-5 is the scheduled final checkpoint.

### 5. Docs to be added or updated

Document the environment matrix, tool authority, sandbox remediation, builder trust, and network rules.

### 5.5. Expected regression scope

Devshell fast path, Buck action runners, every language artifact macro, CI, and remote execution.

### 6. Acceptance criteria

Host tools and variables cannot change artifacts; policy cannot be bypassed through direct action
execution; sandbox/network canaries behave consistently on supported systems.

### 7. Risks

Overly narrow allowlists can break legitimate daemon transport or platform-specific actions.

### 8. Mitigations

Add inputs only with artifact-neutral evidence; keep transport and artifact environments distinct.

### 9. Consequences of not implementing this PR

Immutable source alone cannot prevent host tool, configuration, or service influence.

### 10. Downsides for implementing this PR

Custom local environments and unreviewed builders fail until explicitly configured.

## PR-5: Gate Reproducibility, Publication, And Language Onboarding

### 1. Intent

Prove the hermetic contract independently and prevent new languages or publication paths from
bypassing it.

### 2. Scope of changes

- Add independent-checkout/builder evidence comparison for representative Go, Node, Python, C++,
  WebAssembly, and mixed artifacts on every supported Nix system represented by release builders,
  including forced rebuilds and stable warm identities.
- Close and enforce the artifact-entrypoint inventory. Every artifact-producing CLI, Buck macro,
  Nix invocation, CI stage, remote executor, cache publisher, and deployment admission path must be
  classified under the canonical source, bundle, tool, environment, sandbox, network, and
  publication authorities. Inventory or command-site drift fails until its classification and
  policy digest are reviewed.
- Add structural enforcement that rejects known escape routes: direct artifact construction outside
  canonical macros and entrypoints, unapproved `--impure`, raw live-worktree inputs, host-tool
  fallback, ambient selector transport, automatic network lock regeneration, and publication of
  local-development bundles.
- Gate release, cache, provenance, and deployment admission on hermetic classification and matching
  evidence. Provenance must bind revision, immutable source, evaluation bundle, declared graph,
  dependency/lock authority, tool closure, Nix system, derivation, output, and NAR identities.
- Extend language scaffolding/onboarding policy checks and documentation with required source roles,
  dependency reconciliation, immutable bundle inputs, store-qualified toolchains, selector
  transport, sandbox/network behavior, remote execution, publication admission, and reproducibility
  tests. A new language cannot graduate with an unclassified artifact route.
- Enable the public hermetic-build claim only after all gates pass.

### 3. External prerequisites

Two independent same-system builder executions from separate checkouts under different absolute
paths for each supported release-builder Nix system, plus reviewed release evidence storage.

### 4. Tests to be added

Compare derivation, output, and NAR identities across paths, forced rebuilds, hostile environments,
and supported release-builder systems. Require evidence fields for revision, immutable source digest,
bundle digest, declared graph digest, dependency/lock identity, tool-closure identity, system,
derivation path, output path, and NAR hash. Test tampering, missing proof, non-release rejection,
stable warm source/bundle/fixed-output identities, and new-language policy fixtures.

Add inventory freshness tests that fail for an unclassified artifact-producing command or direct Nix
route. Add negative structural and runtime tests for the known escape patterns above. Rotate the
representative forced-rebuild matrix over time while keeping at least one artifact from every
supported language and mixed-language family in the mandatory PR-5 checkpoint.

### 4.5. De-risking protocol

- Freeze source between each independent-builder pair and archive the exact revision, inventory,
  policy, builder, timing, disk, process, cleanup, and identity evidence. A comparison with source or
  policy edits between executions is invalid.
- Run cold and identical warm comparisons. Unchanged warm inputs must create no new immutable source
  or evaluation-bundle identity; attribute every other new Nix path by owning role before accepting
  it.
- Exercise publication admission only with evidence emitted by the canonical build path. Handwritten,
  stale, cross-system, mismatched-toolchain, or local-development evidence must fail closed.
- Require independent reviews of entrypoint/inventory completeness, cross-builder reproducibility,
  publication/provenance admission, language onboarding, and overall hermetic scope. Reviewers should
  identify material bypasses or missing proof rather than stylistic preferences.
- Do not introduce a new tracing framework, macro architecture, or CI platform merely to strengthen
  the final claim. If the exhaustive assessment identifies a necessary guard that cannot reuse the
  existing authorities, record an implementation finding and extend the active PR range rather than
  weakening PR-5 acceptance.

### 5. Docs to be added or updated

Update build claims, CI/release runbooks, language-adding guidance, evidence interpretation, and
backout. Document the closed artifact-route inventory and the required review when shared macros,
source selection, canonical environments, Nix builders, or publication boundaries change.

### 5.5. Expected regression scope

All artifact languages, release/cache/provenance workflows, deployments, scaffolding, and full verify.

### 6. Acceptance criteria

For every supported release-builder Nix system, representative independent same-system builders
produce matching derivation, output, and NAR identities, and forced rebuilds are byte-equivalent.
The artifact-entrypoint inventory is complete and freshness-enforced; known escape routes fail
structurally or at admission; identical warm runs add no source or evaluation-bundle identity;
protected publication requires valid provenance bound to the reviewed source, graph, dependency,
tool, platform, derivation, and output authorities; new languages cannot graduate without the full
contract; `i && b && ALL_TESTS=1 v` passes within guardrails.

The end-of-range plan and design assessments must independently validate the complete hermetic-build
claim across every supported build family and artifact entrypoint. They must trace immutable source
and dependency inputs, ambient selector and environment rejection, store-qualified tools, effective
sandbox/builder/substituter and network policy, independent same-system output identity, publication
admission, live-`d` separation, tracked-state mutation boundaries, and bounded disk/process/cleanup
evidence. A representative sample or the presence of implementation files is not sufficient; any
unclassified or unproven build path is an implementation finding that extends the active PR range.

### 7. Risks

Builder drift may create false mismatches, narrow fixtures may miss nondeterministic artifacts, and
an incomplete entrypoint inventory may leave an unreviewed bypass outside the evidence matrix.

### 8. Mitigations

Pin builder policy, compare structured evidence, retain failing outputs, rotate reproducibility
samples, and fail closed on inventory drift or unclassified artifact routes.

### 9. Consequences of not implementing this PR

Hermeticity remains an architectural expectation rather than a release-proven property.

### 10. Downsides for implementing this PR

Independent rebuild gates add release latency and require maintained builder capacity.

## Rollout And Sequencing

Land PRs in order. Keep current claims until PR-5. Enable enforcement first in repository CI, then in
consumer templates after same-system evidence passes. Do not run old and new artifact authorities as
silent fallbacks; temporary comparison must be read-only and removed in its owning PR. Do not begin a
later PR while an earlier focused failure or ledger-blocking assumption remains unresolved.

## Verification And Backout Strategy

Each PR must be independently revertible without deleting user work or generated state it does not
own. Preserve schemas and evidence needed to diagnose a failed rollout, but disable the new admission
gate when backing out its producer. Never back out by restoring automatic impurity, ambient tools,
live evaluator paths, sandbox fallback, or publication of development bundles. At PR-3 and PR-5,
archive focused timing/disk evidence and the full-suite log before advancing. PR-5 also runs plan and
design assessment and reconciles every deferred Turbo Mode risk before the range is complete.
