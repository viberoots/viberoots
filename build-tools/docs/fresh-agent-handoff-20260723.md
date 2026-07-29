# Fresh-Agent Handoff: Viberoots Rust PR Flow And Codex Accounts

**Prepared:** 2026-07-23

**Last reconciled:** 2026-07-28, after PR-10 focused validation and terminal scope review

**Workspace:** `/Users/kiltyj/Code/viberoots-site`

**Timezone:** `America/Los_Angeles`
**Purpose:** Give a completely fresh agent enough durable context to resume the current uncommitted
work safely and productively.

This document is evidence and orientation, not authority. Verify every material claim against the
repository, staged and unstaged diffs, and the referenced logs before editing.

## 0. Current handoff: this section supersedes all older execution state below

The next `$repo-skills:prs` item is PR-11, `Add A Cross-Language Tauri Desktop Scaffold`, from:

```text
plan:   build-tools/docs/rust-language-plan.md
design: build-tools/docs/lang/rust-design.md
repo:   /Users/kiltyj/Code/viberoots-site/viberoots
PR-9 commit: 9748d651 feat(rust): add WASM linking and component parity
```

PR-10 implementation, risk-based validation, repeated independent reviewer-fix loops,
same-progression parity review, and terminal independent scope review are complete in the commit
containing this handoff; inspect `HEAD` for its SHA. No push is authorized. PR-11 is next.

PR-10 adds the Nix-owned Rust 1.88 developer closure and editor authority; rustfmt, Clippy,
rustdoc/doc tests, benchmark compilation, real cargo-llvm-cov aggregation, dependency inventory,
private-source hygiene, serialized bounded `run.dev` watching, explicit local override handling,
and seven scaffold families. Fresh flake and real submodule lifecycles exercise CLI, library,
proc-macro, Python extension, Node addon, C++ bridge, and raw/WASI WASM shapes. Non-runnable shapes
reject `r` and `d` before selected builds.

The final override route is intentionally asymmetric. Public `p` remains fail-closed even if an
obsolete passthrough marker is spoofed. Public `d` accepts only an explicit Rust override from
canonical argv, strips ambient artifact-affecting variables, and delegates to a private
manifest-backed child. Tests prove two child spawns after an override edit, both expected outputs,
absence of the ambient sentinel, and cleanup. Read-only prebuilds freeze generated artifact-tool
authority; explicit `u` alone may reconcile it. The generated manifest, artifact-tools GC root, and
fresh direnv shell must resolve to the same store path.

The terminal exact ten-selector run passed shared 10/10 and enforcement 5/5 in 394 seconds. The
source fingerprint remained
`78ac564914960219716b313f90be8d3fcbe321485b954c4b24c87ffd00b5dc98`; the manifest, GC root, and
fresh direnv authority remained
`/nix/store/21l6n0hpxc2064rzclrx08164p8a37k4-remote-worker-tools`; and the manifest mtime was
unchanged. Authoritative logs:

```text
outer:
  /Users/kiltyj/Code/viberoots-site/.viberoots/workspace/buck/agent-test-logs/
  v-terminal-final-ten-20260728-175235.log
verify:
  /Users/kiltyj/Code/viberoots-site/.viberoots/workspace/buck/verify-logs/
  verify-2026-07-29T00-52-57-008Z-92548-11c1720f75c1b.log
```

The terminal review found no implementation, security, lifecycle, authority, validation, parity, or
methodology gap. Its only final findings were two stale documentation statements claiming that
PR-9/10 remained and that Rust scaffolding was CLI-only; both are corrected in the commit containing
this handoff, and the follow-up review passed.

Do not preserve the older staged-versus-unstaged separation described below. It is historical. Do
not push. The parent consumer repository currently has a modified `viberoots` pointer and its
pre-existing untracked `test-tmp-paths.log`; preserve both and keep the log outside this submodule
commit.

### How the PR flow is being run

Use `repo-skills:prs` in turbo mode, with minimal-context independent agents:

1. Give each implementation, tester, or reviewer agent only the plan/design paths, PR identifier,
   repository path, and its bounded role. Do not fork the entire conversation into reviewers.
2. Keep verbose validation output in log files. Agents report only target, elapsed time, pass/fail
   totals, a redacted failure excerpt, and scoped process/temp/secret deltas.
3. Run focused selectors sequentially and stop on the first failure. Use `repo-skills:investigate`
   to prove the root cause and validate the primary path before resuming.
4. Require a fresh independent scope-review agent after the final material edit.
5. Commit through `repo-skills:cc` only after implementation review, validation, timing checks, and
   scope review are green. Never push without explicit user authorization.

PR-10 is complete, so PRs 11-12 remain. Continue them in numeric order with a fresh isolated
implementation agent and separate isolated reviewer/tester roles for each PR. Use risk-based
focused suites for PR-11 because PR-9 exercised a complete checkpoint and PR-12 will do so again.
Run the final full checkpoint for PR-12, or earlier if a material cross-cutting change makes the
focused evidence insufficient. Record elapsed timing and compare successful full checkpoints with
the 10,684-second successful baseline.

For a required full-suite run, stop only for a deterministic failure observed within the first five
minutes. Once the run has crossed five minutes, continue to its final exit and collect every
failure before investigation. Do not terminate a long full suite at the first later failure.

### PR-9 completion evidence

Implemented scope includes:

- Rust raw, WASI, deterministic static, wasm-bindgen browser-package, and WIT/component macros with
  typed ABI/target/link/libc/allocator/exception/runtime/export/profile/adapter/module-surface
  metadata;
- pinned wasm-bindgen, Binaryen, wasm-tools, wasmtime, and official preview1 adapter authority;
- deterministic Rust BSD-staticlib normalization into GNU WASM archives, with Darwin fixup disabled
  so TinyGo/wasm-ld can consume the exact archive;
- proven C++ bare static -> Rust raw, Rust static -> TinyGo, TinyGo static -> Rust, and transitive
  C++ consumer directions, plus explicit bare/WASI compatibility and fail-closed matrix entries;
- genuine wasm-bindgen Node execution, raw instantiation, component execution in pinned wasmtime,
  component byte reproducibility, optimization/debug/source-map/export/WIT negatives, and Rust
  panic/authority checks;
- direct declared Rust Buck edges through production Node static/SSR/service/CLI staging, portable
  `buck:<label>#sha256-...` manifest identities, production service identity, Kubernetes artifact
  admission, and admitted blob byte/path identity;
- signed credential-free cache export, production materialization manifests, cold local-store raw
  and browser execution, exact source/store identity checks, and all available full-lane WASI
  outputs selected for cache/materialization when the builder provides them;
- public patch lifecycle changing browser, component, raw, static, WASI static, WASI component, and
  WASI binary outputs and runtime behavior, with the same locked Cargo/patch identity and exact
  output/manifest restoration;
- content-sensitive Rust producer lineage derived from the immutable filtered source bundle,
  Cargo.lock bytes, and content-addressed patch identity, while the structural composition digest
  remains separately named; source mutation and patch apply/remove tests prove change and exact
  restoration through Rust manifests and Node/deployment staging;
- package-local header/WIT enforcement, exact WIT identifier allowlists, external-label rejection,
  and honest remote-worker/publication limitations in docs; and
- reusable adding-language guidance for cross-language WASM authority and deterministic archive
  normalization.

Key final focused evidence:

```text
terminal five-finding combined artifact gate:                   1/1, 6m42s
  verify-2026-07-28T07-39-05-024Z-99872-5be22a620b2e7.log
contract analysis negatives:                                    1/1, 2m23s
portable producer/copy identity:                                1/1, 11s
expanded combined artifact/cross-language/Node/cache/patch gate: 1/1, 433.43s
native provenance direct immutable-input regression:            1/1, 85.57s
portable asset identity unit:                                   1/1, 12.38s
mixed-producer node_asset_stage integration:                     1/1, 13.58s
WIT regex-injection analysis rejection:                          1/1, 12.17s
WASI/cross-language authority matrix:                            7/7, 8.95s
```

The browser evidence is real browser execution, not a Node proxy. The acceptance target imports
`build-tools/tools/tests/rust/rust-wasm-browser-runtime.ts`, reads the pinned Nix-store Firefox path
from `share/viberoots-rust/wasm-manifest.json`, launches Firefox headlessly with an isolated
profile, loads the emitted `browser-harness.html`, invokes the exported `answer()` probe, and
requires the browser report `{ probe: "answer", result: 42 }`. The latest recorded passing target
evidence is:

```text
target:
  viberoots//:rust_rust_wasm_wasi_artifacts
result:
  passed in 8:02.6
verify log:
  /Users/kiltyj/Code/viberoots-site/.viberoots/workspace/buck/verify-logs/
  verify-2026-07-28T05-21-35-526Z-50772-1ca1d4d1f0986.log
```

That broader focused run found four unrelated environment/cache transport failures. After their
repairs, an exact integrated rerun passed all four targets:

```text
i: 23s
b: 82s
v: 107s
supervising runtime: 240s
supervising log:
  /Users/kiltyj/Code/viberoots-site/.viberoots/workspace/buck/agent-test-logs/
  i-b-v-pr9-transportfix-20260727.log
verify log:
  /Users/kiltyj/Code/viberoots-site/.viberoots/workspace/buck/verify-logs/
  verify-2026-07-28T05-50-45-170Z-42084-b2075ad2573f6.log
```

The exact passing targets were cache-role provenance, nested verify isolation, verify spawn
snapshots, and the Rust library/binary consumer. Direct artifact-transport and nested-cache-role
contracts also passed 3/3 each. Changed-source LOC, command-site inventory, targeted
Prettier/ESLint, and `git diff --check` passed.

The required PR-9 full suite then ran to true process exit:

```text
command: NIX_BUILD_CORES=4 i &&
         NIX_BUILD_CORES=4 b &&
         NIX_BUILD_CORES=4 ALL_TESTS=1 v
i:       19s, exit 0
b:       63s, exit 0
v:       11,933s, exit 32
total:   12,015s (3h 20m 15s)
log:
  /Users/kiltyj/Code/viberoots-site/.viberoots/workspace/buck/agent-test-logs/
  pr9-full-suite-retry-20260728T113532Z.log
```

The run was 1,340 seconds below the 13,355-second significant-regression threshold. Its first four
lanes passed 82/82; resource-limited passed 270/274 and shared passed 1,671/1,690. Investigation
reduced the 23 failures to deterministic tool/config/test issues plus a required-cache outage burst.
All deterministic or repeatable failures were fixed and passed exact or grouped focused reruns.
The user authorized risk-based closeout instead of repeating the full suite because another
checkpoint is planned for later Rust PRs.

The PR-9/PR-10 tool boundary check passed after selecting the minimal Rust distribution:

```text
command:
  i && b && v viberoots//:dev_toolchains_nix_build_go_python
i: 21s
b: 82s
v: 120s
requested target: passed in 1:12.8
supervising log:
  /Users/kiltyj/Code/viberoots-site/.viberoots/workspace/buck/agent-test-logs/
  i-b-v-dev-toolchains-restart-20260727-230816.log
verify log:
  /Users/kiltyj/Code/viberoots-site/.viberoots/workspace/buck/verify-logs/
  verify-2026-07-28T06-10-20-377Z-77141-e193e68699ea.log
```

The later local verify-tool authority correction passed its exact integrated selector set:

```text
command:
  i && b && v \
    viberoots//:dev_artifact_environment_ingress \
    viberoots//:dev_buck2_test_env_verify_nested_isolation \
    viberoots//:remote_exec_verify_buck2_test_spawn_snapshot
i: 20s
b: 108s
v: 53s
requested targets: 3/3 passed
supervising log:
  /Users/kiltyj/Code/viberoots-site/.viberoots/workspace/buck/agent-test-logs/
  i-b-v-ingress-transport-20260727-232822.log
verify log:
  /Users/kiltyj/Code/viberoots-site/.viberoots/workspace/buck/verify-logs/
  verify-2026-07-28T06-30-53-110Z-16288-d946c6c112f8b.log
```

Direct contracts also passed local/nested tool environment 8/8, spawn snapshots 5/5, and artifact
ingress 10/10. PR-9's later independent scope review passed before commit.

### PR-8 completion evidence

PR-8 closes the reviewed bidirectional native bridge contract:

- public handwritten Rust/native FFI is no longer an ABI bypass; ordinary Rust macros reject native
  link/header intent and direct callers to `rust_c_ffi_library` or `rust_cxx_bridge_library`, while
  the private stamped bridge planner retains the canonical native closure;
- a reviewed, repo-owned, versioned generator consumes strict package-local JSON and emits
  deterministic C/C++ headers and shims, Rust import declarations, export signature checks, ABI
  manifests, and typed module-surface metadata as Nix action outputs;
- schema validation rejects unknown fields, absolute or undeclared headers, malformed C++ names,
  unsupported callback shapes, untyped error fallbacks, ambiguous ownership/destruction, and
  export-side aliases;
- genuine C11 and C++17 providers and consumers execute both directions through generated
  bindings, including static/shared artifacts, owned strings and values, callbacks, destruction,
  typed errors, caught C++ exceptions, and Rust panic abort without unwinding across the ABI;
- real construction binds the selected profile's compiler store identity, canonical target triple,
  language standard, STL, nixpkgs profile/pins, module surface, and runtime closure; mismatches and
  caller spoofing fail closed, including a real non-default LLVM profile;
- Darwin dylib identities and runtime closure are normalized and inspected;
- pure filtered selected bundles build from a declared immutable source snapshot, replay with the
  explicit canonical tool closure under poisoned ambient Rust state, materialize the selected
  output, compare replay identity, and execute the consumer on the supported current host;
- other supported systems are covered honestly by structural fail-closed matrix evidence rather
  than claimed as locally executed;
- separate C and C++ routes exercise `bridge -> interop_core -> itoa`, transitive native
  source/header patching, exact restoration, and bridge-specific override expansion with exact
  `[native, support]` order, count, and uniqueness; and
- the C++/Rust linking, interop, build-system, Rust design, Starlark API, troubleshooting, and
  add-a-language documentation now describe the same generated-binding authority.

Final-tree focused evidence:

```text
immutable filtered runtime + replay/materialization + panic:  1/1, 228.23s
transitive C/C++ patch + override/order/restoration:           1/1, 286.50s
bindings + real graph + target/compiler spoof rejection:       4/4, 27.63s
profile/compiler/target compatibility construction:             3/3, 7.06s
Rust ABI mismatch compile failure:                               1/1, 34.19s
public bridge boundary + private closure:                        2/2, 27.04s
filtered/system structural evidence:                             2/2
materialization suite:                                          15/15
```

The user-authorized risk-based cadence applies to PR-8, so no redundant broad suite was run.
Canonical broad verification was also temporarily blocked by the disk guard while current-source
Nix closures were being built; normal test cleanup later recovered space. The final focused
evidence uses the exact current source and immutable replay path rather than the installed
pre-PR-8 artifact-tools source.

Final static/read-only gates passed Prettier for changed TS/MJS/JSON/Markdown, all changed Nix
parses, Node syntax checks for generator/schema modules, `git diff --check`, command-site inventory
(538 reviewed sites), secret/temp/process scans, unchanged generated toolchain authority, empty
staging, and the hard 250-line limit. The final terminal reviewer passed the selected-profile ABI
identity, non-spoofable public boundary, exact bridge override/order evidence, documentation, and
all split-file guardrails. No PR-8 scope finding remains open.

### PR-7 completion evidence

PR-7 closes native Rust extension packaging for Python and Node at the capability level expected at
this point in the plan:

- `rust_python_extension` produces an importable CPython extension with selected ABI,
  `EXT_SUFFIX`, stable module naming, translated exceptions, importer-scoped uv/uv2nix build
  dependencies, producer-language-neutral Python overlay staging, and fail-closed unsupported
  Pyodide/WASI analysis;
- `rust_node_addon` produces a stable `.node` artifact for an explicitly selected Node-API 8, 9,
  or 10 contract, with pinned headers, API floor/ceiling symbol auditing, a loader-visible version
  getter bound to the declaration, and an independent `dlopen`/`dlsym` pre-install probe;
- CLI, service, and webapp consumers stage addons and their recursively expanded dynamic
  `runtime_deps`; services retain final artifact identity and Kubernetes deployment-blob
  admission;
- native Python and Node runtime fixtures call through Rust into a transitive C/C++ shared-library
  closure, including relocated runtime paths that cannot fall back to a warm host store;
- signed, credential-free cache evidence consumes the production materialization manifest, copies
  the full closure through a private cache into an isolated local store, proves addon-only failure
  without the adjacent runtime closure, and loads the complete cold copy without mutating the
  shared host store;
- one public `patch-pkg start/apply/remove` workflow changes both real Python and Node extension
  outputs and restores exact output/session identity;
- the combined update transaction snapshots before toolchain-authority repair and restores exact
  bytes, modes, symlinks, absent files, GC roots, `projects/TARGETS`, and the complete generated
  workspace toolchain tree after a later Go/Python/Rust/glue failure;
- extension-only macro attributes fail closed outside their owning target kind and wrapper,
  including the private Python lockfile forwarding path; and
- multi-addon runtime staging retains byte-identical same-basename libraries and rejects differing
  bytes using pinned `diffutils`, rather than overwriting by traversal order.

The absolute final affected gate passed:

```text
requested shared tests:       8/8
project enforcement:          5/5
shared elapsed:               2m 40s
enforcement elapsed:          17s
outer elapsed:                210s
failures:                     0
authoritative log:
  .viberoots/workspace/buck/agent-test-logs/
  pr7-final-eight-canonical-lockfile-label-20260726-192837.log
```

Final gates also passed changed-file Prettier and ESLint, all changed Nix parses,
`git diff --check`, source and SSR 250-line enforcement, Nix-gaps inventory, secret scan,
process/temp cleanup, and empty staging. The final source fingerprint was stable across the last
audits:

```text
9a27dfeb7093a0f8eb48719dd405dd46fc5d7d4add0d09aa282594c6c4a72bed
```

The terminal read-only reviewer passed the complete workspace-toolchain rollback, collision-safe
runtime merge, and non-spoofable Python lockfile forwarding fixes. Earlier independent passes also
confirmed parity with mature Python, Node, and C++ routes at PR-7 while excluding intentional
PR-8–12 work. No PR-7 scope finding remains open.

### Remaining PRs

- PR-11: the cross-language Tauri desktop scaffold.
- PR-12: final multi-system hermetic graduation, publication, protected-builder, and independent
  assessment evidence.

### PR-6 completion evidence

PR-6 closes cross-root Cargo composition and the stable Rust artifact/provider contracts:

- reviewed Buck/Cargo path dependencies compose a precise reachable source closure, including
  Cargo workspace members while excluding unrelated nested roots and hostile symlinks;
- `rlib`, `staticlib`, `cdylib`, and host-built proc-macro outputs have validated public names,
  deterministic paths, explicit host/target roles, and generated/runtime metadata;
- Rust static libraries export a native-link/runtime provider consumed by the C++ planner; the
  runtime test links through Rust to a shared C++ dependency and executes successfully;
- selected, full, filtered, snapshot, and replay composition manifests and digests are compared
  exactly under one current immutable source authority, with stale/missing owner bytes rejected;
- Cargo-compatible semver, null-composition layout, fixed macro argument rejection, and canonical
  public-crate identifier validation are covered;
- public `patch-pkg start/apply/remove` drives real runtime `1 -> 2 -> 1`, changes affected and
  same-owner derivation identities, preserves an unrelated root, and restores baseline identities;
  and
- real Cargo build-script/proc-macro timeout and interruption tests use pinned tools under hostile
  PATH, kill descendants, deny network/ambient authority, and prove retry.

Final affected validation passed in 260 seconds:

```text
requested shared tests:       9/9
resource-limited tests:       2/2
project enforcement:          5/5
failures:                     0
authoritative log:
  /Users/kiltyj/Code/viberoots-site/.viberoots/workspace/buck/verify-logs/
  verify-2026-07-26T21-05-35-903Z-82192-a18bba1915433.log
```

The exact selected/full/snapshot/replay parity selector also passed with enforcement 5/5 in 81
seconds. Final static/read-only gates passed: changed-file Prettier and ESLint, nine changed Nix
parses, `git diff --check`, strict 250-line enforcement, secret scan, process/temp cleanup, and Nix
command-site inventory (536 sites; roles 296 canonical, 4 live-d, 68 update/install, 168
non-artifact; reviewed digest
`bb1c67cad43848a997c1bf6fd62c6dca21f46f75694d86b2fdb675c2e46458cc`).

The final isolated scope review compared Rust with mature C++, Go, Python, and Node capabilities at
the same PR progression and passed with no findings. It explicitly excluded extension packaging,
full bidirectional ABI/generated bindings, expanded WASM, dependency/developer lifecycle, Tauri,
and final publication/independent-builder proof assigned to PRs 7-12.

The reusable `prs` scope-review workflow and `docs/handbook/adding-language.md` now require this
same-stage mature-language comparison while excluding capabilities explicitly assigned to later
plan PRs. The live cached Repo Skills workflow was synchronized for this account; restart the
client after the commit so the installed plugin refreshes normally.

### PR-5 validation and failure investigation

The attempted full run completed in 17,834 seconds (4:57:14), exited `124`, and produced 1,903
passes and 104 failures. Its authoritative logs are:

```text
outer:
  /Users/kiltyj/Code/viberoots-site/.viberoots/buck/agent-test-logs/
  pr5-all-tests-v-env-unset-node-path-20260725-131006.log
canonical:
  /Users/kiltyj/Code/viberoots-site/.viberoots/workspace/buck/verify-logs/
  verify-2026-07-25T18-11-01-565Z-975-1f34579ed790f.log
```

That run is not a successful timing baseline. Ninety-seven failures were directly attributable to
external cache/network behavior, including a network outage. The remaining outliers were isolated
and rerun after root-cause fixes instead of spending another five hours on a redundant full run.
The overall slowdown was about 67% versus the 10,684-second checkpoint, not 4x. Evidence points to
a cold/invalidated worktree plus network retry ladders; macOS was in High Power mode and reported
no thermal or performance warning.

Orphaned Buck processes were traced to temporary identity workspaces being removed before their
isolated daemon was stopped. Teardown now kills the daemon before workspace removal, fixed
isolation call sites have exact cleanup hooks, and a lint gate prevents the unsafe lifetime
pattern. Subsequent selectors reported zero newly leaked scoped daemons, processes, or temporary
workspaces.

Cache tolerance was fixed generically, without hostname exceptions:

- curl TLS exit 35 is classified as transport failure;
- optional caches are disabled in `auto` mode on curl 22/HTTP failure, while required caches and
  strict mode remain fail closed;
- Nix config-source provenance reconstructs required `substituters` versus optional
  `extra-substituters`, including include/reset/append ordering, and accepts roles only when their
  exact set matches effective configuration;
- reviewed policy, roles, configuration, and netrc authority are bound into the file-descriptor
  proof rather than trusted ambient variables;
- canonical re-entry consumes proof only on ordinary ingress;
- credential-bearing URLs fail closed before probe/review, and credentials do not enter
  environment variables, logs, or CAS inputs.
- local verify consumes the same one-shot reviewed-config proof as build; the branded result is
  threaded explicitly through verify passes and nested Buck tests instead of reconstructed from
  flattened or ambient configuration;
- post-health required/optional roles and the reviewed candidate config are bound together;
  required and dual-role failures remain fail closed while unavailable optional caches cannot
  reappear through system defaults or nested daemons; and
- reusable Buck isolation identity includes cache binding plus authoritative graph/source
  identity, so changed policy or graph state retires the prior exact daemon rather than reusing
  stale analysis.

The focused cache selector passed 26/26 in 58 seconds with zero scoped process/temp/fixture/secret
deltas. The formerly failing scaffold-and-build selector passed 1/1 in 166 seconds, including the
expected stale first build, reconciliation, optional-cache fallback, final build, bundle, and CLI
help milestones.

All seven non-cache residuals from the failed full run are now green:

```text
viberoots_maintenance_commands:                  21/21, about 18s
lib_macos_metadata:                              11/11 direct; selector about 4s
dev_runnable_commands_dev_direct_script:          1/1, 9.1s
scaffolding_e2e_move_confirm:                      1/1, 15.9s
scaffolding_e2e_validate_pass:                     1/1, 10.4s
scaffolding_e2e_overwrite_guard:                   1/1, 19.7s
nix_devshell_tools_path_smoke (Happy):             1/1, 13.8s
```

Each selector also passed the five project-enforcement checks and ended with zero fresh scoped
process/temp/store/secret deltas. The Happy cold-store audit registered six paths totaling about
26.5 MB, with none at or above 100 MiB.

The fresh independent review initially found two real gaps: required caches could be silently
removed on transport failure, and Rust remote readiness was asserted through `aquery` without
executing Cargo from a Rust snapshot. Both were fixed. The final remote conformance selector:

```text
target:  viberoots//:remote_exec_remote_conformance_target
result:  rc 0 in 90s; conformance 8/8, shared 1/1, project enforcement 5/5
log:
  .viberoots/workspace/buck/agent-test-logs/
  remote-conformance-final-10-args-20260726-060130.log
```

The Rust build and test fixtures now use a dedicated, self-contained source snapshot containing
Cargo metadata, Rust source, and a nonempty graph. Conformance executes the Cargo build artifact,
asserts its source-owned marker, and executes the Rust test; `aquery` remains only supplemental
structural evidence.

The locally supported PR-5 Rust matrix is green:

```text
C interop:                 rc 0, 270s, project 5/5, artifact 1/1
WASM/WASI:                 rc 0, 105s, project 5/5, artifact 1/1
CLI scaffold lifecycle:    rc 0, 165s, project 5/5, shared 1/1
source-selection parity:   rc 0,  90s, project 5/5, shared 1/1
```

Logs are:

```text
.viberoots/workspace/buck/agent-test-logs/pr5-rust-matrix-01-c-interop-20260726-060536.log
.viberoots/workspace/buck/agent-test-logs/pr5-rust-matrix-02-wasm-wasi-20260726-061017.log
.viberoots/workspace/buck/agent-test-logs/pr5-rust-matrix-03-cli-scaffold-tmp-containment-20260726-080822.log
.viberoots/workspace/buck/agent-test-logs/pr5-rust-matrix-04-source-selection-parity-20260726-081303.log
```

Linux Rust execution remains explicitly fail closed and deferred to the protected builder work in
PR-12; do not claim Linux execution evidence from this host. The user's explicit risk-based waiver
covers not repeating the five-hour full suite after closing every residual cluster and running this
host matrix.

Additional root-cause fixes discovered by the matrix include:

- canonical worker tools now include and validate Copier and Prettier for `NO_DEV_SHELL=1`
  consumers;
- update, install, and dev-build closeout re-render content-addressed global-input TARGETS after
  their final lock/hash mutations and hand off changed consumers before recording final
  fingerprints;
- verify seed snapshots exclude nested `.git` metadata generically, eliminating transient pack-file
  races; and
- verify tmp cleanup compares logical and canonical realpaths, preserves an active workspace nested
  under the cleanup root, and still deletes unrelated siblings. This closed the self-deleting
  scaffold workspace failure without retaining scoped processes or temp roots.

Final readiness evidence:

```text
complete Rust WASM acceptance:      1/1 passed in 984.246s
remote-only immutable replay:       1/1 passed in 88.5s
focused patch/lineage lifecycle:    1/1 passed in 133.9s
focused WASI static consumer:       1/1 passed in 37.1s
Node producer lineage transport:    1/1 passed in 12.9s
Rust static lifecycle contracts:    3/3 passed
full suite to process exit:         12,015s; 23 failures collected and investigated
post-suite deterministic fixes:    all exact/grouped focused reruns passed
final u && i:                       passed
final split affected suite:        56/56 passed across 8 files
full ESLint:                       passed
changed/untracked Prettier:        passed
changed shell bash -n:             passed
changed Nix parse:                 passed
git diff --check:                  passed
changed-source 250-line gate:      passed
reviewed oversized exceptions:     8 known, 0 unknown
Nix command inventory:             538 sites
inventory digest:                  789b8b3d0b6ce2489e25bd854cd622c944a1e41c7f8919e01c9715f2af96a9a8
inventory roles:                   canonical 298, live-d 4, update 68, nonartifact 168
strong secret-indicator files:     0
active scoped test processes:      0
fresh scoped temp entries:         0
source fingerprint:
  949f1d52cdec3a93ec9d5a2c9e509dc52e8c43f3fd5a10dda42c93d52368d662
protected original staged SHA-256:
  691f436b0fa248624121e8e70be5c7b3bf437f617f6c6d09b7f2b4cf8b75e489
```

Repository-wide Prettier still reports six unchanged baseline files outside this diff. Every
changed or untracked formatter-eligible file passes. All unexcepted in-scope files over 250 lines
were split into cohesive helpers/modules; the largest resulting unexcepted file is exactly 250
lines. The PR-9 recovery splits leave the acceptance fixture at 208 lines, remote runtime at 194,
patch lifecycle at 227, Rust template at 239, and Rust identity fixture at 237. Durable recovery
logs are under the parent
workspace `.codex-logs/pr9-final/`; `rust-wasm-acceptance-complete.log` is the final start-to-exit
acceptance record.

### Historical resume state from 2026-07-24

The historical sections remain useful for design decisions and earlier evidence, but their claims
that PR-3 is uncommitted and PR-4 has not started are obsolete. Treat everything below as historical
evidence only when it conflicts with section 0.

The user explicitly paused the active PR-5 implementation so another agent could take over. The
implementation subagent was interrupted. The focused tester had already exited. No `i`, `b`, `v`,
or PR-5 validation process was running when this handoff was reconciled.

### Current repository topology

Parent repository:

```text
root:   /Users/kiltyj/Code/viberoots-site
branch: codex/hermetic-builds
HEAD:   3bfffc7 chore: advance viberoots for hermetic Rust PR-3
```

The parent commit records submodule SHA `cb3609fa`, while the detached submodule is now at
`663027ac`. Do not try to make the parent pointer or `flake.lock` coherent yet. The local detached
submodule commits are not fetchable from GitHub until the user authorizes a push. A prior attempt to
run the canonical parent update advanced the submodule back to remote `main`; that incidental state
was caught and removed without committing it.

Current parent status:

```text
 M viberoots
?? test-tmp-paths.log
```

`test-tmp-paths.log` predates the current PR work. Preserve it and do not include it in a commit.

Submodule:

```text
root:   /Users/kiltyj/Code/viberoots-site/viberoots
state:  detached HEAD
HEAD:   663027ac30b239e3a414db3e0be789335d870939
```

The submodule has 32 staged PR-5 paths, 612 insertions, and 73 deletions. Six separate unstaged paths
belong to the Happy package correction and this handoff update:

```text
build-tools/docs/fresh-agent-handoff-20260723.md
build-tools/tools/nix/node-modules.hashes.json
build-tools/tools/tests/nix/devshell-tools-path.smoke.test.ts
docs/handbook/tooling.md
package.json
pnpm-lock.yaml
```

There are no untracked submodule paths. At reconciliation time:

```text
git diff --cached --binary | shasum -a 256
b448acdd43d54ab2b8496cd529d83e1617ecd86ca15f6e243bfbb9913c5dd556
```

Recompute this digest and inspect both staged and unstaged state before continuing. The digest is
evidence, not an instruction to overwrite later legitimate changes.

### Completed commits since the original handoff

The relevant detached submodule history is:

```text
663027ac chore(dev): add happy-coder CLI
f1d3d098 feat(build): add Rust patching and resilient cache policy
cb3609fa feat(build): complete hermetic Rust PR-3
68fc4748 feat(rust): complete native lifecycle contracts
bec23703 feat(rust): add locked native Cargo builds
```

`cb3609fa` completed PR-3, the Codex multi-account wrapper, and the Repo Skills marketplace and
subagent-isolation update described later in this document. The exact-state full checkpoint passed
in 10,684 seconds as recorded in section 8.

`f1d3d098` completed PR-4. It contains Rust dependency patching and vendoring, fixed-source
integrity, and the reviewed optional-cache policy. Entry points must tolerate
`cache.home.kilty.io` being unresolved because that cache exists only on the user's home network.
The implementation is hostname-neutral:

- optional cache policy is transported as a command-scoped capability;
- strict reviewed cache requirements remain fail closed;
- every canonical Node action re-reviews its action-local cache configuration;
- stage0 passes normalized effective substituter lists explicitly to nix-direnv, preventing daemon
  configuration from silently reintroducing optional private caches;
- missing, unreadable, or non-regular netrc files are omitted, while real curl configuration errors
  still fail closed.

Do not reintroduce hostname-specific exceptions, cache-off bypasses, or ambient daemon authority.
PR-4 passed its independent final scope review. Its post-review affected validation passed:

```text
47-selector complement:
  outer:
    .viberoots/workspace/buck/agent-test-logs/
    i-b-v-bounded-47-pr4-curl-risk-complement-20260724T085221-0700.log
  detailed:
    .viberoots/workspace/buck/verify-logs/
    verify-2026-07-24T15-54-03-777Z-49430-fb17d5160fd2.log
  result: 52/52 including enforcement

21-selector post-review gate:
  outer:
    .viberoots/workspace/buck/agent-test-logs/
    i-b-v-bounded-21-pr4-post-review-risk-gate-reconciled-20260724T092805-0700.log
  detailed:
    .viberoots/workspace/buck/verify-logs/
    verify-2026-07-24T16-29-37-792Z-28584-4f91cce55cc93.log
  result: 26/26 including enforcement
```

The user had already authorized this risk-based evidence after the recent full PR-3 checkpoint. Do
not rerun PR-4's full suite.

`663027ac` adds npm package `happy-coder@1.1.9` to the canonical consumer dev environment. It exposes
`happy` and `happy-mcp` through `.viberoots/current/node_modules/.bin` in any Viberoots consumer
devshell. The upstream package is deprecated in favor of `happy`; that is documented. The change
updates `package.json`, `pnpm-lock.yaml`, the fixed node-modules hash, a consumer-resolved static
smoke test, and `docs/handbook/tooling.md`. Focused validation and an independent review passed. Do
not invoke the upstream CLI merely to test `--version`; its behavior is not a reliable side-effect-
free identity probe.

After that commit, the user reported that `happy codex --yolo` did not work. Inspection proved that
`happy-coder@1.1.9` drops Codex `--yolo` in its dispatcher. The official rename was verified through
the deprecated package metadata, matching npm maintainers and publisher, matching repository and
homepage, the official repository instructions, npm integrity, and a tarball inspection. The
current unstaged follow-up replaces it with `happy@1.2.0`, whose Codex dispatcher maps `--yolo` to
permission mode `yolo`.

The rename has strong ownership-continuity evidence:

- `happy-coder@1.1.9` is deprecated with an explicit instruction to install `happy`;
- both npm packages list the same two maintainers, the same publisher, the same
  `slopus/happy` repository, and the same homepage;
- the official repository README now installs `happy` and explains that the old package was
  migrated after the package name was donated;
- npm supplied a registry signature and integrity digest for the 1.2.0 tarball;
- the downloaded tarball matched the registry identity;
- the package install hook only extracts already-bundled platform archives locally;
- all bundled archive entries were checked for absolute paths, `..` traversal, and links, with none
  found.

No provenance attestation was published at npm's attestation endpoint. That absence is not evidence
of malware, but do not claim a provenance-backed release. This was a bounded package-identity and
tarball review, not a formal source-to-binary security audit.

`pnpm audit` still reports repository-wide advisories. The Happy dependency paths reach the existing
locked `fast-uri@3.1.0` advisories through AJV/Fastify. The high MCP advisories reported by the audit
are for the repository's direct `@modelcontextprotocol/sdk@1.17.4`; Happy resolves 1.29.0. The
reported vulnerable `ws` paths are under Wrangler, not Happy. Do not misrepresent this rename review
as closing the repository's dependency-audit backlog.

Validation for the correction:

```text
canonical update:
  command: env -u NODE_PATH VBR_GC_MODE=off u
  exit: 0
  log:
    .viberoots/workspace/buck/agent-test-logs/
    happy-package-rename-update-20260724.log
  result:
    pnpm-store.viberoots hash updated and build succeeded

canonical install:
  command: env -u NODE_PATH VBR_GC_MODE=off i
  exit: 0
  log:
    .viberoots/workspace/buck/agent-test-logs/
    happy-package-rename-install-20260724.log

corrected dependency state:
  i: passed
  b: passed

final exact selector:
  command:
    env -u NODE_PATH VBR_GC_MODE=off v \
      viberoots//:nix_devshell_tools_path_smoke
  exit: 0
  elapsed: 60 seconds
  outer:
    .viberoots/workspace/buck/agent-test-logs/
    v-20260724-154957.log
  detailed:
    .viberoots/workspace/buck/verify-logs/
    verify-2026-07-24T20-50-13-962Z-99574-798b6a12cd28e.log
  project-enforcement: 5/5 passed
  shared: 1/1 passed
```

Two earlier exact-selector attempts found and fixed only smoke-probe defects: template-string
regular-expression cooking, then a missing `dist/` bundle path component. Production package
resolution was not weakened. Keep this six-file correction separate from the staged PR-5 index.
Before invoking `repo-skills:cc` for PR-5, resolve the Happy correction as its own coherent commit or
obtain explicit direction to combine it. The `cc` skill commits all local changes and must not sweep
this side change into PR-5 accidentally.

### Active work: PR-5

Continue `$repo-skills:prs` for PR-5 from:

```text
plan:   build-tools/docs/rust-language-plan.md
design: build-tools/docs/lang/rust-design.md
```

PR-5 is `Add Initial C Interop, WASM, Scaffolding, And Remote Proof`. It is a full-scope checkpoint.
The successful full-suite timing baseline is 10,684 seconds. Do not run the full suite until focused
validation and a fresh independent scope review pass.

The current staged implementation covers these areas:

- Rust `link_deps`, `header_deps`, direct/transitive link closure, closure overrides, native
  library inputs, and Cargo build-script link intent;
- public `rust_wasm_library` for `wasm32-unknown-unknown`;
- public `rust_wasi_binary` for `wasm32-wasip1`;
- Rust planner, Nix template, graph generator, and private build/test rule wiring;
- experimental Rust enablement in `langs.json` and its schema/validator;
- a source-owned Rust CLI scaffold, resolver entry, and generated template taxonomy;
- C interop, WASM/WASI artifact, scaffold-file, macro analysis, cquery, language validation, and
  remote-policy tests;
- Rust design, remote build setup, Nix gaps, Starlark API, and example documentation.

The exact 32 staged paths are the index entries in `git status --short` in the submodule. The six
Happy/handoff paths above must remain separate unstaged changes unless the next agent and user
explicitly choose their commit destination. Do not restage unrelated paths or flatten
staged/unstaged state.

Static gates passed before the last focused retry:

- ESLint;
- Prettier;
- strict file-size enforcement;
- Nix parse;
- template freshness;
- `validate-langs`;
- `git diff --check`;
- canonical `u` after stable inputs.

The first focused retry after those gates passed `i` and `b`, then verify preflight found that
`docs/handbook/starlark-api.md` lacked the two new public macro index entries. Those entries were
added, the static gates and canonical `u` passed again, and the staged diff was frozen.

The next exact retry was:

```text
env -u NODE_PATH VBR_GC_MODE=off i &&
env -u NODE_PATH VBR_GC_MODE=off b &&
env -u NODE_PATH VBR_GC_MODE=off v \
  viberoots//:rust_rust_c_interop_artifact \
  viberoots//:rust_rust_wasm_wasi_artifacts
```

Evidence:

```text
outer log:
  .viberoots/workspace/buck/agent-test-logs/
  pr5-rust-interop-wasi-index-fix-20260724T151134-0500.log
HEAD during run:
  663027ac30b239e3a414db3e0be789335d870939
staged digest during run:
  8a12559d25691a04d580a48ced10fcbd28daedbc
unstaged paths:
  zero
i:
  passed
b:
  passed
v:
  exit 2 in command-site policy preflight before test lanes
elapsed:
  120 seconds
```

The failure was shared policy metadata, not a Rust artifact test failure:

```text
expected count=536
expected digest=2f6542bbe8fdc549bb99e646eac2473ce7712498fc029ae32f5836828a93da2b
actual count=536
actual digest=b80b24d4489e92fab5369bae7e78f8c5e22aac3ab9f30962fdee60ca8e4cbae2
```

The count was unchanged. The digest change is consistent with edits to an existing Rust build
command assembly site. Just before the user paused, the staged policy file was updated so its
`expectedDigest` equals the reported actual digest
`b80b24d4489e92fab5369bae7e78f8c5e22aac3ab9f30962fdee60ca8e4cbae2`. The implementation agent was
interrupted before it reported the exact updater command or completed validation. Therefore:

1. inspect the classified command-site delta and confirm it is exactly the intended PR-5 Rust
   assembly change;
2. confirm the policy update came from the canonical inventory workflow, or rerun only that
   canonical updater if repository evidence requires it;
3. do not edit the digest by guesswork;
4. freeze the resulting staged digest;
5. rerun the same two focused selectors through an isolated tester with full output kept only in a
   log file.

After those selectors pass, complete the remaining pre-full-suite work:

1. Confirm the scaffold lifecycle and public-macro route drift coverage required by the PR-5 plan,
   not only the static scaffold-file test.
2. Run self-review and the smallest meaningful focused affected union.
3. Spawn a fresh isolated scope reviewer with `fork_turns="none"`. Give it only the repository path,
   PR-5 plan/design paths, and read-only scope-review contract. Do not provide the implementation
   reasoning or expected verdict.
4. Fix any material scope findings and repeat focused validation plus independent review.
5. Only after scope review passes, run the canonical full-scope
   `i && b && ALL_TESTS=1 v` checkpoint and the supported-system Rust matrix through the `test`
   skill. Keep verbose output file-only and report only phase transitions, summaries, exit code,
   elapsed time, and log paths.
6. Compare the completed run with the 10,684-second baseline. A regression is significant when it
   is both at least 25 percent slower and at least 120 seconds slower, unless current repo guidance
   is stricter.
7. Commit PR-5 through `repo-skills:cc` only after all required evidence passes. Do not push.

Validation reports must include the absolute outer log path, final process exit code, every
per-phase `Tests finished:` summary, and total elapsed seconds. A `Tests finished:` line is
phase-local and does not prove that the whole process exited.

### Workflow and agent-context requirements

Use the installed `repo-skills:prs` workflow. The marketplace/plugin bootstrap change is already in
`cb3609fa`; the user should not need a manual per-account plugin install after canonical bootstrap
and post-clone have run. If plugin discovery is missing in a fresh account, diagnose generated
marketplace state and the account's plugin cache rather than copying skills into the consumer.

Implementation, tester, reviewer, and assessment subagents must be isolated with
`fork_turns="none"`. Send only a minimal task-local packet. Never fork or summarize the complete
conversation into those agents. Keep full test output in log files; subagents should consume only
high-signal phase and failure summaries unless they are investigating a saved failure.

### Exact remaining PRs flow and Turbo contract

The active range is PR-5 through PR-12. Only PR-5 is open/in progress. PR-6 through PR-12 have not
started. Keep implementation sequential. Turbo Mode changes the validation breadth for a PR; it
does not authorize overlapping PR implementation.

For every remaining PR:

1. Start a fresh isolated implementation agent with only the repository path, exact PR number,
   plan/design paths, repo guidance, validation mode, and current timing baseline.
2. Implement, self-review, and run exact plus meaningful focused validation.
3. Run a fresh isolated read-only scope reviewer before any full suite or commit.
4. Fix material review findings, then repeat focused validation and scope review.
5. Run the PR's required Full or Turbo gate.
6. Commit through `repo-skills:cc` only after the gate passes. Never push without new explicit user
   authorization.
7. Record evidence, attempt ntfy without treating off-network failure as a PR failure, update the
   timing or integration-debt record, and only then start the next PR.

Full-scope PRs run `i && b && ALL_TESTS=1 v`, their required platform/external-evidence matrix, and
the timing-regression comparison. Turbo risk-based PRs use the last committed full checkpoint as
`GITHUB_BASE_REF`, then run formatting/lint, exact and previously failing selectors, a conservative
affected-target union, and independent scope review. Record the deferred full suite and remaining
assumptions in the integration debt ledger. Escalate a Turbo PR to full scope before commit if the
blast radius cannot be bounded or a cross-cutting failure appears.

| PR    | Mode             | Status and remaining work                                                                                                                                                                                     |
| ----- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PR-5  | Full scope       | In progress. Finish command-site review, C/WASM focused retry, scaffold lifecycle and route-drift evidence, affected union, scope review, full suite, Rust supported-system matrix, timing check, and commit. |
| PR-6  | Turbo risk-based | Not started. Add cross-root crate composition, complete crate/artifact kinds, proc macros, build scripts, host/target separation, focused union, review, and debt record.                                     |
| PR-7  | Turbo risk-based | Not started. Add Rust Python extensions and Node-API addons with conservative extension, packaging, loader, and negative-path validation.                                                                     |
| PR-8  | Turbo risk-based | Not started. Complete bidirectional C/C++ interop, generated bindings, ABI ownership, link closure, affected union, and review.                                                                               |
| PR-9  | Full scope       | Not started. Reach cross-language WASM linking, browser harness, and component-model parity, then run the next full checkpoint and timing comparison.                                                         |
| PR-10 | Turbo risk-based | Not started. Complete developer commands, dependency-source lifecycle, watchers, tooling, focused affected union, review, and debt record.                                                                    |
| PR-11 | Turbo risk-based | Not started. Add the cross-language Tauri desktop scaffold consuming Rust, C/C++, and WASM through reviewed boundaries; record deferred full evidence.                                                        |
| PR-12 | Full scope       | Not started. Close Rust/Tauri hermeticity, sandbox/network, publication, provenance, platform, independent-builder, and all deferred integration evidence.                                                    |

After PR-12, spawn separate isolated `assess-plan` and `assess-design` agents. They do not run
tests. If either finds implementation gaps, use `augment` to append the minimum follow-up PRs,
extend the active range, update the progress denominator, and continue. The `$prs` flow is complete
only when both assessments have no remaining implementation findings.

No remote push is authorized. The default ntfy endpoint may be unreachable off the home network;
notification failure is not a PR failure.

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
