## Quad Alignment Plan — Cross-Language Parity Tightening (CPP / Go / PNPM / Python) — Part 3

This plan captures small, behavior-preserving refinements following our parity pass. Each PR includes its own targeted tests and documentation updates within the same change. Goals: unify patch workspace behavior, simplify developer UX around override snippets, and reduce minor duplication in Go Nix templates — all with zero diffs to artifacts and mappings for unchanged inputs.

## PR‑1: Patch workspace parity and macOS CoW optimization

### Description

Align temporary workspace paths across languages. Behavior for C++ extraction remains unchanged; Go/Python adopt a per‑language tmp prefix to match C++’s clarity.

### Scope & Changes

- tools/patch/cross-platform.ts:
  - Change `makeWorkspace(originPath, moduleKey)` → `makeWorkspace({ lang, originPath, moduleKey })`.
  - Workspace base moves from a fixed `bucknix-patch-go` to `bucknix-patch-<lang>`.
- tools/patch/patch-go.ts, tools/patch/patch-python.ts:
  - Pass `lang: "go"` / `lang: "python"` to `makeWorkspace(...)`.
- C++ path (already uses `bucknix-patch-cpp` and bespoke extraction):
  - No functional change. Keep existing `ensureOriginAndWorkspace` logic; new parity is achieved by aligning Go/Python naming with C++.
- Tests (in this PR):
  - zx tests assert workspace directory name prefixes are `bucknix-patch-go`, `bucknix-patch-python`, `bucknix-patch-cpp` respectively.
- Docs (in this PR):
  - Update build-tools/docs/build-system-design.md (patching workflow) to note per‑language workspace prefixes and APFS CoW attempt on macOS.

### Acceptance Criteria

- Patch sessions for Go/Python create workspaces under `.../bucknix-patch-<lang>/...` with identical content and permissions to today.
- No change in derivations, provider mappings, or labels for unchanged inputs.

### Risks

Low. Changes are isolated to tmp workspace creation and naming; fallbacks preserve current behavior.

### Consequence of Not Implementing

Minor naming inconsistency across languages.

### Downsides for Implementing

Small churn in two patch handlers and the shared workspace helper.

### Recommendation

Implement.

## PR‑2: Global echo‑snippet knob and unified message formatting

### Description

Add a global `PATCH_ECHO_SNIPPET=1` toggle to request “echo export snippet” mode across all languages and centralize the snippet message text to avoid per‑language drift. Preserve existing per‑language env toggles and `--echo-snippet` flag.

### Scope & Changes

- tools/lib/cli.ts:
  - Extend `echoSnippetRequested({ env? })` to also honor `PATCH_ECHO_SNIPPET=1|true` (global), while keeping per‑language envs (`PATCH_GO_ECHO_SNIPPET`, `PATCH_CPP_ECHO_SNIPPET`, `PATCH_PY_ECHO_SNIPPET`) and `--echo-snippet` precedence.
- tools/patch/dev-overrides.ts:
  - Add `printOverrideSnippet(envName, map)` to format and print a consistent message using `formatExportSnippet(...)`, including the standard “Unset before CI …” hint.
- tools/patch/patch-go.ts, tools/patch/patch-cpp.ts, tools/patch/patch-python.ts:
  - Replace inline echo blocks with `printOverrideSnippet(...)`. Default behavior (process‑local env mutation) remains unchanged when echo not requested.
- Tests (in this PR):
  - zx tests confirm: `--echo-snippet` and `PATCH_ECHO_SNIPPET=1` both cause snippet printing for Go/C++/Python; output message matches the unified format exactly.
- Docs (in this PR):
  - Update build-tools/docs/build-system-design.md (patching UX) to mention the global echo toggle and the standard snippet text.

### Acceptance Criteria

- Echo mode behavior is identical across languages via either `--echo-snippet` or the new `PATCH_ECHO_SNIPPET` env.
- Default paths (without echo) are unchanged; derivations, labels, and mappings do not change on unchanged inputs.
- All existing patching zx tests remain green; new echo-parity tests pass.

### Risks

Very low. Output text becomes unified; tests in this PR will pin formatting to prevent future drift.

### Consequence of Not Implementing

Duplicated message text across handlers and slightly inconsistent UX for toggling echo mode.

### Downsides for Implementing

Minimal refactor in three patch handlers.

### Recommendation

Implement.

## PR‑3: Go Nix templates — extract tiny shared helpers (no behavior change)

### Description

Move small, repeated functions from the Go template to a shared location to reduce duplication while preserving outputs exactly. Targets: `mkOverrides` and `mkConfigurePhase` used by `goApp`/`goLib`.

### Scope & Changes

- tools/nix/templates-common.nix (or extend if already present):
  - Add shared helpers for `mkOverrides` (composition of `patches` + `src` overrides) and `mkConfigurePhase` (CGO/env set‑up with current semantics and flags).
- tools/nix/templates/go.nix:
  - Import helpers from templates-common; remove in‑file duplicates; keep all arguments, env logic, and CGO composition identical.
- Tests (in this PR):
  - Nix derivation identity/regression checks: build representative Go bin/lib before/after and assert either identical store paths (when practical) or identical computed args/overrides in a snapshot test.
  - Existing zx tests for Go CGO wiring and patch maps remain green.
- Docs (in this PR):
  - Short comments where the helpers are imported to clarify intent and preserve discoverability.

### Acceptance Criteria

- No diffs in Go build outputs for unchanged inputs (including CGO and patch/override behavior).
- Helper factoring reduces duplication; template readability improves.

### Risks

Low‑moderate. Small chance of signature drift if helpers are not wired exactly; guarded by derivation/snapshot tests in this PR.

### Consequence of Not Implementing

Continued duplication in `go.nix`, slightly higher maintenance surface.

### Downsides for Implementing

Small refactor and copy of logic into a shared module.

### Recommendation

Implement.

## PR‑4: Patch CLI common helpers consolidation (args + messages)

### Description

Merge small duplicated code paths across patch handlers by centralizing positional argument validation and standardized “no‑op” messages. Preserve current UX and exact output strings; this is a pure cleanup to reduce drift risk.

### Scope & Changes

- tools/patch/lib/args.ts (new):
  - `requirePositional(args: string[], index: number, { name, example }): string` — returns trimmed positional or throws with a standardized, per‑handler message that matches today’s wording.
- tools/patch/lib/messages.ts (new):
  - `NOOP_CLEARED_MSG = "no changes; no-op (cleared dev overrides and ended session)"` — shared constant matching the current printed text.
- tools/patch/patch-go.ts, tools/patch/patch-python.ts, tools/patch/patch-cpp.ts, tools/patch/patch-node.ts:
  - Replace inline first‑arg extraction and duplicated no‑op strings with calls to the new helpers/constants.
  - Keep language‑specific wording for “missing argument” identical to today by passing current examples (`golang.org/x/net`, `pkgs.zlib`, `requests`, `lodash`) to `requirePositional(...)`.
- Tests (in this PR):
  - zx snapshot/line‑match tests assert identical stdout/stderr for the relevant code paths:
    - “missing argument” errors for each handler
    - “no changes; no‑op …” message for Go/Python where applicable
  - Coverage: start/apply/reset happy paths remain unchanged.
- Docs (in this PR):
  - Inline code comments describe the shared helpers; no separate docs section required.

### Acceptance Criteria

- No diffs in handler output for identical inputs and operations (byte‑for‑byte on messages).
- All existing patching tests remain green; new helper tests pass.

### Risks

Very low. Message text remains identical by design; only the call sites change.

### Consequence of Not Implementing

Ongoing small duplication in argument handling and no‑op messaging across handlers.

### Downsides for Implementing

Minimal refactor in four handlers.

### Recommendation

Implement.

## Rollout & Sequencing

1. PR‑1 (Workspace parity + macOS CoW): isolated to local patching; unblocks no other item.
2. PR‑2 (Global echo‑snippet + unified text): independent; small changes across handlers.
3. PR‑3 (Go template helper extraction): independent; safest after CI verifies PR‑1/PR‑2 green.
4. PR‑4 (Patch CLI helpers consolidation): independent; small code‑only unification after PR‑2.

All PRs are independently reversible.

## Verification & Backout Strategy

- PR‑1:
  - Run patch start/apply for Go, Python, C++; assert workspace prefix naming and CoW attempt on darwin; ensure no diffs in build/test results on unchanged inputs.
  - Backout: restore prior `makeWorkspace` signature and Go/Python callers.
- PR‑2:
  - Exercise `--echo-snippet` and `PATCH_ECHO_SNIPPET=1`; confirm unified snippet is printed; ensure default behavior (no echo) unchanged.
  - Backout: revert helper call sites and the global toggle check; keep per‑lang envs.
- PR‑3:
  - Build representative Go targets; verify no diffs (or identical derivation args snapshots). Keep CGO and overrides behavior identical.
  - Backout: inline helpers into `go.nix` again.
- PR‑4:
  - Re‑run patch handler tests to ensure identical output text; verify zx snapshot/line‑match tests pass.
  - Backout: revert handler call sites to local arg parsing and string literals.

## Summary of Expected Impact

- Clear, per‑language tmp workspace naming across Go/Python (aligned with C++), with faster local copies on macOS where APFS CoW is available.
- Unified echo‑snippet toggle and consistent messaging reduce UX friction and remove duplicated strings.
  -.Less duplication in Go Nix templates, improving readability without changing outputs.
  -.Zero functional changes to build artifacts, provider mappings, or labels for unchanged inputs; all parity remains intact.
