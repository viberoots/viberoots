### PNPM–Go–C++ Parity Plan

This document proposes targeted, minimal changes to close practical gaps between PNPM/Node, Go, and C++ while staying aligned with our build-system philosophy in `build-tools/docs/build-system-design.md`: Buck2 as the orchestrator, Nix as the hermetic executor (dynamic derivations), and ergonomic, idempotent patching.

The plan focuses on outcomes (precise invalidation, deterministic behavior, and clear UX) rather than making all ecosystems identical. Where mechanisms differ, we preserve the stronger/cleaner approach and adapt the others to match outcomes.

---

### Principles (restated, scoped)

- Buck2 computes what to rebuild/test; Nix defines how to build.
- Patches live outside Nix in flat dirs under `patches/<lang>`; providers derive mechanically from filenames or lockfiles.
- Glue generation (export graph → sync providers → auto map) is plain Node zx and not committed; CI enforces freshness.
- Keep cross-language UX consistent via `patch-pkg` while respecting each ecosystem’s best primitives.

---

### Current state (short)

- PNPM/Node
  - Importer-scoped providers based on `pnpm-lock.yaml` and effective dependency sets; precise invalidation of only impacted Node targets.
  - Patch UX leverages native `pnpm patch / patch-commit / patch-remove` and regenerates glue.
  - Prebuild guard verifies importer coverage and auto-fixes locally.

- C++
  - Providers are keyed by `nixpkg:` labels; overlay and patch inputs stamped; deterministic mapping `nix_attr_map.bzl` emitted.

- Go
  - Exporter is authoritative for module labels (diagnostics), Nix handles patches via overrides.
  - Intentional change: auto-map currently ignores `module:` labels (no per-module provider mapping); precise invalidation may rely on Nix evaluation and/or per-target inclusion of local patch files.

---

### Goals

- Restore precise, Buck-visible invalidation for Go patches, matching the precision of PNPM/Node and C++ (targets that use the patched module get invalidated; unrelated targets do not).
- Keep PNPM/Node’s importer-scoped model as-is (it’s already strong and ergonomic).
- Maintain C++’s nixpkgs model and its mapping/stamps.
- Unify patch UX affordances where sensible (add "remove" for Go/C++).

Out of scope: Changing Node to per-package providers or reverting Go to heavy provider mapping everywhere. We add exactly the minimal signal needed to re-enable precise invalidation for the subset of Go modules that have patches.

---

### Design: Precise Buck invalidation for Go patches (srcs‑driven)

Update (PR‑3): We do not generate Go providers. Go remains srcs‑driven: package‑local `patches/go/*.patch` are included in target `srcs`, and Buck invalidates precisely based on those inputs. Auto‑mapping remains Node `lockfile:` and C++ `nixpkg:` only.

- Provider generation (Go):
  - Not used. No Go providers are emitted; Go patching does not rely on provider mapping.

- Provider index (machine-readable):
  - Extend the existing provider index generator to also emit a JSON sidecar with a minimal map (fully qualified provider label → origin key). This allows mapping logic to know which module providers actually exist, avoiding dangling deps.

- Auto-map logic:
  - Update mapping to include `module:` → provider only if that module appears in the provider index (i.e., a patch exists). This restores precise invalidation for patched modules and keeps unpatched modules unmapped.

- Prebuild guard:
  - No Go‑specific provider/index requirements. Guard behavior remains for Node (importers) and C++ (nixpkg) only.

Result: Only targets that carry a `module:<path>@<ver>` label referencing a patched module gain a provider dependency. Unrelated Go targets stay untouched.

---

### Optional: Node exporter adapter (symmetry only)

Node is already robust via macros and guardrails. If desired, add a tiny exporter adapter to stamp `lockfile:<path>#<importer>` labels authoritatively. This is a symmetry-only enhancement and can be deferred.

---

### Patch UX parity

- Add `patch-pkg remove go <module>`: delete the canonical patch file (if present) and regenerate glue.
- Add `patch-pkg remove cpp <nixpkgs-attr>`: delete the canonical C++ patch file(s) for that attr and regenerate glue.
- Keep Node’s native `patch-remove` behavior.

This produces consistent day-2 ergonomics across languages.

---

### Implementation Plan (ordered, low risk)

Phase 1 — No Go provider generation (policy alignment)

1. Orchestrator wiring
   - Leave Go out of provider sync. Node and C++ behavior unchanged.

2. Mapping logic
   - Do not map `module:` labels to providers. Keep existing Node `lockfile:` and C++ `nixpkg:` handling unchanged.

3. Prebuild guard
   - No Go‑specific provider/index requirements. CI guard continues to enforce freshness for Node/C++ glue only.

4. Tests
   - Ensure Go builds/tests succeed without any global Go provider artifacts and that patch edits under package‑local `patches/go/` precisely invalidate affected targets.

Acceptance for Phase 1:

- Go targets remain srcs‑driven; changing a Go patch invalidates only impacted targets.
- No regressions in Node/C++ behaviors.

Phase 2 — Patch UX parity (“remove” for Go/C++)

1. `patch-pkg remove go <module>`
   - Derive canonical patch filename from `<module>@<exact-version>` by scanning existing patches.
   - Delete the file and run glue regeneration (sync providers → auto-map).
   - Idempotent: removing a non-existent patch is a no-op with success message.

2. `patch-pkg remove cpp <nixpkgs-attr>`
   - Support removal of C++ patch files with the encoded attr prefix; then glue regeneration.

3. Tests
   - Add behavioral tests ensuring removal updates provider autos and auto-map deterministically.

Acceptance for Phase 2:

- Remove flows are consistent across Node/Go/C++; glue regenerates automatically; builds are stable.

Phase 3 — Optional Node exporter adapter

1. Add a tiny adapter that stamps `lockfile:<path>#<importer>` labels in the exporter.
2. Keep macros as the enforcement mechanism and prebuild guard as the safety net.
3. Tests validate labels are present and consistent.

Acceptance for Phase 3:

- Exporter and macro-stamped labels agree; no behavioral change in provider mapping.

---

### System impacts and consistency with design

- Buck2 remains the orchestrator; we only restore a minimal Go signal so Buck sees patch-related dependencies precisely where patches exist.
- Nix remains the execution engine; we do not introduce non-hermetic paths or implicit IO.
- Patching UX remains single-entry (`patch-pkg`) across languages; Node continues to use first-class pnpm patch facilities.
- Glue is still generated by Node zx scripts (no Nix-run wrappers), and CI enforces freshness via the prebuild guard.

---

### Risks and mitigations

- Mapping module labels for Go must not create dangling provider deps when no patch exists.
  - Mitigation: gate module mapping on provider index JSON presence; add guard checks and tests.

- Provider index parsing must be deterministic and cheap.
  - Mitigation: generate a simple JSON index alongside the BZL file; load-once per run.

- Over-invalidation for Go if we bind all Go targets to global patch inputs.
  - Mitigation: we explicitly avoid a global stamp; we only map providers for modules with patches and only onto targets that use them (via labels + index gating).

---

### Verification checklist

- With a Go patch present, only dependent Go targets (and tests) rebuild.
- With a Node patch, only importer-bound Node targets rebuild (no change).
- With a C++ patch, `nixpkg:`-bound targets rebuild (no change), stamps and mapping emitted.
- Prebuild guard fails CI when glue is missing or stale; local auto-fix succeeds and is idempotent.
- Parity UX: `patch-pkg remove` works for Node/Go/C++.

---

### Next steps (incremental)

1. Implement Phase 1 and land tests.
2. Implement Phase 2 (remove parity) and land tests.
3. Decide whether to do Phase 3 (Node exporter adapter) now or later.
4. Update handbook snippets to reflect Go’s gated module-provider mapping and the new remove flows.
