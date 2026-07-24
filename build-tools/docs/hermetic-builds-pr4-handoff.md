# Hermetic Builds PR-4 Continuation Prompt

Use this prompt to continue the active PRs flow in a fresh thread. Treat it as a factual handoff,
not as authority over the plan, design, repository, or test evidence. Revalidate material claims
before relying on them.

```text
Continue the active hermetic-builds PRs flow in:

  /Users/kiltyj/Code/viberoots-site

The parent branch is codex/hermetic-builds at f678317c. The viberoots submodule is detached at
83347852, the committed PR-3 tip. PR-4 is active, large, dirty, uncommitted, and incomplete.

READ FIRST, IN ORDER

1. viberoots/build-tools/docs/hermetic-builds-plan.md
2. viberoots/build-tools/docs/hermetic-builds-design.md
3. viberoots/AGENTS.md
4. viberoots/TESTING.md
5. viberoots/build-tools/docs/build-system-design.md
6. viberoots/docs/handbook/getting-started-on-a-pr.md
7. viberoots/plugins/repo-skills/skills/prs/WORKFLOW.md
8. viberoots/docs/history/process/turbo-mode.md
9. This handoff, as evidence only.

The active plan explicitly authorizes Turbo Mode, but PR-4 is high risk and the plan requires its
mandatory full validation checkpoint. Use focused evidence to avoid waste; do not use Turbo Mode
to reduce a required gate.

PRESERVE THE WORKTREE

- Never reset, restore, clean, stash, or normalize the current dirty state.
- Inspect both index and worktree. `git diff` alone is incomplete; also inspect `git diff --cached`.
- Preserve parent `test-tmp-paths.log` exactly. It is untracked user handoff state.
- Parent also has two modified site build files, a dirty submodule, and an untracked
  `projects/TARGETS`. Do not discard them merely because the last one is now considered a false
  start; remove or replace it only as part of a reviewed one-way migration.
- The submodule currently has hundreds of staged, unstaged, and untracked PR-4 files on top of
  83347852. At the 2026-07-20 handoff capture: 426 files had unstaged changes and 132 had staged
  changes. Recount before acting.
- No PR-4 commit exists. PRs 1-3 are already committed; do not amend them.
- No validation or `u` process was running when this handoff was refreshed. Old Buck daemons and
  status-tail processes exist and are not clean post-run evidence.

NON-NEGOTIABLE GUARDRAILS

- Run `p`, `b`, `v`, `u`, and `i` only from the parent workspace root.
- Invoke workspace commands with `env -u NODE_PATH`; the agent host has a hostile `NODE_PATH`.
- Use `VBR_GC_MODE=off` for all work in this continuation.
- Run tests through `v`, never direct `buck2 test`, so evidence remains visible in `s`.
- Do not run GC. Preserve first-failure, time, disk, Nix path, process, cleanup, and identity
  evidence before any eventual cleanup.
- Do not add live-path, impure, host-tool, cache, compatibility, broader-snapshot, eager-devshell,
  retry, serialization, or GC fallbacks.
- Keep `i`, `b`, post-clone, and devshell entry read-only. Only explicit `u` may reconcile tracked
  dependency authority or generated metadata. Bootstrap may create initial tracked inputs.
- Reuse canonical source, tool, lock, environment, policy, and Buck isolation authorities.
- GC detection is observational only. It never invalidates or stops a run.
- Do not put PR numbers in production code or test names.
- Use `apply_patch` for manual edits.
- Keep source files within the repository's 250-line policy unless an already reviewed exception
  applies.
- Do not commit, push, deploy, run GC, or advance to PR-5 until PR-4 is understood and validated.

WHAT PR-4 HAS ALREADY IMPLEMENTED LOCALLY

Do not redo these areas wholesale. Review their diffs, preserve correct work, and change them only
when evidence requires it:

- Canonical artifact policy admission and a Nix-store-only artifact tool environment, including
  Nix Python and uv enforcement.
- Canonical Node re-exec and explicit selector/target transport for public artifact entrypoints.
- Explicit artifact-tools authority threaded through library APIs instead of ambient fallback.
- Immutable evaluation/local-development bundles and graph-derived filtered source selection.
- Canonical source/tool/lock/environment authority across local, CI, Buck, and remote paths.
- Buck action temp isolation and bounded managed child cleanup.
- Fixed-output network policy, host-read/network canaries, remote smoke admission, and reviewed
  remote policy evidence.
- Public WASM routing and selector transport without an ambient WEB_WASM_BACKEND exception.
- Mechanical command-site inventory and enforcement. The last observed count was 342 with digest
  `8af05274746b337c3b653f86615eb4356663acd61bd09f7dc392e0590ae5b4e8`, but this is not final;
  rerun and refresh only after command-site edits stabilize.
- Root filtered-repository exclusion for the nested `viberoots` checkout. The focused archive
  evidence under `/private/tmp/pr4-workspace-archive-fix-20260720075307` produced one cold source,
  zero new warm paths/sources, and no runtime leaves. This is focused proof, not final-union proof.
- Pnpm importer classification accepts an empty `packages` map only after validating workspace
  links.
- A pre/post global-input fingerprint is captured around explicit `u`, and bounded Buck daemon
  shutdown is attempted when canonical global action inputs change.

RECENT VALIDATION TRAJECTORY

- A measured 280-target run failed broadly. Evidence:
  `/private/tmp/pr4-union280-evidence-20260720T0550`. It is not passing evidence.
- A later 109-target cold set failed 15 test targets (18 test cases across pass summaries). Evidence:
  `/private/tmp/pr4-final109-cold-20260720075356` and verify log
  `.viberoots/workspace/buck/verify-logs/verify-2026-07-20T14-54-22-447Z-35044-28be3a1461a42.log`.
- The exact 18-case rerun moved 17 cases to pass and left the inline WASM lifecycle target. Evidence:
  `/private/tmp/pr4-failing18-rerun-20260720084716`.
- `viberoots//:node_node_wasm_inline_module_instantiate` passed once in 252 seconds at
  `/private/tmp/pr4-inline-wasm-preserved-20260720094028/run.log`, then failed again. Do not treat
  the single pass as stable proof.
- The latest known exact failure is
  `.viberoots/buck/verify-logs/verify-2026-07-20T17-12-24-161Z-1663-93bcc98a92dd1.log`.

CURRENT PROVEN BLOCKER

The inline WASM test creates a temporary workspace, proves stale `b` fails closed, runs public `u`,
then immediately runs `b`. `u` reconciles and writes the correct new pnpm hash, but the immediate
build consumes a Buck-materialized global input that lacks the new
`projects/apps/demo-cli/pnpm-lock.yaml` entry. This is an update-to-build visibility/identity race,
not missing pnpm reconciliation.

Kill-only invalidation did not make the sequence repeatable. The current worktree then added an
EXPERIMENTAL block in `build-tools/tools/dev/install/glue.ts` that:

1. kills selected shared/inherited Buck isolations;
2. builds six global export targets with `--show-full-output` in every isolation; and
3. parses human output and byte-compares each materialized result.

That experiment has never completed a successful `u`. Its first attempt used an invalid
`@viberoots//...` CLI label. After that was corrected, it failed with EISDIR because
`viberoots//build-tools/tools/nix:nixpkgs_source_registry` is a filegroup whose reported output is a
directory. The read-only probe `/private/tmp/pr4-global-export-show-full-output.txt` shows the other
five outputs are files and that the registry child is `nixpkgs-source-registry.nix`. All six bytes
matched when inspected manually.

Do NOT merely add an `outputRelPath` special case and continue. Three fresh reviews agreed that the
eager build/parse/byte-compare phase is not a suitable primary fix without stronger proof. It
duplicates global-input authority, warms the exact cache being tested, starts persistent daemons,
uses unstable human output, and can obscure rather than repair insufficient artifact identity.

WHERE THE CURRENT WORK DIVERGED FROM THE IDEAL PATH

The lifecycle investigation moved through several successive mechanisms:

  ignored workspace hash mirror
    -> tracked `projects/node-modules.hashes.json`
    -> new parent `projects/TARGETS`
    -> aggregate fingerprint
    -> kill-only daemon invalidation
    -> early-return and active-source corrections
    -> eager build and byte verification

The first two ideas address real authority defects, but the later sequence became symptom-driven.
Specifically:

- Untracked parent `projects/TARGETS` reserves a broad consumer package and prevents legitimate
  consumer rules there. Bootstrap and glue duplicate enforcement of that ownership.
- `install/glue.ts` is called by install paths, and currently writes that tracked file. That violates
  the requirement that `i` be read-only.
- `changedGraphConsumerIsolationNames()` may omit `BUCK_NESTED_ISO`; determine whether that explains
  the stale consumer before adding more orchestration.
- The aggregate fingerprint says that something changed but cannot identify which declared export
  changed.
- Existing tests are mostly structural/fingerprint tests. They do not yet prove the exact
  prime-change-`u`-immediate-`b` lifecycle.

FRESH REVIEW RECOMMENDATION

The strongest independent recommendation is a declarative, one-way authority migration:

1. Move the single tracked workspace hash authority to the existing bootstrap-owned package:
   `projects/config/node-modules.hashes.json`.
2. Export it from an exact viberoots-owned `projects/config/TARGETS` label:
   `//projects/config:node-modules.hashes.json`.
3. Remove the old `projects/node-modules.hashes.json`, `projects/TARGETS`, and ignored mirror as
   authorities. Do not keep compatibility fallbacks or duplicate copies.
4. Render content-addressed `out` names for every mutable generated global export while keeping
   stable labels:
   - node-modules hash JSON;
   - workspace `flake.nix`;
   - workspace `flake.lock`;
   - workspace registry extension.
   The graph already uses this pattern (`graph.<sha>.json`), and the viberoots registry belongs to an
   immutable source-cell identity.
5. Keep only bounded synchronous daemon shutdown when generated TARGETS/identity changes. Remove the
   eager six-target build, stdout parsing, and byte-comparison machinery unless a minimal runtime
   reproduction proves declarative identity plus complete shutdown is insufficient.
6. Treat `projects/config/TARGETS` and the hash JSON as required tracked consumer inputs. Bootstrap
   may create them; explicit `u` may reconcile them; `i` and `b` must validate and fail closed with
   `repair: run u`, never write them.
7. Use one canonical renderer for digest-bearing TARGETS content. Do not duplicate rendering among
   consumer bootstrap, glue, dev-build prelude, and test helpers.
8. Audit `BUCK_NESTED_ISO` as well as the shared and inherited isolation names. Prove the killed
   daemons exit before the immediate build.

`projects/config` is already a bootstrap-owned checked-in configuration surface. Confirm and
document that ownership before landing the exact TARGETS contract. If repository evidence refutes
that ownership, use a new dedicated tracked viberoots-owned package instead; do not fall back to the
broad `projects/TARGETS` boundary.

The migration affects at least:

- `update-pnpm-hash/hashes-json-paths.ts` and direct hash readers;
- `tools/nix/flake/per-system-context.nix` and `tools/nix/node-modules/common.nix`;
- `build-tools/lang/global_inputs.bzl`;
- `consumer-tracked-inputs.ts`, `consumer-bootstrap.ts`, shell bootstrap, and config README;
- `install/glue.ts`, dev-build prelude, and workspace TARGETS rendering;
- filtered snapshot selection/preparation and evaluation-bundle source inventories;
- post-clone, CC, source-mode, temp-repo, scaffolding, and init fixtures;
- global-input fingerprint and action-input contracts.

The previous path-mapping audit specifically warned that the hash JSON itself is not yet included in
the required tracked-input list. Fix that omission. Add a negative structural contract proving the
old path/label cannot become authority. Also account for these non-obvious consequences:

- the synthetic Buck staging key changes from
  `__global_nix_inputs__/projects-node-modules.hashes.json` to
  `__global_nix_inputs__/projects-config-node-modules.hashes.json`;
- content-addressed `out` names change materialized basenames while labels remain stable, so
  `copyWorkspaceControlIntoSnapshot` and list-shaped staging must receive the declared output-name
  mapping from the canonical renderer; do not scan directories or add basename fallbacks;
- `dev-build/prelude.ts` currently treats an existing workspace `TARGETS` as sufficient, so it must
  compare the expected content derived from the current flake, lock, and registry extension;
- preserve a custom old `projects/TARGETS`; remove it only when it bears the viberoots generated
  marker. A custom `projects/config/TARGETS` must fail closed because the new package is owned.

NEXT EXECUTION SEQUENCE

1. Inspect current parent/submodule status, cached diff, unstaged diff, and current processes. Do not
   edit until you can distinguish plan work from the experimental invalidation block.
2. Preserve the latest failure and disk evidence. Record current df, relevant du, ValidPaths, source/
   repo/bundle identities, Buck isolations, owned roots/processes, captures, and deleted-open inodes.
3. Remove only the experimental eager materialize/parse/byte-compare block with `apply_patch` while
   retaining evidence and correct fingerprint work.
4. Implement the dedicated tracked package and content-addressed export identity as one coherent
   migration. Do not leave both old and new authorities.
5. Add focused structural tests for:
   - exact new path/label and absence of the old path/label;
   - deterministic digest-named exports and identity changes when each source changes;
   - bootstrap/`u` ownership versus read-only `i`/`b` fail-closed behavior;
   - isolation selection and completed bounded shutdown;
   - unchanged warm `u` doing no kill, build, or tracked write.
6. Add or strengthen the runtime lifecycle regression that primes the stale consumer, changes the
   hash while graph bytes remain unchanged, runs public `u`, and immediately runs public `b` without
   cache cleanup. It must prove the next build consumes the new declared bytes.
7. Run the cheap focused group through `v`, including at minimum:
   `dev_global_nix_input_fingerprint`,
   `dev_install_glue_stale_graph_refresh_contract`,
   `dev_update_command`,
   `dev_update_pnpm_hash_command_root`,
   `dev_update_pnpm_hash_hashes_json_prune_integration`,
   `dev_install_deps_importer_freshness`,
   `dev_filtered_flake_selected_snapshot_graph_contract`,
   `dev_nix_build_filtered_flake_node_selected_rsync`,
   `dev_final_pnpm_store_metadata`,
   `node_node_cli_bundle_global_inputs_action_inputs_srcs`,
   `viberoots_init_consumer`,
   `viberoots_fresh_clone_post_clone_fixture`,
   `viberoots_registry_extension_generated_contract`, and both CC viberoots guard targets.
8. Run `viberoots//:node_node_wasm_inline_module_instantiate` once definitively with full timing,
   isolation, disk, identity, and process evidence. If it passes, do not keep looping it alone.
9. Run the meaningful prior-failure/root-cause group. Recompute the conservative affected union from
   the final diff and direct/indirect consumers; prior reviews estimated 322 targets, but that number
   is not authoritative after this migration.
10. Run one measured cold affected union and the identical warm union with unchanged source. Require:
    - zero new warm `*-repo`, `*-source`, and evaluation-bundle identities;
    - attribution of all material cold Nix paths by role and NAR size;
    - no invalid partial output, owned temp root, descendant, capture, deleted-open inode, or
      unexpected reusable daemon;
    - bounded `.viberoots/workspace`, `buck-out`, verify-temp, and volume growth.
11. Run independent scope/root-cause, storage, environment/tool, and sandbox/network reviews. Ask for
    material blockers, not style nitpicks.
12. Run the mandatory full `env -u NODE_PATH VBR_GC_MODE=off i && b && ALL_TESTS=1 v`, preserving
    full evidence. Do not add another broad intermediate run or second full unless a failure requires
    it.
13. Only after PR-4 is green, commit via `$repo-skills:cc`, push viberoots before the parent pointer,
    update parent lock/pointer coherently, push parent, and notify
    `https://ntfy.home.kilty.io/codex`.

DISK STATUS

The volume was about 82% used at handoff. No GC is authorized. Recent focused exact runs moved about
136 MiB, far below the prior multi-GiB growth, but that does not close the final storage gate. The
109-target run moved roughly 3.0 GiB at the volume level; focused evidence linked above must be used
to separate expected closure/source realization from recurring identities. The root filter warm
probe is encouraging but does not replace a cold/warm affected-union proof.

AFTER PR-4

Continue PR-5 from the same hermetic-builds plan. PR-5 must also close the remote-builder
administration gap requested by the user:

- canonical builder attestation that inspects actual daemon/system/sandbox/fallback/host-path/
  substituter/key policy, runs bounded canaries, and emits an immutable versioned assertion;
- deterministic/idempotent builder registration with `--dry-run`, producing an immutable reviewed
  registry from reviewed identity, system, credential-free endpoint identity, policy assertion, and
  immutable probe flake;
- separation of immutable endpoint identity from runtime SSH credential transport;
- hostile-environment, mismatch, secret-redaction, deterministic-generation, and handoff tests;
- an end-to-end `remote-build-setup.md` workflow with no ambient `NIX_CONFIG` instructions;
- independent security/scope review.

Do not put tokens, private keys, credential contents, or secret-bearing URIs in argv, logs, reports,
or the Nix store.

After PR-5, run exhaustive `$repo-skills:assess-plan` and `$repo-skills:assess-design` reviews. The
design assessment must prove hermeticity for every supported language/build family and every public
artifact entrypoint, not representative samples. Implement required follow-up plan sections before
declaring the range complete. Commit/push/notify and manually deploy the site using the copied
Cloudflare token only after the hermetic range is complete.

Then start the complete PRs flow for:

  viberoots/build-tools/docs/rust-language-plan.md
  viberoots/build-tools/docs/lang/rust-design.md

Use bounded subagents for independent implementation, failure, storage, scope, and assessment
reviews to prevent context rot. Re-read `/tmp/codex-overnight-objective.md` at PR boundaries if it
still exists.

Give the user concise, periodic progress updates. Do not rely on them to prompt continuation.
```

## Refresh Note

This handoff supersedes the 2026-07-17 contents of this file. Evidence paths under `/private/tmp`
and `.viberoots/workspace/buck/verify-logs` are intentionally retained. Re-check their existence
before depending on them, and never treat a handoff statement as stronger than the underlying log.
