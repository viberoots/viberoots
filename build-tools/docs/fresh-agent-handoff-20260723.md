# Fresh-Agent Handoff: User Context, Viberoots Rust PR-3, and Codex Accounts

**Prepared:** 2026-07-23

**Workspace:** `/Users/kiltyj/Code/viberoots-site`

**Timezone:** `America/Los_Angeles`
**Purpose:** Give a completely fresh agent enough durable context to resume the current uncommitted
work safely and productively.

This document is evidence and orientation, not authority. Verify every material claim against the
repository, staged and unstaged diffs, and the referenced logs before editing.

## 1. First response and read order

When resuming, tell the user briefly that this handoff was found and that the dirty state will be
preserved. Then read these files completely, in this order:

1. `build-tools/docs/fresh-agent-handoff-20260723.md` (this file)
2. `AGENTS.md`
3. `TESTING.md`
4. `build-tools/docs/build-system-design.md`
5. `docs/handbook/getting-started-on-a-pr.md`
6. `docs/handbook/tooling.md`
7. `docs/handbook/troubleshooting.md`
8. `plugins/repo-skills/skills/prs/WORKFLOW.md`
9. `build-tools/docs/rust-language-plan.md`
10. `build-tools/docs/lang/rust-design.md`
11. `docs/history/designs/codex-wrapper-accounts-design.md`
12. `build-tools/docs/update-command-design.md`
13. `build-tools/docs/update-command-plan.md`
14. `build-tools/docs/hermetic-builds-pr4-handoff.md` only for historical context; do not assume its
    old execution state is current.

All paths above are relative to the `viberoots` submodule unless stated otherwise.

## 2. Explicit long-term-memory import

This section is deliberately separated from the resume handoff. When a fresh agent reads this
document, the user wants that agent to save the durable items below into its long-term memory, using
the product's memory mechanism if one is available. Loading the document into one conversation is
not, by itself, evidence that the information was persisted. The agent should explicitly confirm
which items it saved. If durable memory is unavailable, it should say so plainly and continue using
this document as thread context.

Do **not** save the transient worktree state, commit SHAs, branch state, test counts, log paths,
current failures, clipboard contents, credentials, or dated execution sequence as long-term memory.
Those facts can expire and must be re-read and verified from the later sections of this document
whenever work resumes.

Save the following as durable long-term memory:

### User collaboration preferences

- The user prefers sustained, autonomous execution. Continue while safe, in scope, and supported by
  repository evidence; do not stop after strategy or wait for routine permission.
- Give concise, periodic progress updates during tool use and long-running validation because the
  user cannot see subagent threads. Lead with outcomes and material evidence.
- When a test fails, explicitly classify the root cause as production code, shared test
  infrastructure/metadata, or individual test code, and state the affected blast radius.
- Treat failures observed after a change as potentially caused by that change until evidence proves
  otherwise. Do not dismiss failures as pre-existing based on appearance.
- Fix root causes. Do not use retries, skips, weakened assertions, compatibility fallbacks, duplicate
  authorities, or cache/live/host-tool escape paths to make validation green.
- Do not retain code from failed theories. Remove rejected experiments and keep the primary path
  coherent.
- Performance regressions are correctness issues. Investigate them systematically and validate a
  theory before changing code.
- Full-suite runs are expensive. Prefer focused selectors and conservative affected unions when they
  provide valid evidence, but never represent stale-state validation as a current mandatory gate.
- Use bounded subagents for independent investigations and blockers-only reviews when they improve
  focus or efficiency. Report their material findings in the main thread.
- Ask reviewers for material blockers rather than stylistic nitpicks.
- Resolve ordinary blockers independently from repository conventions and evidence. Ask the user
  only for genuinely new architectural choices, destructive actions, external authorization, or
  similarly consequential scope changes.

### Durable Viberoots working conventions

- In Viberoots work, preserve all dirty, staged, unstaged, and untracked state. Never reset, restore,
  clean, normalize, or stash it unless the user explicitly authorizes that exact action.
- Inspect both staged and unstaged diffs; either may contain only part of the active implementation.
- Run workspace entry points `p`, `b`, `v`, `u`, and `i` only from the parent consumer workspace
  root, normally with `env -u NODE_PATH` and `VBR_GC_MODE=off`.
- Run repository tests through `v`, never direct `buck2 test`.
- Keep `i`, `b`, post-clone, and devshell entry read-only. Only explicit `u` may repair generated
  state.
- Use `apply_patch` for manual edits.
- Prefer one canonical authority and fail-closed identity/security boundaries. Avoid duplicate Bash
  and TypeScript authorities.
- Substantive automation belongs in focused TypeScript modules; Bash should remain a thin process
  boundary where the repository design requires it.
- Do not pollute a consumer repository with projects created solely for Viberoots testing. Scaffold
  isolated temporary consumer repositories with the inputs the test requires.
- Tests must exercise the real production authority. A fixture-specific bypass is not acceptable
  evidence.
- Preserve and cite outer and detailed logs for important validation runs.
- In parent/submodule commit flows, validate first, then commit the submodule before advancing and
  committing the parent pointer.
- Follow `AGENTS.md`, `TESTING.md`, `build-tools/docs/build-system-design.md`, the relevant plan and
  design, and the repo-skills workflow as current authority; memories and handoffs remain evidence,
  not authority.

### Durable product and security context

- Secrets must never be printed, logged, copied into handoffs, or committed. Use established reviewed
  credential-file and `sprinkleref` patterns rather than inventing secret storage.
- The user values hermetic, deterministic, read-only build boundaries and rejects live, impure,
  host-tool, retry, compatibility, eager-closure, or snapshot fallbacks.
- The Unfairly product is moving toward an agent-oriented product experience and may use managed
  model providers in its runtime. Provider/runtime credential work is separate from the local Codex
  `CODEX_HOME` multi-account wrapper unless a design explicitly joins them.
- For Codex account switching, account identity, authentication state, filesystem containment,
  login lifecycle, and sandbox access must be resolved through structured canonical authorities and
  remain fail closed.

The rest of this file is primarily **resume context**, not memory-import material. Reverify it
against the repository before acting.

## 2A. Expanded collaboration context

The user values evidence, root-cause fixes, and sustained autonomous progress. Behave as a senior
collaborator, not as a task taker waiting for routine permission.

### Communication

- Give concise progress updates while work is running. The user cannot see subagent threads.
- Lead with the outcome or current evidence.
- When a test fails, classify its root cause explicitly:
  - production code;
  - shared test infrastructure or scheduling metadata;
  - individual test code.
- Also state the blast radius: one test, shared fixture consumers, or production consumers.
- Do not disappear during long validation. Update at meaningful transitions and at least roughly
  once a minute if work is actively running.
- The user dislikes unexplained stopping. If work is still actionable, keep going.

### Engineering values

- Treat failures as caused by the current change set until repository evidence proves otherwise.
  “Probably pre-existing” is not an acceptable conclusion merely because a failure looks unrelated.
- Fix every observed failure at its root. Do not paper over failures with retries, compatibility
  paths, cache bypasses, test skips, or narrower assertions.
- Evidence beats the handoff and prior agent claims.
- Prefer one canonical authority. Duplicate Bash/TypeScript, test/production, cache/live, or
  snapshot/current authorities are design defects.
- Do not accumulate code from failed theories. Remove rejected experimental machinery completely.
- Preserve fail-closed behavior at security, identity, artifact, source, and sandbox boundaries.
- Do not pollute the consumer repository with projects created only to test viberoots. Use isolated
  temporary consumer repositories scaffolded with the required inputs.
- Test changes must prove the real production path. A fixture that bypasses the authority being
  tested is not meaningful evidence.
- Performance regressions are correctness issues. Validate theories before fixing them; use the
  performance guidance in `docs/handbook/getting-started-on-a-pr.md`.
- Full-suite runs are expensive. Do not repeat one reflexively when a completed full run plus exact
  repaired selectors and a conservative affected union are sufficient. Conversely, do not claim a
  mandatory full checkpoint from a stale source state.

### Autonomy and reviews

- Use bounded subagents for independent investigations and blockers-only reviews when useful.
- Ask reviewers for material blockers, not stylistic nitpicks.
- Resolve ordinary blockers from repository evidence and established conventions without waiting
  for the user.
- A genuinely new architectural boundary, destructive action, external authorization, or another
  multi-hour full-suite run after an explicit hold still requires user direction.

### Secrets and external credentials

- Never print, log, commit, or copy secrets into this handoff.
- The repository uses reviewed credential files and `sprinkleref`-style secret references where
  established; do not invent committed secret storage.
- A deployment key was previously kept in the user's clipboard. Do not inspect, replace, or expose
  clipboard contents unless the user explicitly asks.
- The user is pursuing AWS Bedrock access for GPT-5.6 Sol for the Unfairly product runtime. The AWS
  console returned a 401 saying the model was not available for the account, and the user contacted
  AWS Sales. This is separate from the current OpenAI `CODEX_HOME` account wrapper.
- Provider-neutral Codex account switching (Bedrock, Azure, and similar) is explicitly out of scope
  in the current Codex accounts design. Do not silently expand this implementation into AWS support.

## 3. Repository mental model

The parent workspace is a consumer repository containing `viberoots` as a Git submodule.

- Parent root: `/Users/kiltyj/Code/viberoots-site`
- Submodule root: `/Users/kiltyj/Code/viberoots-site/viberoots`
- Parent branch: `codex/hermetic-builds`
- Parent `HEAD` when this handoff was written: `ad192fa`
- Submodule is intentionally in detached-HEAD state:
  - `HEAD`
  - SHA `68fc47483f52548034c578683ee323ce5229daf6`
- The parent currently records the same submodule SHA, so the parent shows a dirty submodule rather
  than an advanced committed pointer.

Recent completed history:

- Parent `ad192fa chore(viberoots): advance native Rust lifecycle`
- Parent `36b1246 chore(viberoots): advance native Rust build support`
- Submodule `68fc4748 feat(rust): complete native lifecycle contracts` (Rust PR-2)
- Submodule `bec23703 feat(rust): add locked native Cargo builds` (Rust PR-1)
- Hermetic-build work before that is already committed in both repositories.

The active larger flow is the Rust language plan. PRs 1 and 2 are committed. PR-3 is implemented but
uncommitted. After PR-3 is committed and pushed, continue the repository PR workflow through the
remaining requested Rust PRs (at least PRs 4-11), then run plan/design assessments and add any
evidence-backed follow-up PRs. The plan currently extends through PR-12 because final Rust/Tauri
hermeticity and builder evidence were added during assessment.

## 4. Non-negotiable operational guardrails

Preserve all parent and submodule dirty, staged, unstaged, and untracked state.

Never run:

- `git reset --hard`;
- `git checkout -- <path>`;
- `git restore`;
- `git clean`;
- `git stash`;
- normalization or mass restaging that erases the staged/unstaged distinction.

Before editing, inspect both:

```sh
git status --short
git diff
git diff --cached
git -C viberoots status --short
git -C viberoots diff
git -C viberoots diff --cached
```

Other command rules:

- Run `p`, `b`, `v`, `u`, and `i` only from the parent workspace root.
- Use `env -u NODE_PATH` for workspace commands.
- Use `VBR_GC_MODE=off`.
- Do not run GC unless the user explicitly asks. The user previously rebooted and ran GC before the
  latest Rust full checkpoint; that does not authorize another GC.
- Run tests through `v`, never direct `buck2 test`.
- Keep `i`, `b`, post-clone, and devshell entry read-only. Only explicit `u` may repair generated or
  tracked metadata.
- Use `apply_patch` for manual edits.
- Add no live, impure, host-tool, cache, retry, compatibility, eager-closure, or snapshot fallback.
- Do not start an overlapping workspace command while another `i`, `b`, `u`, or `v` run is active.
- Preserve outer logs and detailed verify logs for every important run.

## 5. Exact dirty-state topology

Do not treat the worktree as one homogeneous change.

### Parent worktree

At handoff time:

```text
 M .gitignore
 M projects/deployments/viberoots-site-shared/TARGETS
 m viberoots
?? test-tmp-paths.log
```

Meaning:

- `.gitignore` has the Codex account design's local setting exclusion:
  `/.envrc.local`.
- `projects/deployments/viberoots-site-shared/TARGETS` contains prior hermetic provenance/signature
  admission changes. Preserve them.
- `viberoots` is dirty because PR-3 and account-wrapper work are uncommitted in the submodule.
- `test-tmp-paths.log` is intentionally untracked and must remain preserved.

### Submodule staged state

The large staged set (122 files at handoff) is primarily Rust PR-3 plus its discovered root-cause,
performance, and fixture corrections. It includes roughly 4,118 insertions and 816 deletions.

Do not unstage it merely to make status simpler.

Major staged clusters include:

- Rust Cargo source policy and lifecycle:
  - `build-tools/rust/cargo-source-policy.json`
  - `build-tools/tools/dev/install/cargo.ts`
  - update-command Rust registration and lifecycle
  - Rust read-only and update tests
- Read-only command wiring through install, post-clone, devshell, and build validation.
- Canonical reviewed Nix/cache configuration transport.
- Cache-health command scope and shell handoff.
- pnpm reconciliation and fixed-store authority corrections discovered by the full suite.
- Fresh-clone and seed-staging fixture authority corrections.
- Exporter/global-input selection corrections.
- Resource-limited taxonomy corrections.
- Rust PR-3 documentation and assessed follow-up plan/design amendments.
- Full-run slowdown root-cause correction and performance handbook update.

`docs/handbook/nix-command-site-policy.json` is `MM`: its staged part belongs to PR-3; its unstaged
part incorporates the Codex accounts command sites. Preserve both layers.

### Submodule unstaged and untracked account work

Tracked unstaged files:

```text
build-tools/tools/bin/codex
build-tools/tools/tests/dev/codex-wrapper.safehouse-worktree.test.ts
build-tools/tools/tests/dev/codex-wrapper.safehouse.fixture.ts
build-tools/tools/tests/dev/codex-wrapper.safehouse.test.ts
docs/handbook/nix-command-site-policy.json
docs/handbook/tooling.md
```

Untracked account files:

```text
build-tools/tools/dev/codex-accounts.ts
build-tools/tools/dev/codex-accounts/
build-tools/tools/tests/dev/codex-accounts.auth-state.test.ts
build-tools/tools/tests/dev/codex-accounts.fixture.ts
build-tools/tools/tests/dev/codex-accounts.email-redaction.test.ts
build-tools/tools/tests/dev/codex-accounts.test.ts
build-tools/tools/tests/dev/codex-wrapper.accounts-argv-edge.test.ts
build-tools/tools/tests/dev/codex-wrapper.accounts-argv.test.ts
build-tools/tools/tests/dev/codex-wrapper.accounts-boundary.test.ts
build-tools/tools/tests/dev/codex-wrapper.accounts-default-security.test.ts
build-tools/tools/tests/dev/codex-wrapper.accounts-environment.test.ts
build-tools/tools/tests/dev/codex-wrapper.accounts-helper-boundary.test.ts
build-tools/tools/tests/dev/codex-wrapper.accounts-init.test.ts
build-tools/tools/tests/dev/codex-wrapper.accounts-list.test.ts
build-tools/tools/tests/dev/codex-wrapper.accounts-login.test.ts
build-tools/tools/tests/dev/codex-wrapper.accounts-platform-worktree.test.ts
build-tools/tools/tests/dev/codex-wrapper.accounts-precedence.test.ts
build-tools/tools/tests/dev/codex-wrapper.accounts-remove.test.ts
build-tools/tools/tests/dev/codex-wrapper.accounts-terminal-harness.py
build-tools/tools/tests/dev/codex-wrapper.accounts-terminal.test.ts
build-tools/tools/tests/dev/codex-wrapper.accounts-test-fixture.ts
build-tools/tools/tests/dev/codex-wrapper.accounts-version.test.ts
docs/history/designs/codex-wrapper-accounts-design.md
```

Other untracked files that predate this handoff and must be preserved:

```text
build-tools/docs/hermetic-builds-pr4-handoff.md
```

This handoff file is also intentionally untracked unless the user later chooses to include it.

## 6. Codex multi-account wrapper: completed implementation

### Design

Primary design:

```text
docs/history/designs/codex-wrapper-accounts-design.md
```

The account layer selects OpenAI identities by rebinding `CODEX_HOME`. It is not an AWS/Bedrock
provider switch.

### Architecture

The original experiment put approximately 1,391 lines of substantive account automation into Bash.
That architecture was rejected and removed.

Current split:

- `build-tools/tools/bin/codex` remains the existing Bash boundary for:
  - reviewed tool discovery;
  - TypeScript helper launch;
  - NUL-delimited plan decoding;
  - worktree orchestration;
  - macOS Safehouse entry;
  - final upstream delegation.
- `build-tools/tools/dev/codex-accounts.ts` is the controller entrypoint.
- Focused modules under `build-tools/tools/dev/codex-accounts/` own:
  - argv parsing;
  - account-name validation;
  - canonical path resolution and containment;
  - structured authentication inspection;
  - default and legacy selection;
  - login lifecycle and locking;
  - guarded removal;
  - account listing and formatting;
  - NUL-delimited transport;
  - upstream version compatibility detection.

Every new TypeScript module is below 250 lines. The largest was 197 lines at final validation.
No file-size exception was added.

### Final behavior

- Precedence is:
  1. `--account <name>`
  2. explicit `CODEX_HOME`
  3. `CODEX_ACCOUNT`
  4. canonical `~/.codex-accounts/default`
  5. legacy `~/.codex`
- CLI and environment account selection share the same lifecycle at their respective precedence.
- Empty and invalid selectors fail closed with exit 2.
- Unknown environment-selected accounts follow the same initialization/fail-closed path as CLI
  selection.
- `CODEX_ACCOUNT_INIT=1` works for environment selection.
- Wrapper pre-scanning respects `--`, known upstream option values, unknown-option tails, and
  wrapper-only flag position.
- Duplicate account or removal selectors fail closed.
- Unrelated upstream `--yes` is preserved; it is wrapper-owned only after removal was recognized.
- The default symlink accepts one validated relative account name only.
- Default, selected, and listed account directories must resolve canonically within a real,
  non-symlinked account root.
- Missing-account initialization creates and revalidates the real root and direct child; it cannot
  create state through an external root symlink.
- Absolute, traversal, dangling, invalid, stateless, corrupt-auth-only, and external/escaping
  defaults fall through with an advisory.
- Authentication usability is one structured TypeScript authority:
  - missing, empty, corrupt, unsupported, and incomplete records are not authenticated;
  - a nonempty recognized API key is usable;
  - ChatGPT state requires a decodable ID token and an access or refresh token;
  - Bash never parses `auth.json` or JWTs.
- Legacy/default identity conflict warnings use the shared TypeScript `accountEmail` helper and emit
  only approved email claims.
- Direct login and guided login:
  - run before Safehouse entry;
  - take the canonical `.login.lock`;
  - invoke upstream login exactly once;
  - clean up the lock safely;
  - preserve upstream exit behavior;
  - re-execute a successful non-login original command exactly once;
  - never re-execute an original `login`.
- If already inside an active Safehouse, direct or guided login fails closed with exit 77 and tells
  the user to rerun from the host dev shell. Avoiding a second sandbox is not treated as escaping the
  existing one.
- Removal is entirely TypeScript-owned and uses an unambiguous NUL transport; legal paths containing
  spaces, quotes, and newlines are covered.
- Listing omits invalid account names and account symlinks that escape the root.
- Worktree re-exec preserves CLI selection and initialization intent; environment selection remains
  in the environment.
- On Linux, account selection rebinds `CODEX_HOME` without entering macOS Safehouse.
- On macOS, only the selected account is granted and sibling account state remains denied.
- Missing `zx-wrapper` maps to 69. A launched helper crash maps to 70.
- Upstream `codex --version` compatibility is cached by executable identity and mtime; reviewed
  `0.144.x` is accepted, mismatch warns once, and wrapper-only worktree operations do not invoke
  upstream merely for version detection.
- Safehouse tests use synthetic temporary HOME/account/cache state and explicitly remove inherited
  account, initialization, removal, and Safehouse selectors. They never inspect real user Codex
  state.
- Repo-write coverage snapshots source and scans recently changed `.viberoots/workspace` and
  `buck-out/tmp` files for synthetic account names, API keys, access/refresh tokens, and non-approved
  JWT claims.

### Command-site policy

The final reviewed command-site policy on the combined source state is:

```text
expectedCount: 534
expectedDigest: aade2ee3de38bd4efe13fe726361574961e793a663a78861d15c961f0fc5de92
```

The new `codex-accounts/` production command sites are classified as
`non-artifact-orchestration`.

### Pre-interactive validation evidence

The affected union below was green for the account refactor before the later interactive-terminal and
upstream authentication-schema corrections:

```text
.viberoots/workspace/buck/codex-test-logs/
  codex-accounts-refactor-final-affected-union-20260723-r3.log
```

Result:

```text
shared:              22/22 passed
project-enforcement:  5/5 passed
```

Detailed verify log:

```text
.viberoots/workspace/buck/verify-logs/
  verify-2026-07-23T23-56-47-365Z-22131-0d05d7f7cfe93.log
```

Other useful pre-interactive account logs:

```text
codex-accounts-review-findings-focused-20260723-r3.log
codex-accounts-safehouse-isolated-focused-20260723.log
codex-accounts-stale-shell-focused-20260723.log
codex-accounts-refactor-new-focused-20260723-r2.log
codex-accounts-refactor-existing-focused-20260723-r3.log
```

Direct checks also passed on that source state:

- Prettier for all new/affected account TypeScript and docs;
- Bash syntax for `build-tools/tools/bin/codex`;
- staged and unstaged `git diff --check`;
- TypeScript 250-line limit;
- full repository lint/format preflight through `v`.

### Interactive-terminal follow-up

After the initial review, a real interactive invocation of `codex --account unfairly` exposed an
`EAGAIN` failure in the newly added confirmation helper. The helper called `fs.readSync(0, ...)`
against Node's temporarily non-readable TTY descriptor.

The root-cause correction is uncommitted:

- `codex-accounts/terminal.ts` now delegates to the existing asynchronous
  `promptTerminalLine` controlling-terminal authority;
- guided creation, first-default selection, and account removal await that shared result;
- non-interactive decisions remain fail closed before prompting;
- a helper-boundary contract requires the asynchronous authority and rejects a return to
  `readSync`;
- the command-site count remains 534; only the reviewed digest changed because the existing
  upstream-login executor moved in the source.

Focused validation passed:

```text
.viberoots/workspace/buck/codex-test-logs/
  codex-accounts-terminal-prompt-focused-20260723-rerun.log
  codex-accounts-terminal-declared-python-pty-focused-20260723.log

shared:              4/4 passed
project-enforcement: 5/5 passed

controlling-terminal target:
shared:              1/1 passed
project-enforcement: 5/5 passed
```

The behavioral PTY test uses the reviewed
`VBR_ARTIFACT_TOOLS_ROOT/bin/python3` store tool and a checked-in Python-stdlib PTY harness. It does
not use `/usr/bin/expect`, `/usr/bin/script`, or another host-tool fallback. Both the harness and its
Node parent terminate their child process groups on timeout.

### Upstream authentication-schema follow-up

A second real guided login exited successfully upstream but was rejected by the wrapper. Redacted
inspection showed that current Codex persists `auth_mode: "chatgpt"`, while the new inspector and
synthetic fixtures incorrectly expected `"ChatGPT"`. OpenAI's current upstream documentation also
identifies the persisted modes as `chatgpt` and `apikey`.

The structured inspector, fixtures, and design now recognize exactly the current lowercase
`chatgpt` and `apikey` values. The invented capitalized spellings were removed rather than retained
as a compatibility fallback. The token and API-key usability requirements remain unchanged.

Validation evidence:

```text
.viberoots/workspace/buck/codex-test-logs/
  codex-accounts-live-auth-schema-terminal-focused-20260723.log
  codex-accounts-live-auth-schema-final-affected-union-20260723.log
  codex-accounts-live-auth-safehouse-repair-20260723.log
```

- the auth-state authority plus real PTY lifecycle passed 2/2 with 5/5 enforcement;
- the conservative account/Safehouse union passed 22/23; its sole failure was a stale-shell fixture
  missing the new exact `terminal-select.ts` transitive source;
- after adding that exact fixture input, the failed Safehouse target passed 1/1 with 5/5
  enforcement.

The complete 23-target conservative account/Safehouse union was then rerun on the repaired exact
source state:

```text
.viberoots/workspace/buck/codex-test-logs/
  codex-accounts-latest-final-affected-union-20260723.log

.viberoots/workspace/buck/verify-logs/
  verify-2026-07-24T01-31-58-105Z-30523-e329ba2d0b8dd.log
```

Result:

```text
shared:              23/23 passed
project-enforcement:  5/5 passed
```

The command exited 0. This closes the pending account-specific affected-union test gate.

### Independent account review

A blockers-only independent security/scope review initially found:

1. login could remain inside an already-active Safehouse;
2. missing-account initialization skipped account-root containment;
3. argv pre-scanning could reinterpret an upstream option value and strip unrelated `--yes`;
4. repo-write coverage excluded generated roots;
5. the stale-shell Safehouse fixture still inherited real account state.

All five were fixed with focused regressions. The re-review of that source state was clean:

> No remaining material correctness, security, scope, or fixture-isolation blockers found.

The interactive-terminal and lowercase authentication-schema corrections described above were made
after that account-only review. They were included in the later combined blockers-only review, which
passed on the complete PR-3 source state. Do not reopen the resolved findings without contrary
repository evidence.

## 7. Rust language plan PR-3: current implementation

PR-3 is:

```text
PR-3: Integrate Cargo With Read-Only Install And Transactional Update
```

The plan section begins around line 307 of `build-tools/docs/rust-language-plan.md`.

### Intended contract

- Register Rust in the canonical project-language consistency registry.
- Use pinned Nix-store Cargo, never host Cargo.
- Keep `i`, post-clone, devshell entry, and `b` read-only.
- Stale Cargo state reports `repair: run u`.
- `u` performs conservative offline metadata resolution without a broad update.
- `u --upgrade` performs bounded offline `cargo update`.
- Both paths verify with `--locked --offline`.
- All lock paths/presence are inventoried and byte-exactly restored on failure, timeout,
  interruption, or partial multi-project failure.
- Owned process groups are bounded, terminated, and awaited.
- Neither mode changes viberoots gitlinks, flake pins, or source-mode metadata.
- A production launcher fixture proves hostile-`PATH` isolation and source authority.

### Implemented production areas

The staged implementation includes:

- `build-tools/tools/dev/install/cargo.ts`
  - typed Cargo lifecycle;
  - conservative and upgrade modes;
  - controlled roots and snapshots;
  - rollback and process ownership.
- `build-tools/rust/cargo-source-policy.json`
  - reviewed source/cache policy.
- update-command registration and dispatch in:
  - `build-tools/tools/dev/update-command/args.ts`
  - `run.ts`
  - `surfaces.ts`
  - `toolchain.ts`
- read-only Rust consistency wiring through install, dev-build, consumer bootstrap, post-clone, and
  devshell boundaries.
- Nix Cargo/toolchain packaging and language registration.
- extensive direct lifecycle, source-policy, offline-registry, read-only-entrypoint, launcher, and
  rollback tests.
- documentation updates across the Rust design/plan, update-command design/plan, build-tools index,
  remote setup, and troubleshooting.

### Important full-run discoveries already fixed

The PR-3 work expanded beyond the initial implementation because the mandatory full suite found
real shared-boundary problems. These fixes are part of the staged PR-3 state and must not be peeled
off casually.

#### Resource-limited taxonomy

Three Rust tests invoked public pnpm reconciliation but were not in the canonical resource-limited
taxonomy:

- `rust.native-build.fail-closed`
- `rust.native-build.rejects-cross-root-deps`
- `rust.native-test.external-runner`

They are now registered in the single canonical taxonomy. No per-test bypass or duplicate
scheduling authority was added.

#### Update-command launcher authority

A temp consumer generated one artifact-tools Nix identity but inherited another
`VBR_ARTIFACT_TOOLS_ROOT`. Production correctly failed closed. The shared fixture was corrected so
the source, generated toolchain paths, and active artifact-tools root identify one reviewed closure.
Production mismatch rejection remains strict.

#### Temp consumers and consumer pollution

Tests now use scaffolded temporary repositories instead of adding test-only projects to the real
consumer repository. Preserve that direction.

#### Fresh-clone and seed authority

Fresh-clone tests now stage the canonical consistency entrypoint and can omit the Node importer when
testing Rust-only behavior. Dead `VBR_REAL_UPDATE_PNPM` fixture residue was removed after an
independent review.

#### Buck config/global inputs

The full checkpoint's sole final failure was:

```text
viberoots//:ci_bootstrap_safe_glue_no_node_modules
```

Failure evidence:

```text
File not found: config//prelude.bzl
```

The fixture wrote a bespoke minimal `.buckconfig`, shadowing the canonical seeded config/prelude
authority. The correction removed the duplicate minimal-config fixture from both:

- `bootstrap-safe.glue.no-node-modules.test.ts`
- `wheelhouse-preload.no-python-importers.test.ts`

The exporter now includes configured generated global-input targets only when the canonical marker
exists. Do not restore the old ad hoc config or add a retry.

#### Cache-health handoff and slowdown

The latest full checkpoint was much slower than normal. There were two contributing layers:

- high host/cold-cache contention was visible in the full log;
- a real systematic bug amplified it: a healthy shell cache review that made no `NIX_CONFIG`
  rewrite lost its authenticated “applied” state, so nested commands repeated TypeScript probes and
  could disable caches, causing more local work.

The staged fix transports a typed `{ applied, config }` result through the command FD and canonical
`p` subprocess boundaries, including the healthy empty-config case.

Relevant files include:

- `build-tools/tools/bin/cache-health-command-scope.sh`
- `build-tools/tools/bin/artifact-ingress-env.sh`
- `build-tools/tools/dev/verify/nix-cache-health.ts`
- `build-tools/lang/nix_cache_health.bzl`
- cache-health command-scope and shell-handoff tests
- performance guidance in `docs/handbook/getting-started-on-a-pr.md`

Do not bypass this with `VBR_NIX_CACHE_POLICY=off`, direct Buck, or ambient `NIX_CONFIG`.

#### Selected fast-path timing

The corrected focused timing regression passed:

```text
viberoots//:dev_runnable_commands_selected_fast_path
```

Evidence:

```text
.viberoots/workspace/buck/codex-test-logs/
  rust-pr3-cache-handoff-timing-regression-20260723.log
```

Result: passed in approximately 3:17 for that focused run. This is evidence for the corrected path,
not a universal performance baseline.

## 8. Rust PR-3 validation evidence and remaining gate

### Mandatory full checkpoint that completed

Outer log:

```text
.viberoots/workspace/buck/codex-test-logs/
  rust-pr3-mandatory-full-checkpoint-20260723.log
```

Detailed log:

```text
.viberoots/workspace/buck/verify-logs/
  verify-2026-07-23T18-53-02-179Z-39382-bb886489ddac.log
```

The shared phase completed:

```text
Pass 1621
Fail 1
```

The sole failure was `ci_bootstrap_safe_glue_no_node_modules`, described above. The run lasted about
3 hours 33 minutes overall; the shared phase took about 1 hour 35 minutes. Host load became extreme,
and many targets were substantially slower than historical norms.

### Post-full-run repairs that are green

Structural authority union:

```text
.viberoots/workspace/buck/codex-test-logs/
  rust-pr3-all-four-structural-union-20260723.log
```

Result:

```text
isolated:             2/2 passed
shared:               9/9 passed
project-enforcement:  5/5 passed
```

It covered:

- Rust read-only entrypoints;
- fresh-clone post-clone;
- bootstrap safe glue;
- wheelhouse preload;
- exporter global-input roots;
- artifact ingress;
- canonical reviewed config handoff;
- cache-health unit and shell handoff;
- runnable selected contracts;
- command-site inventory.

Fresh-clone residue/lifecycle union:

```text
.viberoots/workspace/buck/codex-test-logs/
  rust-pr3-fresh-clone-residue-final-20260723.log
```

Result:

```text
isolated:             4/4 passed
project-enforcement:  5/5 passed
```

Other useful passing evidence:

```text
rust-pr3-selected-config-threading-combined-final-20260723.log
rust-pr3-selected-contract-adjacent-union-20260723.log
rust-pr3-secure-cache-scope-affected-union-20260723.log
rust-pr3-all-four-structural-union-20260723.log
rust-pr3-fresh-clone-residue-final-20260723.log
```

### Final validation evidence

The mandatory exact-state checkpoint passed:

```text
command: env -u NODE_PATH VBR_GC_MODE=off i &&
         env -u NODE_PATH VBR_GC_MODE=off b &&
         env -u NODE_PATH VBR_GC_MODE=off ALL_TESTS=1 v
exit: 0
elapsed: 10,684 seconds (2h 58m 4s)
outer log:
  .viberoots/workspace/buck/agent-test-logs/
  pr3-mandatory-full-checkpoint-20260724T020252Z.log
detailed log:
  .viberoots/workspace/buck/verify-logs/
  verify-2026-07-24T02-04-13-745Z-12504-9b8e18608427a.log
```

Top-level results:

```text
project-enforcement: 5/5
enforcement:         46/46
isolated:            15/15
isolated-bounded:    15/15
resource-limited:   263/263
shared:            1639/1639
```

All phases reported zero timeouts, fatal errors, skips, omissions, infrastructure failures, and
build failures.

After that broad checkpoint, the user authorized a risk-based focused delta instead of another full
suite. The delta makes Repo Skills discoverable through the generated repo marketplace and requires
isolated `fork_turns="none"` contexts for implementation, test, review, and assessment subagents.
The marketplace, fresh-clone/post-clone, `init-consumer`, and subagent-isolation targets passed.
Plugin and skill validators, formatting, file-size enforcement, and `git diff --check` also passed.

## 9. Tauri plan amendment

The user explicitly asked that the Rust plan include a Tauri scaffold capable of consuming
repository libraries, including Rust, C/C++, and WASM.

That amendment is now in `build-tools/docs/rust-language-plan.md`:

- PR-11: cross-language Tauri desktop scaffold;
- typed cross-root Rust dependencies;
- reviewed C/C++ link/header/ABI bridge edges;
- staged Rust, C/C++, and other supported WASM producers through module surfaces;
- pinned `cargo-tauri` and frontend tools;
- no arbitrary plugins, host/global tooling, or direct unstable C++ ABI;
- PR-12 closes final Tauri/Rust hermeticity, builder, publication, and assessment evidence.

Do not remove or weaken this amendment when reconciling PR-3 docs.

## 10. Recommended resume sequence

### Phase A: completed review and validation

The combined scope and security reviews passed. The exact-state full checkpoint and the later
risk-based focused delta are green. Preserve their logs; do not rerun the full suite solely because
the Repo Skills documentation and bootstrap marketplace delta landed afterward.

### Phase B: commit

Do not commit until:

- combined scope/security review is clean;
- required focused/affected validation remains green;
- the mandatory full checkpoint requirement is satisfied or the user explicitly authorizes an
  evidence-based alternative;
- no failed-theory residue remains.

The user said to preserve everything and commit it together once everything is fixed.

Use the repo skills workflow. Commit submodule first, then parent:

1. commit the complete submodule change set with a representative conventional commit;
2. commit the parent `.gitignore`, deployment policy changes, and new submodule pointer;
3. preserve `test-tmp-paths.log` unless the workflow and user explicitly decide it belongs in a
   commit;
4. do not push either commit without explicit user authorization.

The submodule is detached. A local detached commit is acceptable for this handoff; do not invent or
move a branch and do not push.

### Phase C: continue the Rust PR flow

After PR-3 lands:

- continue PR-4 onward using `$repo-skills:prs` conventions;
- use a dedicated PR agent and independent scope review per plan item;
- honor the plan's turbo/full cadence table;
- reach PR-11's Tauri scaffold and PR-12's final hermeticity/publication/builder assessment;
- run `assess-plan` and `assess-design`;
- add follow-up PRs only for evidence-backed remaining gaps.

## 11. Common traps for a fresh agent

- Do not assume staged changes are “old” and unstaged changes are “new mistakes.” Both are required.
- Do not run `git reset`, `restore`, `clean`, or `stash`.
- Do not update the command-site digest from a guessed source state. Let preflight report the actual
  count/digest, review the command sites, then update intentionally.
- Do not reintroduce the 1,391-line Bash account implementation.
- Do not parse `auth.json` or JWTs in Bash.
- Do not accept mere `auth.json` existence as authentication.
- Do not allow account-root or account-directory symlinks to escape canonical containment.
- Do not run login from inside an already-active Safehouse.
- Do not use a fixture's real HOME, Codex account state, cache, or selectors.
- Do not restore bespoke minimal Buck configs to temp consumers; use the canonical seeded authority.
- Do not bypass cache health with ambient `NIX_CONFIG` or `VBR_NIX_CACHE_POLICY=off`.
- Do not add consumer projects solely to test viberoots.
- Do not confuse OpenAI `CODEX_HOME` account selection with Bedrock provider selection.
- Do not discard the green exact-state full checkpoint merely because the later, bounded Repo Skills
  delta used the user-approved risk-based focused validation.

## 12. Compact status statement for the user

A good initial status update after independently checking the evidence is:

> I found and verified the handoff. The parent remains on `codex/hermetic-builds`; the submodule is
> detached. The combined Rust PR-3, timing/cache corrections, and Codex account wrapper passed scope
> and security review. The mandatory exact-state `i`, `b`, and `ALL_TESTS=1 v` checkpoint passed all
> six phases in 10,684 seconds. The later Repo Skills isolation and bootstrap marketplace delta
> passed its focused targets and validators under the user's risk-based validation direction. I will
> preserve `test-tmp-paths.log`, commit the submodule before the parent pointer, and not push.

Use that only after verifying the repository still matches this handoff.
