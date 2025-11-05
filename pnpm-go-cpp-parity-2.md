## PNPM–Go–C++ Parity (PR-Next)

> Purpose: Close remaining gaps between PNPM (Node), Go, and C++ patching/invalidation while preserving our design principles (Buck2 as orchestrator; Nix as hermetic builder; patch UX via zx; idempotent glue; cross‑platform parity).

### Context (Current State)

- Go
  - Patch UX complete (start/apply/reset/session/remove) with strict apply verification.
  - Buck invalidation is precise: `go/defs.bzl` includes local `patches/go/*.patch` in `srcs`, so Buck re-evaluates impacted targets when a patch changes.
  - Provider mapping available but gated behind provider index (optional), keeping correctness via srcs inclusion regardless.
- C++
  - Patch UX complete with strict verification and nixpkgs resolution.
  - Providers are stamp targets whose inputs include overlays, patch files, and lockfile; Buck invalidates when any input changes.
- PNPM (Node)
  - Patch UX complete using native `pnpm patch`/`patch-commit` (per‑importer patches under `apps/*`/`libs/*`).
  - Providers are importer‑scoped stamps (lockfile + importer identity). However, provider genrules intentionally avoid referencing lockfiles/patch paths as srcs due to Buck package boundary constraints in `third_party/providers/`.
  - Consequence: Node patch changes may not propagate precise Buck invalidation signals to dependent targets.

### Goals

- Precise Buck invalidation for Node patch file changes that matches Go and C++ behavior.
- Maintain our path invariants and flat patch directory requirements per language.
- Keep Nix hermeticity and CI behavior unchanged; no vendoring.
- Preserve idempotent glue generation and minimal, readable macros.

### Non‑Goals

- Changing PNPM to a different package manager or altering lockfile semantics.
- Introducing cross‑package src references in `third_party/providers/` (disallowed by Buck package boundaries).
- Replacing existing Go/C++ strategies that are already correct.

## Design Overview

### 1) Node patch invalidation via importer‑local srcs (macro‑level)

- Problem: Provider stamps in `third_party/providers/` cannot include importer‑local patch files as `srcs` (they live outside the provider package), so changing a patch file does not directly invalidate consumer targets.
- Approach: Mirror Go’s strategy at the target site. In `node/defs.bzl`, resolve the importer directory from the lockfile label (already enforced by macros), and include importer‑local `patches/node/*.patch` in the consumer target’s `srcs`.
- Effect: Any change to `apps/<imp>/patches/node/*.patch` becomes an input to the Node target’s Buck rule key, matching Go’s precision and C++’s stamp‑based behavior.

Implementation sketch (illustrative; actual edits will follow repo style and helpers):

- In `nix_node_gen(...)`:
  - Parse/importer from `lockfile_label` (already validated).
  - Compute `patch_dir = importer + "/patches/node"`.
  - Merge `native.glob(["%s/*.patch" % patch_dir])` into `kwargs["srcs"]` (deduped), similar to Go macro behavior.

Notes:

- Works with importer at repo root (".") — handle the path normalization case.
- Keeps provider stamps metadata‑only; no cross‑package srcs required.
- Matches idempotent, minimal macro philosophy; no change to Nix plan is required for correctness.

### 2) Optional: Enable Go provider‑based mapping across the board

- Today, Go invalidation correctness does not depend on provider mapping because local patch files are included in `srcs`. For feature parity with Node/C++ mapping visibility, we can make glue emit the provider index JSON before `gen-auto-map` so `module:` labels are translated into provider labels consistently.
- Change: In glue, invoke `tools/buck/gen-provider-index.ts` (or `sync-providers.ts --emit-index`) prior to running `gen-auto-map.ts`.
- Impact: No change to correctness; improves visibility and consistency of provider wiring for diagnostics.

### 3) Optional: Clarify Node provider sync semantics

- `sync-providers-node` currently collects a list of potentially used patch filenames and passes them as `patch_paths` to the provider macro. The macro intentionally ignores these paths as srcs to avoid cross‑package references.
- Action: Update docstrings to clarify that `patch_paths` are purely informational, not Buck inputs, and keep the implementation as-is. This avoids confusion without changing behavior.

## Alternatives Considered

- Include importer‑local patch files as provider `srcs` in `third_party/providers/defs_node.bzl`.
  - Rejected: Buck packages cannot safely reference files outside their package; this would violate package boundaries and introduce brittle path coupling.
- Route all invalidation through Nix only.
  - Rejected: Our philosophy uses Buck for fine‑grained invalidation; Nix remains the hermetic builder. Node patch invalidation belongs in Buck to scope impacted tests precisely.

## Impact & Risks

- Build graph impact: Node targets will gain additional `srcs` edges to importer‑local patch files; this matches Go’s pattern and is limited in scope.
- Risk: Mis‑derived importer directories could cause missing patch srcs.
  - Mitigation: We already validate that exactly one `lockfile:<path>#<importer>` label is present. Derive importer from that label only.
- Risk: Spurious rebuilds if we accidentally include non‑patch files.
  - Mitigation: Strict glob on `*.patch` in `patches/node/`.

## Migration Plan

- Backwards‑compatible: Existing Node targets continue to work; newly added `srcs` edges only improve invalidation accuracy.
- No CI pipeline changes required beyond glue enhancement (if enabling Go provider index emission).
- Documentation updates will guide developers; no workflow changes to `patch-pkg` commands.

## Development Plan (Phased)

### Phase 1 — Node macro invalidation parity

- Edit `node/defs.bzl`:
  - Derive `importer` from `lockfile_label` (already enforced).
  - Compute `patch_dir = importer + "/patches/node"` (normalize `"."` to repo root).
  - Merge `native.glob(["%s/*.patch" % patch_dir])` into `srcs` within `nix_node_gen`.
- Add tests:
  - E2E provider wiring (Node):
    - Given a Node target labeled with `lockfile:<path>#<importer>`, touching a patch file under that importer’s `patches/node/` should change the target’s deps or rule key minimally (use an approach analogous to existing provider wiring/e2e checks).
  - No‑op patch append should be reversible and not break builds; verify idempotency.
- Acceptance:
  - Changing `apps/<imp>/patches/node/<pkg>@<ver>.patch` triggers an invalidation of only the Node targets bound to `<importer>`.

### Phase 2 — Glue: Go provider index emission (optional but recommended)

- Update `tools/patch/glue.ts`:
  - After `sync-providers.ts`, invoke `gen-provider-index.ts` (or `sync-providers.ts --emit-index`) to produce `third_party/providers/provider_index.{bzl,json}`.
  - Keep order: export graph → sync providers → provider index → gen auto map.
- Add tests:
  - Confirm `module:` labels translate into `//third_party/providers:mod_*` entries when the index is present, and that `auto_map.bzl` contains the expected provider targets for Go.
- Acceptance:
  - `provider_index.json` emitted by glue; `gen-auto-map` maps `module:` labels for Go when present.

### Phase 3 — Documentation and guardrails

- Update handbook/design notes:
  - Clarify that Node invalidation is achieved via importer‑local patch srcs in Node macros (analogous to Go).
  - Clarify that Node provider `patch_paths` are informational; not used as Buck inputs.
- Optional: Extend prebuild guard messaging to hint when importer‑local patch dirs exist but no lockfile label is present on Node targets.
- Acceptance:
  - Documentation merged; prebuild guard (if updated) remains fast and non‑noisy by default.

## Testing Strategy

- Unit‑like zx tests (consistent with existing suite):
  - Node macro srcs inclusion test:
    - Create a minimal importer with `pnpm-lock.yaml` and a Node target labeled with `lockfile:<path>#<importer>`.
    - Place a dummy patch under `apps/<imp>/patches/node/`. Verify via `buck2 cquery` that the Node target’s deps include the synthesized auto providers and that changing the patch file results in invalidation (rule key or deps change) limited to mapped targets.
  - E2E parity check:
    - For one Go target, one C++ target, and one Node target, modify an unrelated patch and assert no change in deps for the Node target; modify a related patch and assert a change.
- Idempotency checks:
  - Re‑running glue without changes results in no diffs.
  - Re‑applying the same patch content results in no diffs (Node/Go/C++).

## Completion Criteria

- Node invalidation parity:
  - Node targets properly invalidate when importer‑local patch files change, scoped to the importer, with no cross‑package src references.
- Optional visibility parity:
  - Glue emits Go provider index; `auto_map.bzl` includes Go module providers when present.
- Tests:
  - New Node invalidation tests pass locally and in CI; existing suites remain green.
- Docs:
  - Design/handbook sections updated; troubleshooting added for Node patch invalidation.

## Alignment With Project Principles

- Buck2 continues to drive what to rebuild/test; Nix ensures how to build.
- Patch UX remains ergonomic and idempotent; dev overrides remain local‑only and forbidden in CI.
- Cross‑platform: No platform‑specific behavior added; path normalization handled in macros.
- Minimalism: No new rule types or extra provider complexity; small macro enhancement mirrors the existing Go approach.

---

If you’d like, I can implement Phase 1 immediately and provide the targeted tests in the `tools/tests/scaffolding` and `tools/tests/e2e` areas consistent with our conventions.
