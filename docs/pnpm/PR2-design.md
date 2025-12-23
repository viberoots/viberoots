# PR 2 — Node Provider Wiring and Auto-Map Integration Hardening

## Executive Summary

This PR hardens the Node provider system by adding comprehensive tests for determinism, verifying the auto-map integration, and documenting the importer-scoped labeling strategy. No code changes to the provider driver are expected; this is primarily a **verification and documentation** PR that proves the foundation is solid before adding real PNPM projects in PR 3.

## Scope

### In Scope

1. **Determinism tests** — Verify `TARGETS.node.auto` is byte-for-byte stable with fixed inputs
2. **Label-to-provider mapping tests** — Verify `gen-auto-map.ts` correctly maps `lockfile:` labels to Node providers
3. **Provider naming tests** — Verify the naming function produces consistent, collision-free provider names
4. **Edge case tests** — Cover peer dependencies, optional dependencies, empty importers, missing YAML package
5. **Documentation updates** — Clarify importer-scoped labels and provider naming in `pnpm-design.md`
6. **Orchestrator integration** — Verify `tools/buck/sync-providers.ts` can invoke Node provider sync via `--lang node`

### Out of Scope

- Real PNPM projects (PR 3)
- Hermetic Nix derivations (PR 4)
- Node macros (PR 5)
- Patch wrapper (PR 6)
- Scaffolding (PR 8)
- Any changes to the core provider driver logic (only tests and docs)

## Background

### Current State (PR 1 Complete)

✅ Workspace config exists (`pnpm-workspace.yaml`, `.npmrc` with `shared-workspace-lockfile=false`)  
✅ Provider rule defined (`third_party/providers/defs_node.bzl`)  
✅ Patch directory exists (`patches/node/`)  
✅ Provider sync driver implemented (`tools/buck/providers/node.ts`)  
✅ Unified orchestrator exists (`tools/buck/sync-providers.ts`)  
✅ One idempotency test exists (`sync-providers-node.idempotent.test.ts`)  
✅ Auto-map generator supports `lockfile:` labels (`tools/buck/gen-auto-map.ts`)

### What PR 2 Proves

- The provider naming is deterministic and collision-free
- The provider sync is truly idempotent (multiple tests, various scenarios)
- The auto-map correctly maps lockfile labels to Node providers
- The orchestrator can handle Node as a language
- The system gracefully handles edge cases (no lockfiles, missing yaml package, empty importers)
- The documentation clearly explains the importer-scoped strategy

## Design Principles (from METHODOLOGY.XML)

- **Files ≤ 250 lines** — Each test file contains one test
- **Deterministic operations** — Synchronous, predictable behavior
- **Self-explanatory code** — Clear naming, minimal comments
- **One test per file** — Follows repo convention
- **Incremental improvements** — Run full test suite after each change

## Detailed Design

### 1. Determinism Test Suite

#### 1.1 Basic Idempotency Test (Already Exists)

**File:** `tools/tests/scaffolding/sync-providers-node.idempotent.test.ts`  
**Status:** ✅ Exists, passing  
**Coverage:** Basic idempotency with no lockfiles

#### 1.2 Determinism with Synthetic Lockfile

**New File:** `tools/tests/scaffolding/sync-providers-node.determinism.test.ts`

**Purpose:** Verify byte-for-byte stability with a real pnpm-lock.yaml fixture

**Test Strategy:**

1. Create temp repo with synthetic `pnpm-lock.yaml`
2. Run `node tools/buck/sync-providers.ts --lang node --no-glue` twice
3. Assert byte-for-byte identical output
4. Hash the output to detect any changes

**Fixture Contents:**

```yaml
lockfileVersion: "9.0"

importers:
  apps/example:
    dependencies:
      lodash:
        specifier: ^4.17.21
        version: 4.17.21

packages:
  /lodash@4.17.21:
    resolution: { integrity: sha512-v2kDEe... }
    engines: { node: ">=4" }
```

**Acceptance:**

- Two runs produce identical output
- SHA256 hash matches expected value
- Test completes in <5s

#### 1.3 Determinism Across Multiple Importers

**New File:** `tools/tests/scaffolding/sync-providers-node.multi-importer.test.ts`

**Purpose:** Verify deterministic ordering when multiple importers exist

**Test Strategy:**

1. Create lockfile with 3 importers: `apps/web`, `apps/api`, `libs/utils`
2. Each importer has different dependencies
3. Run sync twice
4. Verify:
   - Provider entries are sorted consistently
   - Each importer gets its own provider
   - No cross-contamination of patches

**Acceptance:**

- 3 provider entries created, sorted by provider name
- Byte-for-byte identical on second run
- Each provider lists correct lockfile path and importer

#### 1.4 Empty Importer Handling

**New File:** `tools/tests/scaffolding/sync-providers-node.empty-importer.test.ts`

**Purpose:** Verify graceful handling of importers with no dependencies

**Test Strategy:**

1. Create lockfile with importer that has empty `dependencies: {}`
2. Run sync
3. Verify provider is created with empty patch list

**Acceptance:**

- Provider rule created even for empty importer
- No errors or warnings
- Idempotent on rerun

#### 1.5 Missing YAML Package Graceful Degradation

**New File:** `tools/tests/scaffolding/sync-providers-node.no-yaml-package.test.ts`

**Purpose:** Verify graceful skip when `yaml` package is unavailable

**Test Strategy:**

1. Create temp environment where `require('yaml')` fails
2. Run sync
3. Verify it writes empty header and exits gracefully

**Implementation Note:**

```typescript
// Mock the yaml import to throw
const mod = await import("node:module");
const originalResolve = mod.createRequire(import.meta.url).resolve;
// ... mock to throw for 'yaml'
```

**Acceptance:**

- No crash or error
- Empty TARGETS.node.auto created with header
- Exit code 0

### 2. Provider Naming Tests

#### 2.1 Provider Name Consistency

**New File:** `tools/tests/lib/providers.lockfile-importer-naming.test.ts`

**Purpose:** Verify `providerNameForImporter` produces consistent names

**Test Strategy:**

1. Call `providerNameForImporter(lockfilePath, importer)` with various inputs
2. Verify naming pattern: `lf_<hash>_<sanitized_suffix>`
3. Verify case-insensitivity
4. Verify hash stability

**Test Cases:**

```typescript
const cases = [
  { lf: "apps/web/pnpm-lock.yaml", imp: "apps/web", expectPrefix: "lf_" },
  { lf: "libs/utils/pnpm-lock.yaml", imp: "libs/utils", expectPrefix: "lf_" },
  { lf: "pnpm-lock.yaml", imp: ".", expectPrefix: "lf_" },
];
```

**Acceptance:**

- All provider names start with `lf_`
- Hash is 12 characters
- Suffix sanitizes special characters to underscores
- Same input always produces same output

#### 2.2 Provider Name Collision Detection

**New File:** `tools/tests/lib/providers.lockfile-collision-detection.test.ts`

**Purpose:** Verify the system detects provider name collisions

**Test Strategy:**

1. Create scenario where hash collision might occur (very unlikely, but test the guard)
2. Verify sync throws with clear error message

**Note:** This is more of a regression guard; real collisions are astronomically unlikely with 12-char SHA256 prefix.

**Acceptance:**

- Error message includes both colliding keys
- Error message includes provider name
- Exit code non-zero

### 3. Auto-Map Integration Tests

#### 3.1 Label-to-Provider Mapping

**New File:** `tools/tests/scaffolding/auto-map.node-provider-mapping.test.ts`

**Purpose:** Verify `gen-auto-map.ts` correctly maps `lockfile:` labels to provider deps

**Test Strategy:**

1. Create synthetic `graph.json` with targets having `lockfile:` labels
2. Create matching `TARGETS.node.auto` provider entries
3. Run `gen-auto-map.ts`
4. Parse output `auto_map.bzl`
5. Verify each target maps to correct provider

**Graph Fixture:**

```json
[
  {
    "name": "//apps/web:bundle",
    "rule_type": "genrule",
    "labels": ["lockfile:apps/web/pnpm-lock.yaml#apps/web", "lang:node", "kind:bundle"]
  },
  {
    "name": "//apps/api:server",
    "rule_type": "genrule",
    "labels": ["lockfile:apps/api/pnpm-lock.yaml#apps/api", "lang:node", "kind:bin"]
  }
]
```

**Acceptance:**

- `MODULE_PROVIDERS` dict contains entries for both targets
- Each entry maps to exactly one provider (the matching importer)
- Provider labels are fully qualified (`//third_party/providers:lf_...`)
- Output is deterministic (run twice, identical)

#### 3.2 Multi-Label Handling

**New File:** `tools/tests/scaffolding/auto-map.node-multi-label.test.ts`

**Purpose:** Verify targets with multiple labels get correct subset of providers

**Test Strategy:**

1. Create target with both `module:` and `lockfile:` labels (future: Go + Node hybrid)
2. Verify auto-map includes both provider types
3. Verify Node provider is included alongside others

**Acceptance:**

- Target maps to multiple providers
- Node provider present when `lockfile:` label exists
- No duplicate provider entries

#### 3.3 No Label, No Provider

**New File:** `tools/tests/scaffolding/auto-map.node-no-label-skip.test.ts`

**Purpose:** Verify targets without `lockfile:` labels don't get Node providers

**Test Strategy:**

1. Create graph with targets that have no `lockfile:` labels
2. Run auto-map generation
3. Verify those targets don't appear in `MODULE_PROVIDERS` or have empty arrays

**Acceptance:**

- Targets without labels omitted or have empty provider lists
- No spurious Node providers added

### 4. Orchestrator Integration

#### 4.1 Language Flag Support

**New File:** `tools/tests/scaffolding/sync-providers.lang-node.test.ts`

**Purpose:** Verify `tools/buck/sync-providers.ts` can sync Node providers via `--lang node`

**Test Strategy:**

1. Run `node tools/buck/sync-providers.ts --lang node`
2. Verify only `TARGETS.node.auto` is created/updated
3. Verify other language provider files are unchanged

**Acceptance:**

- `--lang node` flag works without errors
- Only Node providers are synced
- Output is deterministic

**Note:** Check if orchestrator exists and supports `--lang` flag; if not, document as future enhancement.

#### 4.2 All-Languages Sync Includes Node

**New File:** `tools/tests/scaffolding/sync-providers.all-includes-node.test.ts`

**Purpose:** Verify syncing all providers includes Node

**Test Strategy:**

1. Run `node tools/buck/sync-providers.ts` (no lang flag)
2. Verify `TARGETS.node.auto` is created alongside Go/C++ providers

**Acceptance:**

- Node providers included in all-language sync
- No errors when Node has no lockfiles

### 5. Edge Case Tests

#### 5.1 Peer Dependencies Traversal

**New File:** `tools/tests/scaffolding/sync-providers-node.peer-deps.test.ts`

**Purpose:** Verify peer dependencies are correctly included in effective set

**Test Strategy:**

1. Create lockfile with package that declares peer dependencies
2. Include resolved peer dependencies in lockfile
3. Verify effective set includes transitive peers

**Fixture:**

```yaml
importers:
  apps/example:
    dependencies:
      react-dom: 18.0.0

packages:
  /react-dom@18.0.0:
    peerDependencies:
      react: ^18.0.0
    dependencies:
      react: 18.0.0

  /react@18.0.0:
    resolution: { integrity: sha512-... }
```

**Acceptance:**

- Effective set includes both react-dom and react
- Peer resolution logic handles the dependency correctly

#### 5.2 Optional Dependencies Included

**New File:** `tools/tests/scaffolding/sync-providers-node.optional-deps.test.ts`

**Purpose:** Verify optional dependencies are included in effective set

**Test Strategy:**

1. Create lockfile with optional dependencies
2. Verify they appear in effective set

**Acceptance:**

- Optional deps included
- No errors when optional deps missing from packages section

#### 5.3 Scoped Package Handling

**New File:** `tools/tests/scaffolding/sync-providers-node.scoped-packages.test.ts`

**Purpose:** Verify `@scope/package` names are handled correctly

**Test Strategy:**

1. Create lockfile with `@babel/core`, `@types/node`, etc.
2. Verify package key parsing handles scoped names
3. Verify patch matching works with encoding (`@babel__core@7.0.0.patch`)

**Acceptance:**

- Scoped packages parsed correctly
- Effective set includes scoped packages
- Provider naming handles scopes

### 6. Documentation Updates

#### 6.1 Update `pnpm-design.md`

**Section to Add:** "Provider Naming and Labeling"

**Content:**

````markdown
### Provider Naming and Labeling

#### Importer-Scoped Labels

Each Node target must include a label identifying its lockfile and importer:

```python
labels = ["lockfile:apps/web/pnpm-lock.yaml#apps/web"]
```
````

**Label Format:** `lockfile:<relative-path-to-lockfile>#<importer-id>`

- `<relative-path-to-lockfile>`: Path from repo root to `pnpm-lock.yaml`
- `<importer-id>`: The importer key from the lockfile's `importers` section

**Examples:**

| Target              | Lockfile Path               | Importer ID  | Label                                           |
| ------------------- | --------------------------- | ------------ | ----------------------------------------------- |
| `//apps/web:bundle` | `apps/web/pnpm-lock.yaml`   | `apps/web`   | `lockfile:apps/web/pnpm-lock.yaml#apps/web`     |
| `//libs/utils:lib`  | `libs/utils/pnpm-lock.yaml` | `libs/utils` | `lockfile:libs/utils/pnpm-lock.yaml#libs/utils` |
| `//apps/api:test`   | `apps/api/pnpm-lock.yaml`   | `apps/api`   | `lockfile:apps/api/pnpm-lock.yaml#apps/api`     |

#### Provider Naming Convention

Provider names are generated by `providerNameForImporter(lockfilePath, importer)`:

**Format:** `lf_<hash>_<suffix>`

- `<hash>`: 12-character SHA256 prefix of `${lockfilePath}#${importer}`
- `<suffix>`: Sanitized combination of importer and lockfile path (special chars → `_`)

**Example:**

```typescript
providerNameForImporter("apps/web/pnpm-lock.yaml", "apps/web");
// => "lf_a1b2c3d4e5f6_apps_web__apps_web_pnpm_lock_yaml"
```

**Properties:**

- ✅ Deterministic (same input always produces same output)
- ✅ Collision-resistant (12-char hash from SHA256)
- ✅ Case-insensitive (lockfile paths and importers normalized to lowercase)
- ✅ Fully qualified (`//third_party/providers:<name>`)

#### Effective Set Calculation

The provider includes patches for all packages in the importer's **effective set**:

1. **Direct dependencies** (from `importers.<id>.dependencies`)
2. **Optional dependencies** (from `importers.<id>.optionalDependencies`)
3. **Peer dependencies** (from `importers.<id>.peerDependencies` if resolved)
4. **Transitive dependencies** (depth-first traversal of all deps)
5. **Peer resolution edges** (if package declares peer and resolves it)

**Traversal Algorithm:**

```typescript
// Pseudocode
function effectiveSet(importer):
  roots = importer.dependencies + importer.optionalDependencies + resolved_peers
  visited = {}
  queue = roots
  while queue not empty:
    pkg = queue.pop()
    if pkg in visited: continue
    visited.add(pkg)
    for dep in pkg.dependencies:
      queue.push(dep)
    for peer in pkg.peerDependencies:
      if resolved in pkg.dependencies:
        queue.push(resolved)
  return visited
```

**Result:** Only patches matching packages in the effective set are included in the provider.

#### Why Importer-Scoped?

Importer-scoped providers enable **precise invalidation**:

| Change                                   | Invalidates                    | Does NOT Invalidate                   |
| ---------------------------------------- | ------------------------------ | ------------------------------------- |
| Edit `apps/web/pnpm-lock.yaml`           | `//apps/web:*` targets         | `//apps/api:*`, `//libs/utils:*`      |
| Patch `lodash@4.17.21` used by web only  | `//apps/web:*` targets         | Other importers                       |
| Patch `react@18.0.0` used by web and api | `//apps/web:*`, `//apps/api:*` | `//libs/utils:*` (if not using React) |

**Contrast with Shared Lockfile:**

If we used a single workspace lockfile, ANY change would invalidate ALL Node targets (coarse invalidation). Per-importer lockfiles + importer-scoped providers = **fine-grained Buck2 invalidation**.

````

#### 6.2 Add Testing Section

**Section to Add:** "Testing Provider Determinism"

**Content:**
```markdown
### Testing Provider Determinism

The Node provider system has comprehensive tests ensuring deterministic behavior:

#### Test Categories

1. **Idempotency** — Running sync twice with same inputs produces identical output
2. **Determinism** — Provider names and ordering are consistent across runs
3. **Edge Cases** — Empty importers, peer deps, optional deps, scoped packages
4. **Integration** — Auto-map correctly maps lockfile labels to providers
5. **Graceful Degradation** — Missing yaml package, no lockfiles

#### Running Tests

```bash
# Run all Node provider tests
buck2 test //tools/tests/... --filter sync-providers-node
buck2 test //tools/tests/... --filter auto-map.node

# Run with coverage
buck2 test //... -- --env COVERAGE=1
````

#### Adding New Tests

Follow the one-test-per-file convention:

```typescript
#!/usr/bin/env zx-wrapper
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("node provider: <specific behavior>", async () => {
  await runInTemp("test-name", async (tmp, $) => {
    // Setup fixture
    // Run provider sync
    // Assert expected output
  });
});
```

**File naming:** `tools/tests/scaffolding/sync-providers-node.<behavior>.test.ts`

````

#### 6.3 Update `getting-started-on-a-pr.md`

**Section to Update:** "3. Commands cheat sheet"

**Add Node-specific commands:**
```markdown
- Node provider operations:
  - Sync Node providers only (no graph/auto_map): `node tools/buck/sync-providers.ts --lang node --no-glue`
  - Sync specific language: `node tools/buck/sync-providers.ts --lang node`
  - Generate auto-map: `node tools/buck/gen-auto-map.ts --graph tools/buck/graph.json --out third_party/providers/auto_map.bzl`
````

## Implementation Plan

### Phase 1 — Provider Naming Tests (30 min)

**Files to Create:**

1. `tools/tests/lib/providers.lockfile-importer-naming.test.ts`
2. `tools/tests/lib/providers.lockfile-collision-detection.test.ts`

**Verification:**

```bash
buck2 test //tools/tests/lib:providers.lockfile-importer-naming.test
buck2 test //tools/tests/lib:providers.lockfile-collision-detection.test
```

**Acceptance:**

- Both tests pass
- Provider names follow expected pattern
- Collision detection logic works (even if collisions are unlikely)

### Phase 2 — Determinism Tests (1 hour)

**Files to Create:**

1. `tools/tests/scaffolding/sync-providers-node.determinism.test.ts`
2. `tools/tests/scaffolding/sync-providers-node.multi-importer.test.ts`
3. `tools/tests/scaffolding/sync-providers-node.empty-importer.test.ts`
4. `tools/tests/scaffolding/sync-providers-node.no-yaml-package.test.ts`

**Verification:**

```bash
buck2 test //tools/tests/scaffolding:sync-providers-node.determinism.test
buck2 test //tools/tests/scaffolding:sync-providers-node.multi-importer.test
buck2 test //tools/tests/scaffolding:sync-providers-node.empty-importer.test
buck2 test //tools/tests/scaffolding:sync-providers-node.no-yaml-package.test
```

**Acceptance:**

- All tests pass
- Determinism proven with real fixtures
- Edge cases handled gracefully

### Phase 3 — Auto-Map Integration Tests (45 min)

**Files to Create:**

1. `tools/tests/scaffolding/auto-map.node-provider-mapping.test.ts`
2. `tools/tests/scaffolding/auto-map.node-multi-label.test.ts`
3. `tools/tests/scaffolding/auto-map.node-no-label-skip.test.ts`

**Verification:**

```bash
buck2 test //tools/tests/scaffolding:auto-map.node-provider-mapping.test
buck2 test //tools/tests/scaffolding:auto-map.node-multi-label.test
buck2 test //tools/tests/scaffolding:auto-map.node-no-label-skip.test
```

**Acceptance:**

- Auto-map correctly maps lockfile labels
- Multi-language targets work correctly
- Targets without labels are handled appropriately

### Phase 4 — Edge Case Tests (1 hour)

**Files to Create:**

1. `tools/tests/scaffolding/sync-providers-node.peer-deps.test.ts`
2. `tools/tests/scaffolding/sync-providers-node.optional-deps.test.ts`
3. `tools/tests/scaffolding/sync-providers-node.scoped-packages.test.ts`

**Verification:**

```bash
buck2 test //tools/tests/scaffolding:sync-providers-node.peer-deps.test
buck2 test //tools/tests/scaffolding:sync-providers-node.optional-deps.test
buck2 test //tools/tests/scaffolding:sync-providers-node.scoped-packages.test
```

**Acceptance:**

- Peer dependency traversal works correctly
- Optional dependencies included
- Scoped package names handled

### Phase 5 — Orchestrator Integration Tests (30 min)

**Files to Create:**

1. `tools/tests/scaffolding/sync-providers.lang-node.test.ts`
2. `tools/tests/scaffolding/sync-providers.all-includes-node.test.ts`

**Verification:**

```bash
buck2 test //tools/tests/scaffolding:sync-providers.lang-node.test
buck2 test //tools/tests/scaffolding:sync-providers.all-includes-node.test
```

**Acceptance:**

- `--lang node` flag works
- All-language sync includes Node
- No interference with other language providers

### Phase 6 — Documentation (45 min)

**Files to Update:**

1. `pnpm-design.md` — Add provider naming and labeling section
2. `pnpm-design.md` — Add testing section
3. `getting-started-on-a-pr.md` — Add Node commands

**Verification:**

- Read through docs for clarity
- Verify code examples are accurate
- Cross-check with implementation

**Acceptance:**

- Documentation is clear and comprehensive
- Examples are copy-pasteable
- Links to relevant handbook sections

### Phase 7 — Full Test Suite Verification (10 min)

**Commands:**

```bash
# Run all tests with coverage
buck2 test //... -- --env COVERAGE=1

# Check coverage report
pnpm coverage:open
```

**Acceptance:**

- All 177+ tests pass (now with ~10 new Node tests)
- No regressions in existing tests
- Coverage report shows Node provider code is tested
- Test run completes in <5 minutes

### Phase 8 — Commit and PR (15 min)

**Commit Message:**

```
test(node): add comprehensive provider determinism and wiring tests

- Add 10 focused tests for Node provider system:
  - Provider naming consistency and collision detection
  - Determinism with synthetic lockfiles and multiple importers
  - Auto-map integration with lockfile labels
  - Edge cases: peer deps, optional deps, scoped packages, empty importers
  - Orchestrator --lang flag support
  - Graceful degradation without yaml package

- Update pnpm-design.md with provider naming and labeling documentation
- Update getting-started-on-a-pr.md with Node-specific commands

All tests follow one-test-per-file convention and complete with external timeouts.
Full test suite passes (187 tests, ~5 minutes).

Refs: pnpm-plan.md PR 2 acceptance criteria
```

## Test File Template

Each new test should follow this structure:

```typescript
#!/usr/bin/env zx-wrapper
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";
import * as fsp from "node:fs/promises";
import path from "node:path";

test("<descriptive test name>", async () => {
  await runInTemp("<unique-test-id>", async (tmp, $) => {
    // 1. Setup: Create fixtures (lockfiles, patches, graph.json)
    const lockfilePath = path.join(tmp, "apps/example/pnpm-lock.yaml");
    const lockfileContent = `
lockfileVersion: '9.0'

importers:
  apps/example:
    dependencies:
      lodash:
        specifier: ^4.17.21
        version: 4.17.21

packages:
  /lodash@4.17.21:
    resolution: {integrity: sha512-v2kDEe57D2ZWi2...}
    engines: {node: '>=4'}
`.trim();
    await fsp.mkdir(path.dirname(lockfilePath), { recursive: true });
    await fsp.writeFile(lockfilePath, lockfileContent, "utf8");

    // 2. Execute: Run the provider sync
    await $`node tools/buck/sync-providers.ts --lang node --no-glue`;

    // 3. Assert: Verify expected output
    const outPath = path.join(tmp, "third_party/providers/TARGETS.node.auto");
    const output = await fsp.readFile(outPath, "utf8");

    if (!output.includes("node_importer_deps")) {
      console.error("Expected provider rule in output");
      process.exit(2);
    }

    // 4. Verify idempotency
    await $`node tools/buck/sync-providers.ts --lang node --no-glue`;
    const output2 = await fsp.readFile(outPath, "utf8");

    if (output !== output2) {
      console.error("Output changed on second run (not idempotent)");
      process.exit(2);
    }
  });
});
```

## Acceptance Criteria (from pnpm-plan.md)

### ✅ Must Pass

1. **Idempotent provider sync test passes locally and in CI**
   - All 10+ new tests pass without flakes
   - External timeouts work correctly
   - Tests complete in <40s each

2. **`gen-auto-map.ts` includes Node providers when `lockfile:` labels exist in `graph.json`**
   - Auto-map integration tests verify this
   - Both single and multi-label scenarios covered

3. **Documentation updates merged**
   - Provider naming section added to `pnpm-design.md`
   - Testing section added to `pnpm-design.md`
   - Commands added to `getting-started-on-a-pr.md`

4. **Full test suite passes**
   - All 187+ tests pass (177 existing + ~10 new)
   - No regressions
   - Coverage report shows Node provider code tested

5. **No process leaks**
   - After all tests: `ps aux | grep -E "node|pnpm" | grep -v grep | wc -l` returns 4 (baseline)
   - No runaway processes after commits

## Risks and Mitigations

### Risk: Lockfile Parsing Nuances

**Description:** pnpm lockfile format may have edge cases we haven't covered

**Mitigation:**

- Test with multiple lockfile versions
- Test scoped packages, peer deps, optional deps
- Add fixtures from real-world lockfiles in future PRs
- YAML parsing is already battle-tested (using `yaml` package)

**Likelihood:** Low  
**Impact:** Medium  
**Action:** Add more fixtures over time as we encounter edge cases

### Risk: Peer Resolution Traversal Regressions

**Description:** Peer dependency resolution logic might miss transitive peers

**Mitigation:**

- Dedicated test for peer dependency traversal
- Verify with complex peer dependency graphs
- Cross-reference with pnpm's own resolution logic

**Likelihood:** Low  
**Impact:** Medium  
**Action:** Add test with nested peer dependencies

### Risk: Provider Name Collisions

**Description:** Hash collisions could theoretically occur

**Mitigation:**

- 12-character SHA256 prefix = 2^48 space (281 trillion combinations)
- Collision detection throws clear error
- Test verifies collision detection works

**Likelihood:** Astronomically Low  
**Impact:** High (if it happens)  
**Action:** Test includes collision detection logic

### Risk: Test Flakes

**Description:** Tests might be non-deterministic or timing-sensitive

**Mitigation:**

- All file operations are synchronous where possible
- External timeouts prevent hangs
- runInTemp isolates each test
- No shared state between tests

**Likelihood:** Low  
**Impact:** Medium  
**Action:** Run tests multiple times in CI to verify stability

## Success Metrics

1. **Test Coverage**
   - 10+ focused tests added
   - All aspects of Node provider system tested
   - Coverage report shows >90% line coverage for Node provider code

2. **Documentation Quality**
   - Provider naming clearly explained
   - Examples are copy-pasteable
   - Troubleshooting section helps debug issues

3. **Stability**
   - All tests pass consistently
   - No flakes in 10 consecutive CI runs
   - No process leaks after full test suite

4. **Developer Confidence**
   - PR 3 (first PNPM project) can proceed with confidence
   - Foundation proven solid through tests
   - Clear documentation reduces onboarding friction

## Follow-Up PRs

This PR enables:

- **PR 3** — Scaffold first PNPM project with confidence in provider wiring
- **PR 4** — Hermetic Nix derivations (lockfile → derivation proven stable)
- **PR 5** — Node macros (label-to-provider mapping proven correct)
- **PR 6** — Patch wrapper (provider sync integration proven)

## References

- [pnpm-plan.md](./pnpm-plan.md) — Original PR plan
- [pnpm-design.md](./pnpm-design.md) — Overall PNPM design
- [build-system-design.md](../../build-system-design.md) — Provider strategy
- [METHODOLOGY.XML](../../METHODOLOGY.XML) — Development methodology
- [PR1-COMPLETE.md](./PR1-COMPLETE.md) — PR 1 completion status

## Appendix: Test Fixtures

### Synthetic Lockfile (Basic)

```yaml
lockfileVersion: "9.0"

importers:
  apps/example:
    dependencies:
      lodash:
        specifier: ^4.17.21
        version: 4.17.21

packages:
  /lodash@4.17.21:
    resolution: { integrity: sha512-v2kDEe57D2ZWi2unGLLb0b... }
    engines: { node: ">=4" }
```

### Synthetic Lockfile (Multi-Importer)

```yaml
lockfileVersion: "9.0"

importers:
  apps/web:
    dependencies:
      react: 18.0.0
      lodash: 4.17.21

  apps/api:
    dependencies:
      express: 4.18.0

  libs/utils:
    dependencies:
      lodash: 4.17.21

packages:
  /react@18.0.0:
    resolution: { integrity: sha512-... }
  /lodash@4.17.21:
    resolution: { integrity: sha512-... }
  /express@4.18.0:
    resolution: { integrity: sha512-... }
```

### Synthetic Lockfile (Peer Dependencies)

```yaml
lockfileVersion: "9.0"

importers:
  apps/example:
    dependencies:
      react-dom: 18.0.0

packages:
  /react-dom@18.0.0:
    resolution: { integrity: sha512-... }
    peerDependencies:
      react: ^18.0.0
    dependencies:
      react: 18.0.0

  /react@18.0.0:
    resolution: { integrity: sha512-... }
```

### Synthetic Graph JSON (Node Labels)

```json
[
  {
    "name": "//apps/web:bundle",
    "rule_type": "genrule",
    "labels": ["lockfile:apps/web/pnpm-lock.yaml#apps/web", "lang:node", "kind:bundle"],
    "srcs": ["src/index.ts"],
    "deps": []
  },
  {
    "name": "//apps/api:server",
    "rule_type": "genrule",
    "labels": ["lockfile:apps/api/pnpm-lock.yaml#apps/api", "lang:node", "kind:bin"],
    "srcs": ["src/main.ts"],
    "deps": []
  },
  {
    "name": "//libs/utils:lib",
    "rule_type": "genrule",
    "labels": ["lockfile:libs/utils/pnpm-lock.yaml#libs/utils", "lang:node", "kind:lib"],
    "srcs": ["src/index.ts"],
    "deps": []
  }
]
```

## Estimated Effort

- **Phase 1 (Naming Tests):** 30 minutes
- **Phase 2 (Determinism Tests):** 1 hour
- **Phase 3 (Auto-Map Tests):** 45 minutes
- **Phase 4 (Edge Case Tests):** 1 hour
- **Phase 5 (Orchestrator Tests):** 30 minutes
- **Phase 6 (Documentation):** 45 minutes
- **Phase 7 (Verification):** 10 minutes
- **Phase 8 (Commit & PR):** 15 minutes

**Total: ~5 hours** (for an experienced developer or LLM agent)

## Definition of Done

- [ ] 10+ focused tests written and passing
- [ ] All tests follow one-test-per-file convention
- [ ] Tests use external timeouts (40s per test)
- [ ] Full test suite passes (187+ tests)
- [ ] No process leaks after full test run
- [ ] Documentation updated in pnpm-design.md
- [ ] Commands added to getting-started-on-a-pr.md
- [ ] Coverage report shows Node provider code tested
- [ ] Committed with Conventional Commits message
- [ ] All files ≤250 lines
- [ ] Self-explanatory code (minimal comments)
- [ ] Ready for PR 3 (first PNPM project scaffold)
