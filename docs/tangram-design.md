# Tangram Vite Webapp Design Doc (`docs/tangram-design.md`)

## Summary

Create a detailed design document for a `scaf`-generated `ts/webapp-ssr-vite` app that implements a single-player, sandbox-only virtual board puzzle using React Native Web components.  
The doc will be implementation-ready and aligned to repo conventions (`METHODOLOGY.XML`, scaffold contracts, Starlark API usage, and PR workflow).

## Key Changes / Design Content

1. **Scaffold + Build Integration**

- Specify bootstrap command: `scaf new ts webapp-ssr-vite tangram --yes`.
- Define `TARGETS` usage with `node_webapp(name = "app_raw")` and `node_asset_stage(name = "app", app = ":app_raw", labels = ["lang:node","kind:app","webapp:ssr","framework:vite"], out = "dist")`.
- Keep SSR baseline intact; game runs in client-hydrated RN Web UI with deterministic initial state for SSR.

2. **System Architecture**

- Document module boundaries (single responsibility, small-file decomposition) for:
  - `game-state` (board/pieces/placement state + reducers/actions)
  - `geometry` (rotation, flip, normalization, collision, bounds)
  - `interaction` (drag/rotate/flip/snap lifecycle)
  - `ui` (Board, PieceTray, PieceSprite, Toolbar, Status)
  - `persistence` (optional local storage restore/reset; no server state)
- Include explicit data flow: user input → interaction handler → reducer/state transition → derived selectors → render.

3. **Game Model + Rules**

- Board fixed to **10 columns x 15 rows**.
- Piece schema in design doc:
  - `pieceId`, `color`, `baseCells: Array<{x,y}>`, `transform`, `position`, `isPlaced`.
- Transform schema:
  - `rotation: 0|90|180|270`, `flipped: boolean`.
- Placement validity:
  - all transformed cells in bounds
  - no overlap
  - win when every board cell is filled exactly once.
- Piece catalog strategy (locked): **manual extraction from product photos**, then hardcoded JSON catalog with exact color + shape coordinates.
- Include a concrete workflow for catalog extraction and normalization (anchor-cell normalization + dedupe by canonical signature).

4. **Interaction + UX Specification**

- Dragging via RN Web responder/pointer-compatible handlers on piece surfaces.
- Snap-to-grid on drop with pixel-to-cell conversion.
- Rotation and flip controls per selected piece (toolbar buttons + keyboard shortcuts).
- Invalid drops revert to last valid position with deterministic feedback.
- Visual language:
  - board grid, high-contrast occupied/empty states,
  - color-accurate piece rendering,
  - selected-piece affordances,
  - mobile + desktop responsive layouts.
- Accessibility:
  - keyboard move/rotate/flip controls,
  - ARIA labels/roles on controls and board status text,
  - non-color-only validity indicators.

5. **Engineering Constraints + Quality Gates**

- Document file-size and SoC constraints from methodology (target ≤250 lines/module).
- Deterministic behavior requirements (no timing-dependent placement logic).
- Explicit non-goals for v1: multiplayer, challenge-card mode, solver/hints, backend sync.
- PR checklist section aligned with `getting-started-on-a-pr.md`:
  - `i && b && v` baseline,
  - target-specific tests,
  - deterministic failure signatures and recovery notes.

## Public APIs / Interfaces / Types To Define in the Doc

- `PieceDefinition`, `PieceTransform`, `PlacedPiece`, `BoardState`, `GameState`.
- Geometry interfaces:
  - `transformCells(baseCells, transform)`,
  - `translateCells(cells, origin)`,
  - `isPlacementValid(boardSize, occupiedSet, cells)`,
  - `computeWinState(gameState)`.
- Interaction interfaces:
  - `beginDrag(pieceId, pointer)`,
  - `updateDrag(pointer)`,
  - `commitDrop()`,
  - `rotateSelected(direction)`,
  - `flipSelected(axis)`.

## Test Plan (to include in the design doc)

1. **Unit tests**

- transform correctness (all rotations + flip combinations)
- canonical normalization stability
- overlap/bounds/win detection
- pixel-to-grid snapping determinism.

2. **Component tests**

- piece drag lifecycle (start/move/drop)
- rotate/flip updates rendered geometry correctly
- invalid placement rollback behavior.

3. **Integration tests**

- full-board solve path reaches win state
- no-overlap invariant maintained across random interaction sequences
- SSR render + hydration consistency (no state mismatch warnings).

4. **Manual acceptance scenarios**

- desktop mouse and mobile touch interactions
- keyboard-only placement flow
- reset/new-game behavior and optional persistence restore.

## Assumptions / Defaults

- Source of truth for piece geometry/colors is manual cataloging from product photos.
- v1 scope is **sandbox-only** gameplay on an empty 10x15 board.
- React Native Web is the primary component layer; no canvas/WebGL dependency in v1.
- The design doc is authored as implementation-ready guidance in `docs/tangram-design.md` and references scaffold and macro contracts without changing them.

## Appendix A: Development Plan (PR Sequence)

This plan follows the same PR structure used in `docs/design-history/quad-alignment-48.md`.
Each PR includes implementation, tests, and documentation updates together.

Scope: deliver a production-ready sandbox tangram webapp on `ts/webapp-ssr-vite` with React
Native Web UI, exact piece catalog, deterministic game rules, and SSR-safe hydration behavior.
Non-goals: challenge cards, multiplayer, hint/solver engine, backend sync.

---

## PR-1: Scaffold the app and land deterministic game-domain foundations

### Description

I will scaffold the Vite SSR app and implement core domain primitives: board constants,
piece/transform types, geometry transforms, and placement validity logic.

### Scope & Changes

- Scaffold app using `scaf new ts webapp-ssr-vite tangram --yes` under `projects/apps/tangram`.
- Replace template placeholder UI with minimal game shell (board container + tray placeholders).
- Add domain modules:
  - board dimensions (`10x15`)
  - type definitions (`PieceDefinition`, `PieceTransform`, `PlacedPiece`, `GameState`)
  - pure geometry helpers (`rotate/flip/normalize/translate`)
  - pure validity helpers (`inBounds`, `noOverlap`, `isPlacementValid`)
- Keep module boundaries small and explicit per methodology.

### Tests (in this PR)

- Unit tests for geometry invariants:
  - all 4 rotations are deterministic
  - flip behavior is deterministic and composable with rotation
  - normalization gives stable canonical forms
- Unit tests for placement validity:
  - in-bounds acceptance/rejection
  - overlap rejection
  - empty-board placement acceptance
- SSR smoke test still passes with the new shell route.

### Docs (in this PR)

- Add "Implementation Status" and "Domain Foundations" notes to `docs/tangram-design.md`.
- Document final type signatures and transform conventions (origin, axis direction, units).

### Acceptance Criteria

- App boots in dev/prod SSR with game shell visible.
- Geometry and placement tests pass and are deterministic.
- No file-size/SoC violations introduced.

### Risks

Coordinate-system mistakes (row/column inversion) could invalidate downstream logic.

### Mitigation

Lock axis conventions in types + tests in this PR before UI interactions land.

### Consequence of Not Implementing

Later PRs would build on unstable geometry logic and incur repeated rework.

### Downsides for Implementing

Some up-front investment before visible gameplay.

### Recommendation

Implement.

---

## PR-2: Add exact piece catalog and validation pipeline

### Description

I will encode the exact piece shapes/colors from product photos into a source-controlled catalog and
add validation to prevent malformed definitions.

### Scope & Changes

- Add static piece catalog module (hardcoded JSON/TS constant) with:
  - `pieceId`
  - exact color token
  - `baseCells`
- Add catalog validator:
  - non-empty cell sets
  - integer unit coordinates
  - no duplicate cells per piece
  - unique piece IDs
- Add canonical-signature check to detect accidental duplicates/edits.
- Wire catalog into initial game-state creation.

### Tests (in this PR)

- Unit tests validating all catalog entries pass schema and integrity checks.
- Snapshot/golden-style test for catalog metadata (piece count, IDs, color tokens).
- Canonical-signature regression test to catch unintentional shape drift.

### Docs (in this PR)

- In `docs/tangram-design.md`, add "Piece Catalog Source of Truth" subsection:
  - manual extraction workflow
  - normalization rules
  - update protocol when catalog changes
- Record final piece IDs/colors and catalog ownership expectations.

### Acceptance Criteria

- Catalog loads without runtime assertions.
- Validation tests fail on malformed or duplicate shapes.
- Initial state uses the exact catalog as the only source of truth.

### Risks

Manual transcription errors from source photos.

### Mitigation

Validator + regression tests + explicit update checklist in docs.

### Consequence of Not Implementing

Gameplay could ship with incorrect pieces or unstable future edits.

### Downsides for Implementing

Initial data-entry effort and test maintenance.

### Recommendation

Implement.

---

## PR-3: Implement board/tray rendering and reducer-driven game state

### Description

I will implement the core visual layout and reducer architecture so pieces can be displayed and
selected with deterministic state transitions.

### Scope & Changes

- Build RN Web components:
  - `GameScreen`
  - `BoardGrid`
  - `PieceTray`
  - `PieceView`
  - `Toolbar` (disabled action placeholders initially)
- Implement reducer/actions for:
  - piece selection
  - preview positioning
  - placement commit/revert
  - reset board
- Render board and tray from selectors only (no ad hoc mutable UI state).

### Tests (in this PR)

- Reducer tests for action/state transition correctness.
- Component tests for:
  - board cell rendering shape
  - piece rendering from catalog
  - selected-piece highlighting
- SSR hydration test to ensure deterministic initial markup/state handshake.

### Docs (in this PR)

- Add architecture diagram/text for component tree + reducer/data flow in
  `docs/tangram-design.md`.
- Document action contracts and reducer invariants.

### Acceptance Criteria

- All pieces render in tray; board renders 10x15 grid.
- Selection and reset state transitions are deterministic and tested.
- Hydration mismatch warnings are absent in test/dev flow.

### Risks

State duplication between view and reducer can cause drift.

### Mitigation

Single reducer source-of-truth plus selector-based rendering only.

### Consequence of Not Implementing

Interaction PRs would rely on brittle UI-local state.

### Downsides for Implementing

More plumbing before advanced interactions.

### Recommendation

Implement.

---

## PR-4: Ship drag-and-drop with snapping and invalid-drop rollback

### Description

I will implement draggable piece interactions on desktop and touch, with snap-to-grid drop and
invalid-placement rollback.

### Scope & Changes

- Add interaction layer for pointer/responder events on pieces.
- Implement drag session state:
  - drag start anchor
  - live preview coordinates
  - drop commit path
- Convert pixel coordinates to board units and snap on drop.
- Invalid drop behavior: revert to previous valid position and keep user feedback deterministic.

### Tests (in this PR)

- Interaction tests:
  - drag start/move/end lifecycle
  - snap-to-grid behavior
  - invalid placement rollback path
- Integration tests for overlap and out-of-bounds rejection via drag flow.
- Manual acceptance checklist for mouse + touch behavior.

### Docs (in this PR)

- Add "Drag Contract" subsection to `docs/tangram-design.md`:
  - event lifecycle
  - snap formula
  - rollback rules
- Add troubleshooting notes for pointer/touch edge cases.

### Acceptance Criteria

- Pieces are draggable and snap correctly.
- Invalid drops never corrupt occupancy state.
- Desktop and touch interactions both pass defined checks.

### Risks

Pointer event differences between browsers/devices.

### Mitigation

RN Web responder-first handling plus deterministic fallback logic.

### Consequence of Not Implementing

Core gameplay objective is unreachable in v1.

### Downsides for Implementing

Complex interaction surface with higher test burden.

### Recommendation

Implement.

---

## PR-5: Add rotate/flip controls, keyboard accessibility, and win detection

### Description

I will implement rotate/flip controls for pieces, keyboard controls for accessibility, and final
win-state detection.

### Scope & Changes

- Add piece transform actions:
  - rotate clockwise/counterclockwise
  - flip horizontal (and/or chosen single-axis policy from design)
- Add keyboard bindings for selected piece movement/rotation/flip.
- Add win detector: game is solved when board is fully covered with no overlap/gaps.
- Add status banner and solved-state UI feedback.

### Tests (in this PR)

- Unit tests for transform action correctness on placed and unplaced pieces.
- Accessibility interaction tests for keyboard control flow.
- Integration tests for full solve path triggering solved state.
- Negative integration test: near-complete board with gaps does not trigger win.

### Docs (in this PR)

- Update `docs/tangram-design.md` with transform UX, keyboard mapping, and win semantics.
- Document accessibility guarantees and known limitations.

### Acceptance Criteria

- Users can rotate/flip pieces through UI and keyboard controls.
- Win state triggers only on exact full coverage.
- Accessibility pathways are test-covered and functional.

### Risks

Transforming a selected piece during drag may introduce ambiguous state transitions.

### Mitigation

Define and enforce one deterministic rule (e.g., disallow transform during active drag or apply to
preview only) and test it.

### Consequence of Not Implementing

Game would miss required interaction features and completion criteria.

### Downsides for Implementing

More edge-case handling for transform + drag interplay.

### Recommendation

Implement.

---

## PR-6: Polish runtime reliability, persistence, and release readiness

### Description

I will harden behavior for long sessions, add optional local persistence, and finalize
production-readiness checks.

### Scope & Changes

- Add optional local persistence for in-progress board state (versioned storage key + safe
  restore).
- Add reset/new-game flow that is deterministic and clears persisted state as intended.
- Add performance guardrails:
  - memoized selectors where needed
  - avoid unnecessary rerenders during drag
- Validate SSR/prod pipeline behavior with final app wiring (`build:ssr`, `start:ssr`,
  `node_asset_stage` output expectations).

### Tests (in this PR)

- Persistence tests:
  - restore valid state
  - ignore corrupt/incompatible payloads
  - reset behavior with storage
- Stability/integration tests for repeated drag/transform cycles without state corruption.
- Final SSR/prod smoke tests on built artifacts and route rendering.

### Docs (in this PR)

- Add "Operational Notes" section in `docs/tangram-design.md`:
  - persistence policy
  - failure recovery behavior
  - release verification commands (`i && b && v` + app-specific checks)
- Mark design sections with implemented status and any follow-up backlog items.

### Acceptance Criteria

- App remains stable across repeated interactions and reloads.
- Persistence is safe, versioned, and non-breaking on bad data.
- Final verification passes in repo-standard workflow.

### Risks

Persisted schema drift across future iterations.

### Mitigation

Storage versioning + safe parse + fallback-to-fresh-state behavior.

### Consequence of Not Implementing

Higher chance of runtime regressions and poor user continuity across sessions.

### Downsides for Implementing

Additional maintenance for persistence compatibility.

### Recommendation

Implement.
