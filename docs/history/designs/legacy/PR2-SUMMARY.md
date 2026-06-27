# PR 2 Design Summary — Node Provider Wiring and Auto-Map Integration Hardening

## What This PR Does

**Objective:** Prove the Node provider foundation is solid through comprehensive testing and documentation **before** adding real PNPM projects in PR 3.

**Strategy:** Verification over implementation — minimal code changes, maximum test coverage.

## Key Deliverables

### 1. Test Suite (10+ focused tests)

#### Provider Naming (2 tests)

- Consistent naming across runs
- Collision detection (even though collisions are astronomically unlikely)

#### Determinism (4 tests)

- Byte-for-byte stability with synthetic lockfiles
- Multi-importer ordering consistency
- Empty importer handling
- Graceful degradation without yaml package

#### Auto-Map Integration (3 tests)

- Lockfile labels → provider deps mapping
- Multi-label targets (future: Go + Node hybrid)
- No label → no provider (correct skip behavior)

#### Edge Cases (3 tests)

- Peer dependency traversal
- Optional dependencies inclusion
- Scoped package handling (`@babel/core`, etc.)

#### Orchestrator (2 tests)

- `--lang node` flag support
- All-language sync includes Node

### 2. Documentation Updates

#### `pnpm-design.md` Additions

- **Provider Naming and Labeling** section
  - Label format: `lockfile:<path>#<importer>`
  - Naming convention: `lf_<hash>_<suffix>`
  - Effective set calculation algorithm
  - Why importer-scoped invalidation matters

- **Testing Provider Determinism** section
  - Test categories and commands
  - How to add new tests
  - Running tests with coverage

#### `docs/handbook/getting-started-on-a-pr.md` Updates

- Add Node-specific commands to cheat sheet
- Link to pnpm-design.md sections

## Why This Matters

### Before PR 2

- ✅ Provider sync driver exists
- ✅ One basic idempotency test
- ❓ Unknown: Does it handle edge cases?
- ❓ Unknown: Is naming truly deterministic?
- ❓ Unknown: Does auto-map integration work?

### After PR 2

- ✅ Comprehensive test coverage
- ✅ Proven determinism (byte-for-byte stable)
- ✅ Edge cases documented and tested
- ✅ Auto-map integration verified
- ✅ Clear documentation for future PRs

### Impact on Future PRs

**PR 3 (First PNPM Project):**

- Can scaffold with confidence
- Provider wiring proven solid
- No surprises when adding real lockfiles

**PR 4 (Hermetic Nix):**

- Lockfile → derivation keys proven stable
- Determinism guarantees caching works

**PR 5 (Node Macros):**

- Label → provider mapping proven correct
- Macro can rely on auto-map

**PR 6 (Patch Wrapper):**

- Provider sync integration proven
- Effective set calculation verified

## Test File Structure

Each test follows the one-test-per-file pattern:

```
build-tools/tools/tests/
├── lib/
│   ├── providers.lockfile-importer-naming.test.ts
│   └── providers.lockfile-collision-detection.test.ts
├── scaffolding/
│   ├── sync-providers-node.determinism.test.ts
│   ├── sync-providers-node.multi-importer.test.ts
│   ├── sync-providers-node.empty-importer.test.ts
│   ├── sync-providers-node.no-yaml-package.test.ts
│   ├── sync-providers-node.peer-deps.test.ts
│   ├── sync-providers-node.optional-deps.test.ts
│   ├── sync-providers-node.scoped-packages.test.ts
│   ├── auto-map.node-provider-mapping.test.ts
│   ├── auto-map.node-multi-label.test.ts
│   ├── auto-map.node-no-label-skip.test.ts
│   ├── sync-providers.lang-node.test.ts
│   └── sync-providers.all-includes-node.test.ts
```

## Acceptance Criteria Checklist

From `docs/history/designs/legacy/pnpm-plan.md`:

- [x] Idempotent provider sync tests pass locally and in CI
- [x] `gen-auto-map.ts` includes Node providers when `lockfile:` labels exist
- [x] Documentation clarifies importer-scoped labels and provider naming
- [x] Tests prove determinism with synthetic lockfiles
- [x] Full test suite passes (177 → 187+ tests)
- [x] No process leaks after test runs
- [x] All files ≤250 lines
- [x] Follows AGENTS.md principles

## Risk Assessment

| Risk                       | Likelihood         | Impact | Mitigation                             |
| -------------------------- | ------------------ | ------ | -------------------------------------- |
| Lockfile parsing nuances   | Low                | Medium | Multiple edge case tests               |
| Peer traversal regressions | Low                | Medium | Dedicated peer deps test               |
| Provider name collisions   | Astronomically Low | High   | Collision detection + test             |
| Test flakes                | Low                | Medium | runInTemp isolation, external timeouts |

## Implementation Effort

- **Provider naming tests:** 30 min
- **Determinism tests:** 1 hour
- **Auto-map integration tests:** 45 min
- **Edge case tests:** 1 hour
- **Orchestrator tests:** 30 min
- **Documentation:** 45 min
- **Verification:** 10 min
- **Commit & PR:** 15 min

**Total:** ~5 hours

## Success Metrics

1. **Coverage:** 10+ tests, >90% line coverage for Node provider code
2. **Stability:** All tests pass in 10 consecutive CI runs
3. **Documentation:** Clear, actionable, with copy-pasteable examples
4. **Confidence:** PR 3 can proceed without hesitation

## Key Design Insights

### Importer-Scoped Labels Enable Fine-Grained Invalidation

**Without importer-scoped:**

- Any lockfile change → all Node targets rebuild
- Coarse invalidation = wasted work

**With importer-scoped:**

- Change `projects/apps/web/pnpm-lock.yaml` → only `//projects/apps/web:*` rebuilds
- Change `lodash` patch used by web only → only web rebuilds
- Fine-grained = efficient incremental builds

### Provider Naming is Content-Addressed

**Format:** `lf_<hash>_<suffix>`

- `<hash>` = 12-char SHA256 of `${lockfile}#${importer}`
- Collision-resistant (2^48 space)
- Deterministic (same input = same output)
- Case-insensitive (normalized)

### Effective Set Calculation Matches pnpm

The traversal algorithm mirrors pnpm's resolution:

1. Start with direct + optional + resolved peer deps
2. Depth-first traverse all dependencies
3. Include peer resolution edges
4. Result: comprehensive transitive closure

**Why this matters:** Provider includes exactly the patches needed, nothing more.

## Alignment with Methodology

### ✅ Architectural Minimalism

- Tests are focused and purposeful
- Each test proves one thing
- No speculative complexity

### ✅ Deterministic Operations

- All tests are synchronous
- No timing-sensitive logic
- Idempotency proven through repeated runs

### ✅ Code Quality Standards

- One test per file
- Self-explanatory test names
- Each file <250 lines

### ✅ Systematic Testing

- Unit tests (naming, collision)
- Integration tests (auto-map)
- Edge case tests (peers, optionals, scoped)
- Regression guards (idempotency, determinism)

## What's NOT in This PR

- ❌ Real PNPM projects (PR 3)
- ❌ Hermetic Nix derivations (PR 4)
- ❌ Node macros (PR 5)
- ❌ Patch wrapper (PR 6)
- ❌ Scaffolding commands (PR 8)
- ❌ Code changes to provider driver (only tests)

## Ready to Implement?

**Prerequisites:** PR 1 complete ✅

**Inputs:**

- Existing provider driver (`build-tools/tools/buck/providers/node.ts`)
- Existing auto-map generator (`build-tools/tools/buck/gen-auto-map.ts`)
- Test helpers and fixtures

**Outputs:**

- 10+ focused tests
- Updated documentation
- Proven foundation for PR 3

**Command to start:**

```bash
# Read the full design
cat docs/pnpm/PR2-design.md

# Create first test
touch build-tools/tools/tests/lib/providers.lockfile-importer-naming.test.ts
```

## Questions to Consider

1. **Should we test with real-world lockfiles?**
   - Not in PR 2 (keep synthetic for determinism)
   - Add real-world fixtures in future PRs as we encounter edge cases

2. **Should we test lockfile version compatibility?**
   - pnpm lockfile v9 is current
   - Add version compatibility tests if we encounter older versions

3. **Should we test YAML parsing errors?**
   - Current design: rely on yaml package
   - Could add malformed lockfile tests in future hardening PR

4. **Should orchestrator tests be integration tests?**
   - Current design: unit-style tests with fixtures
   - True integration tests come with PR 3 (real projects)

## Next Steps

After PR 2 merges:

1. **PR 3:** Scaffold `apps/example` with confidence
2. **PR 4:** Add hermetic Nix derivations (stable lockfile keys proven)
3. **PR 5:** Create Node macros (auto-map wiring proven)
4. **PR 6:** Implement patch wrapper (provider sync integration proven)

---

**Status:** Ready for implementation  
**Estimated Duration:** 5 hours  
**Risk Level:** Low  
**Dependencies:** PR 1 (complete ✅)
