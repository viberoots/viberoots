### Title

Patching strictly inside uv2nix

### Goals

- Centralize and standardize Python distribution patching inside uv2nix.
- Preserve purity and offline builds: all inputs (lockfile, patches, origins) are store paths.
- Enable cache-friendly, reusable “wheelhouse” keyed by lockfile + patches.
- Provide deterministic ordering, consistent normalization, and clear provenance (BUILD-INFO).

### Non‑Goals

- Moving adapter/template logic into uv2nix beyond passing structured inputs.
- Allowing ambient filesystem access or network at build time.
- Supporting ad‑hoc, out‑of-store patch files.

### Inputs

- uv.lock: the dependency lockfile tracked in VC (importer-relative path).
- origins (optional): per-dist origin overrides resolved to store paths (e.g., vendor snapshots).
- patchesMap: attrset keyed by "name@version" → array of patch store paths.
  - Key form: lowercased PEP503-normalized name + "@" + normalized version (e.g., mydep@1.0.0).
  - Values: store paths to patch files (text), not workspace paths.

### Patch format and normalization

- Supported formats (deterministic):
  - Unified diff with headers: lines beginning with "--- a/<path>" and "+++ b/<path>".
  - Minimal unified hunks with "@@" lacking explicit ranges: normalized to "@@ -1,999 +1,999 @@" for patch(1).
- Normalization pipeline:
  - Trim CRLF to LF during ingestion.
  - If headers are missing or malformed, fail fast with a clear error.
  - Enforce that "<path>" targets are within the staged site root after distribution layout (reject path traversal).

### Ordering

- Apply patches in deterministic order:
  - Sort by key (dist@version), then lexicographic sort of patch filenames (store paths’ basenames).
  - Multiple patches for the same target file apply in lexicographic order; reapplication (duplicates) is a hard error.

### Build phases (inside uv2nix)

- fetch phase: realize all origins from store paths computed from uv.lock and overrides; no network.
- stage phase: lay out distributions into a writable staging directory (site-staging/).
- patch phase: apply patches in deterministic order to site-staging/, using patch(1) with normalization above.
- install phase: copy site-staging/ into $out/site (read-only store), set executable/wrapper as needed.

### Cache keys and reuse

- Wheelhouse derivation hash includes:
  - uv.lock content (or normalized projection of the locked subset actually used).
  - patchesMap content (concatenated patch file contents and order in a canonical manifest).
  - normalized origins mapping (as store paths), and uv2nix algorithm version.
- Result: a stable, reusable store path per lockfile+patches across importers (apps/libs).

### Provenance (BUILD-INFO)

- Emit at $out/BUILD-INFO.json:
  - backend: "uv2nix"
  - uv2nix: { version, rev }
  - lockfile path (relative), groups (if applicable)
  - patches: array of { key: "dist@version", file: "<basename>", sha256: "<content-hash>" } in the final applied order

### Failure modes (graceful and explicit)

- Parse/format errors: patch rejected with a clear message showing offending header/hunk line numbers.
- Target resolution errors: when "<path>" escapes or does not exist in site-staging/, fail with the resolved path.
- Context mismatch: with strict mode (default), fail if hunks cannot apply; in lenient mode (opt‑in), attempt best‑effort application using deterministic text‑replacement fallback (see Safety).
- Resource cleanup: ensure staging directories are removed, and partial outputs are not installed.

### Safety and guardrails

- Path safety: ensure patches only modify files under site-staging/ (no upward traversal).
- No fallbacks: if a patch fails to parse or apply, the build fails immediately with actionable diagnostics.

### Adapter and template contracts

- Adapters and templates remain thin:
  - Compute patchesMap (by scanning importer-local patches/python) and pass it to uv2nix.
  - Do not apply patches post-hoc; rely on uv2nix output entirely.
- Origins for “vendor” are provided as store paths; adapters/templates may build these via builtins.path around workspace fixtures at evaluation time.

### Adoption plan (direct enablement)

1. Implement patching pipeline in uv2nix (stage → patch → install) with normalization, ordering, and provenance.
2. Delete adapter-side patching; adapters pass patchesMap and store-backed origins only.
3. Tests:
   - Deterministic order test: ensure lexicographic file order yields expected result.
   - E2E “patch affects execution”: verify runtime behavior changes post-patch.
   - Offline: build with --offline; assert no fetches during patch/install phases.
   - Provenance: assert BUILD-INFO contains uv2nix rev and patch list with hashes and order.
4. CI:
   - Strict mode on; fail on any non-conforming patch format.
   - Optionally preload wheelhouse to binary cache keyed by lockfile+patches.

### Testing matrix

- Platforms: aarch64-darwin, aarch64-linux, x86_64-linux.
- Patch variants:
  - Proper unified diff with headers
  - Minimal “@@ …” hunks normalized to acceptable ranges
  - Intentional malformed patch (should fail with actionable error)
- Repro checks: re-running with unchanged inputs yields identical store paths and identical BUILD-INFO.

### Open questions

- Do we allow multi-file patches in one file? Proposal: yes, as long as all targets resolve inside site-staging/; order within file is preserved.
- Binary patching support: default off; proposal is to reject by default and later add explicit opt‑in with checksums.
- Partial patch application policy: proposal is all‑or‑nothing per patch file (if any hunk fails in strict mode, reject the entire patch file).

### Rollout

- Enable uv2nix patching as the sole path. No transitional fallbacks or feature flags.

### Summary

Move all patching into uv2nix with a deterministic, cache-friendly, and auditable pipeline: store-backed inputs, normalized unified diffs, stable ordering, and clear provenance. Keep adapters/templates declarative and thin, and enforce strict mode in CI to guarantee reproducibility and offline correctness.

### PR sequence (end-to-end implementation)

## PR‑1: Introduce uv2nix patching pipeline (default path)

### Description

Add a first-class patching pipeline inside uv2nix to apply importer-provided patches deterministically during the build. This becomes the default path immediately.

### Scope & Changes

- Implement internal phases: stage → patch → install on top of store-backed origins.
- Normalization: CRLF→LF, minimal “@@” hunks expanded, safe path enforcement under site root.
- Deterministic ordering: by key (dist@version), then patch filename.
- Emit BUILD-INFO with backend/version/rev and minimal patch names list.

### Acceptance Criteria

- With no patches, outputs identical to pre-change builds.
- With patches, expected diffs applied in the final site.
- Unit tests for normalization, ordering, path safety; integration test for a minimal patched site.

### Risks

- Moderate: new logic in uv2nix could surface corner cases in patch formats.

### Consequence of Not Implementing

- Patching remains fragmented in adapters, reducing reuse and determinism.

### Downsides for Implementing

- Increased uv2nix surface area and maintenance.

### Recommendation

Implement as default; land early to iterate safely.

## PR‑2: Adapters pass patchesMap/origins as store paths to uv2nix (no adapter-side patching)

### Description

Make adapters/templates thin: compute patchesMap and store-backed origins, then delegate patching entirely to uv2nix.

### Scope & Changes

- Scan importer-local patches/python to assemble patchesMap keyed by dist@version.
- Convert importer-relative origins to store paths at eval time (builtins.path); no host FS reads.

### Acceptance Criteria

- Offline builds succeed (lib overlay smoke; app e2e) using uv2nix patching exclusively.
- BUILD-INFO contains uv2nix version/rev.

### Risks

- Low: behavior moves from adapter to uv2nix.

### Consequence of Not Implementing

- Duplicate patching logic persists at the edges; policy can drift.

### Downsides for Implementing

- Small adapter changes; tighter coupling to uv2nix inputs.

### Recommendation

Implement; no adapter fallback retained.

## PR‑3: Wheelhouse derivation keyed by lockfile + patches (reuse and hydration)

### Description

Expose a reusable wheelhouse per importer that is content-addressed by lockfile + canonical patches manifest.

### Scope & Changes

- Add per-importer `py-wheelhouse-*` outputs to flake exposing `$out/site`.
- Key on normalized lockfile and canonical manifest (patch content hashes + order).

### Acceptance Criteria

- Two importers with same lock/patch set yield identical store paths (reuse).
- Hydration plus `--offline` builds succeed with zero network.

### Risks

- Low to moderate: if canonicalization drifts, cache churn increases.

### Consequence of Not Implementing

- Missed reuse opportunities; slower CI/dev builds.

### Downsides for Implementing

- Additional flake attrs; minor eval overhead for manifest hashing.

### Recommendation

Implement; measure reuse in CI to validate gains.

## PR‑4: Provenance hardening and strict failure modes

### Description

Strengthen provenance and enforce strict failure semantics in CI.

### Scope & Changes

- BUILD-INFO: include patches array with { key, file, sha256 } in final applied order.
- CI strict mode: clear errors on parse/target/context failures.

### Acceptance Criteria

- Negative tests (malformed headers, path traversal, context mismatch) fail with actionable errors.
- Strict behavior across environments (no lenient modes).

### Risks

- Moderate: stricter checks may reveal pre-existing patch issues in some repos.

### Consequence of Not Implementing

- Silent drift and harder debugging of patch-related failures.

### Downsides for Implementing

- Slight initial friction fixing non-conforming patches.

### Recommendation

Implement; default strict in CI, allow local opt-in leniency.

## PR‑5: Remove adapter patch fallback and enable uv2nix patching by default

### Description

Finalize the migration by removing adapter patching and enabling uv2nix as the default patch path.

### Scope & Changes

- Delete adapter patch application paths and any toggles.

### Acceptance Criteria

- Full suite green with default settings; no adapter patching remains.

### Risks

- Low to moderate: undiscovered edge cases could surface after fallback removal.

### Consequence of Not Implementing

- Residual duplicate code and potential divergence.

### Downsides for Implementing

- None material once PR‑1..4 are green.

### Recommendation

Implement after prior PRs are stable in CI.

## PR‑6: Cache/stability refinements and edge‑case normalization

### Description

Polish canonicalization and handle advanced edge cases for maximum stability.

### Scope & Changes

- Multi-file patch files ordering guarantees; robust canonical manifest generation.
- Guard binary patches (reject by default); document future opt-in policy.

### Acceptance Criteria

- Rebuilds reproduce identical store paths and BUILD-INFO across runs.
- Edge variants (header quirks, minimal hunks) handled per documented rules.

### Risks

- Low: incremental refinements on top of working logic.

### Consequence of Not Implementing

- Occasional cache churn; rare edge-case flakiness.

### Downsides for Implementing

- Slightly more code for normalization; more tests.

### Recommendation

Implement; lock in stable behavior before broad reuse.

## PR‑7: CI preload integration and ergonomics

### Description

Publish wheelhouse artifacts in CI and document local hydration for fast, offline builds.

### Scope & Changes

- CI job: realize wheelhouse (lock+patch keyed) and push to binary cache.
- Developer docs: `nix copy` hydration steps; measure offline build timing baseline.

### Acceptance Criteria

- Preload artifacts are available; local `--offline` builds run without fetches post-hydration.

### Risks

- Low: CI pipeline wiring and binary cache availability.

### Consequence of Not Implementing

- Slower cold builds and repeated fetch costs.

### Downsides for Implementing

- Slight CI time increase; storage usage for cache artifacts.

### Recommendation

Implement; validate with timing improvements and adoption.
